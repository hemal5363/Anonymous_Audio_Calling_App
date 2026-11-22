import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import app from '../src/app.js';
import { pool } from '../src/db/index.js';
import { config } from '../src/config/index.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { logger } from '../src/utils/logger.js';
import { generateAccessToken } from '../src/utils/token.js';

describe('Health Endpoint & Central Error Handler Security', () => {
  let querySpy;

  beforeEach(() => {
    querySpy = jest.spyOn(pool, 'query');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('1. GET /health Endpoint Database Health Check', () => {
    it('should return 200 with status healthy and connected database when DB query succeeds', async () => {
      querySpy.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });

      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('healthy');
      expect(res.body.database).toBeDefined();
      expect(res.body.database.status).toBe('connected');
      expect(typeof res.body.database.latencyMs).toBe('number');
      expect(typeof res.body.uptime).toBe('number');
      expect(res.body.timestamp).toBeDefined();
    });

    it('should return 503 Service Unavailable when database query fails without leaking DB credentials', async () => {
      // Simulate raw database connection failure
      querySpy.mockRejectedValueOnce(
        new Error('connect ECONNREFUSED 127.0.0.1:5432 postgres://app_user:secret_pass@127.0.0.1:5432/db')
      );

      const res = await request(app).get('/health');

      expect(res.status).toBe(503);
      expect(res.body.status).toBe('unhealthy');
      expect(res.body.database.status).toBe('disconnected');
      expect(res.body.database.error).toBe('Database unavailable');

      // Crucial security check: Ensure connection string, password, and host are NOT leaked
      const bodyString = JSON.stringify(res.body);
      expect(bodyString).not.toContain('secret_pass');
      expect(bodyString).not.toContain('ECONNREFUSED');
      expect(bodyString).not.toContain('postgres://');
    });
  });

  describe('2. Central Express Error Handler Database Error Sanitization', () => {
    it('should catch database errors in routes and return generic error message without leaking SQL or stack traces', async () => {
      const testApp = express();
      testApp.use(express.json());

      // Route that throws a raw PostgreSQL syntax/query error
      testApp.get('/test-db-error', async (req, res, next) => {
        const sqlError = new Error('syntax error at or near "SELECT * FROM secrets WHERE secret_key = 12345"');
        sqlError.code = '42601';
        sqlError.table = 'secrets';
        sqlError.routine = 'scanner_yyerror';
        return next(sqlError);
      });

      testApp.use(errorHandler);

      const res = await request(testApp).get('/test-db-error');

      expect(res.status).toBe(500);
      expect(res.body.statusCode).toBe(500);
      expect(res.body.error).toBe('InternalServerError');
      expect(res.body.message).toBe('A database error occurred. Please try again later.');

      // Verify no SQL, table name, or query leaks
      const responseText = JSON.stringify(res.body);
      expect(responseText).not.toContain('syntax error');
      expect(responseText).not.toContain('SELECT * FROM secrets');
      expect(responseText).not.toContain('scanner_yyerror');
      expect(res.body.stack).toBeUndefined();
    });

    it('should strictly hide stack traces and internal errors in production mode', async () => {
      const originalEnv = config.env;
      config.env = 'production';

      try {
        const testApp = express();
        testApp.use(express.json());

        testApp.get('/test-internal-error', (req, res, next) => {
          const err = new Error('Internal sensitive details about server architecture');
          err.stack = 'Error: sensitive stack trace at Object.run (/var/app/secret.js:42:15)';
          return next(err);
        });

        testApp.use(errorHandler);

        const res = await request(testApp).get('/test-internal-error');

        expect(res.status).toBe(500);
        expect(res.body.error).toBe('InternalServerError');
        expect(res.body.message).toBe('An unexpected internal server error occurred.');
        expect(res.body.stack).toBeUndefined();

        const responseText = JSON.stringify(res.body);
        expect(responseText).not.toContain('sensitive stack trace');
        expect(responseText).not.toContain('/var/app/secret.js');
      } finally {
        config.env = originalEnv;
      }
    });

    it('should preserve user-friendly client errors (e.g. 400 Bad Request)', async () => {
      const testApp = express();
      testApp.use(express.json());

      testApp.get('/test-client-error', (req, res, next) => {
        const err = new Error('Invalid email format provided');
        err.statusCode = 400;
        err.name = 'BadRequest';
        return next(err);
      });

      testApp.use(errorHandler);

      const res = await request(testApp).get('/test-client-error');

      expect(res.status).toBe(400);
      expect(res.body.statusCode).toBe(400);
      expect(res.body.error).toBe('BadRequest');
      expect(res.body.message).toBe('Invalid email format provided');
    });

    it('should catch database failure during real authenticated route execution', async () => {
      const mockUser = {
        id: '22222222-2222-4222-8222-222222222222',
        email: 'user_err@example.com',
        status: 'active',
        is_available: false,
      };
      const token = generateAccessToken(mockUser);

      // 1. Auth middleware check passes
      querySpy.mockResolvedValueOnce({ rows: [mockUser] });
      // 2. Database failure on availability update
      const dbErr = new Error('relation "users" does not exist in schema "public"');
      dbErr.code = '42P01';
      querySpy.mockRejectedValueOnce(dbErr);

      const res = await request(app)
        .put('/user/availability')
        .set('Authorization', `Bearer ${token}`)
        .send({ is_available: true });

      expect(res.status).toBe(500);
      expect(res.body.statusCode).toBe(500);
      expect(res.body.error).toBe('InternalServerError');
      expect(res.body.message).toBe('A database error occurred. Please try again later.');

      const bodyText = JSON.stringify(res.body);
      expect(bodyText).not.toContain('relation "users" does not exist');
      expect(bodyText).not.toContain('42P01');
      expect(res.body.stack).toBeUndefined();
    });
  });

  describe('3. Structured Logger Utility', () => {
    it('should redact sensitive keys such as password, token, and secret in structured logs', () => {
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const originalLogLevel = process.env.LOG_LEVEL;
      process.env.LOG_LEVEL = 'info';

      try {
        logger.info('User authenticated successfully', {
          userId: 'user-123',
          token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
          password: 'SuperSecretPassword!',
          otp: '123456',
        });

        expect(consoleLogSpy).toHaveBeenCalled();
        const loggedOutput = consoleLogSpy.mock.calls[0][0];
        expect(loggedOutput).toContain('[INFO] User authenticated successfully');
        expect(loggedOutput).toContain('"token":"[REDACTED]"');
        expect(loggedOutput).toContain('"password":"[REDACTED]"');
        expect(loggedOutput).toContain('"otp":"[REDACTED]"');
        expect(loggedOutput).not.toContain('SuperSecretPassword!');
        expect(loggedOutput).not.toContain('eyJhbGci');
      } finally {
        process.env.LOG_LEVEL = originalLogLevel;
        consoleLogSpy.mockRestore();
      }
    });
  });
});
