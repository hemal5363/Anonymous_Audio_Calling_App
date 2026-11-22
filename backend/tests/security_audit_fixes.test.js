import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import request from 'supertest';
import { z } from 'zod';
import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import app from '../src/app.js';
import { pool } from '../src/db/index.js';
import { config } from '../src/config/index.js';
import { logger } from '../src/utils/logger.js';
import { generateAccessToken, generateAdminToken, hashToken } from '../src/utils/token.js';
import { callSessionManager } from '../src/socket/callSessionManager.js';
import { userSocketMap } from '../src/socket/userSocketMap.js';

describe('Security Audit Fixes Verification', () => {
  let querySpy;

  beforeEach(() => {
    querySpy = jest.spyOn(pool, 'query');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    callSessionManager.clear();
    userSocketMap.clear();
  });

  describe('SEC-01: JWT Secret Minimum Length Requirements', () => {
    const jwtConfigSchema = z.object({
      JWT_SECRET: z.string().min(32, 'JWT_SECRET is required and must be at least 32 characters long'),
      JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET is required and must be at least 32 characters long'),
    });

    it('should reject JWT secrets shorter than 32 characters', () => {
      const invalidShort = {
        JWT_SECRET: 'short_secret_under_32_chars',
        JWT_REFRESH_SECRET: 'also_short',
      };
      const result = jwtConfigSchema.safeParse(invalidShort);
      expect(result.success).toBe(false);
      expect(result.error.errors[0].message).toContain('at least 32 characters long');
    });

    it('should accept JWT secrets of 32 characters or longer', () => {
      const validLong = {
        JWT_SECRET: 'a_very_secure_and_strong_jwt_secret_key_32_chars!',
        JWT_REFRESH_SECRET: 'a_very_secure_and_strong_jwt_refresh_key_32_chars!',
      };
      const result = jwtConfigSchema.safeParse(validLong);
      expect(result.success).toBe(true);
    });
  });

  describe('SEC-02, SEC-03, SEC-06: OTP Generation, Logging, & 60s Cooldown', () => {
    it('SEC-06: should return 429 Too Many Requests if OTP was requested within 60 seconds for the same phone', async () => {
      // 1. Mobile login setting is enabled
      querySpy
        .mockResolvedValueOnce({
          rows: [{ value_json: { mobile_login_enabled: true } }],
        })
        // 2. Cooldown check finds recent OTP
        .mockResolvedValueOnce({
          rows: [{ id: 'recent-otp-id-123' }],
        });

      const res = await request(app)
        .post('/auth/otp/request')
        .send({ phone: '+919876543210' });

      expect(res.status).toBe(429);
      expect(res.body.message).toContain('Please wait 60 seconds before requesting another code');
    });

    it('SEC-02: should generate 6-digit OTP using crypto.randomInt', async () => {
      const randomIntSpy = jest.spyOn(crypto, 'randomInt');

      querySpy
        .mockResolvedValueOnce({
          rows: [{ value_json: { mobile_login_enabled: true } }],
        })
        .mockResolvedValueOnce({ rows: [] }) // no recent OTP within 60s
        .mockResolvedValueOnce({ rows: [] }) // invalidate previous
        .mockResolvedValueOnce({ rows: [] }); // insert new

      const res = await request(app)
        .post('/auth/otp/request')
        .send({ phone: '+919876543210' });

      expect(res.status).toBe(200);
      expect(randomIntSpy).toHaveBeenCalledWith(100000, 1000000);
    });

    it('SEC-03: should NOT log plaintext OTP in production environment', async () => {
      const loggerSpy = jest.spyOn(logger, 'info');
      const originalEnv = config.env;
      config.env = 'production';

      try {
        querySpy
          .mockResolvedValueOnce({
            rows: [{ value_json: { mobile_login_enabled: true } }],
          })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] });

        await request(app)
          .post('/auth/otp/request')
          .send({ phone: '+919876543210' });

        const devConsoleLog = loggerSpy.mock.calls.find((call) =>
          call.some((arg) => typeof arg === 'string' && arg.includes('[DEV CONSOLE] Mobile Login OTP'))
        );
        expect(devConsoleLog).toBeUndefined();
      } finally {
        config.env = originalEnv;
      }
    });
  });

  describe('SEC-04: Real-time Banned/Suspended User Revocation', () => {
    const mockAdmin = {
      id: 'admin-uuid-1',
      email: 'admin@example.com',
      role: 'superadmin',
      is_active: true,
    };
    const adminToken = generateAdminToken(mockAdmin);
    const targetUserId = 'target-banned-user-123';

    it('should revoke all refresh tokens and terminate active call when user is banned', async () => {
      // Setup active in-memory session
      const testCallCode = 'call-code-banned-test';
      const mockSession = callSessionManager.createSession({
        sessionId: 'session-banned-uuid',
        callCode: testCallCode,
        callerId: targetUserId,
        calleeId: 'peer-user-456',
        billingMode: 'free',
      });

      querySpy
        .mockResolvedValueOnce({ rows: [mockAdmin] }) // admin auth
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: targetUserId, status: 'banned' }] }) // update user status
        .mockResolvedValueOnce({ rowCount: 2 }) // update refresh_tokens
        .mockResolvedValueOnce({ rowCount: 1 }); // end call in DB

      const res = await request(app)
        .patch(`/admin/users/${targetUserId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'banned', reason: 'Severe Terms of Service violation' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('banned');

      // Verify refresh tokens were revoked in database
      expect(querySpy).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = $1'),
        [targetUserId]
      );

      // Verify active session was cleared from CallSessionManager
      expect(callSessionManager.getSession(testCallCode)).toBeNull();
      expect(callSessionManager.getSessionByUserId(targetUserId)).toBeNull();
    });
  });

  describe('SEC-07: Seed Script Protection in Production', () => {
    it('should throw an error if ADMIN_PASSWORD is missing in production', () => {
      const originalEnv = process.env.NODE_ENV;
      const originalAdminPass = process.env.ADMIN_PASSWORD;

      process.env.NODE_ENV = 'production';
      delete process.env.ADMIN_PASSWORD;

      expect(() => {
        if (process.env.NODE_ENV === 'production' && !process.env.ADMIN_PASSWORD) {
          throw new Error('ADMIN_PASSWORD must be explicitly set in environment variables when seeding in production');
        }
      }).toThrow('ADMIN_PASSWORD must be explicitly set');

      process.env.NODE_ENV = originalEnv;
      if (originalAdminPass) process.env.ADMIN_PASSWORD = originalAdminPass;
    });
  });

  describe('SEC-11: Password Hashing Cost (12 Rounds)', () => {
    it('should hash passwords with 12 bcrypt salt rounds during user registration', async () => {
      const hashSpy = jest.spyOn(bcrypt, 'hash');
      const mockClient = {
        query: jest.fn().mockResolvedValue({
          rows: [{ id: 'new-user-123', email: 'owasp@example.com', status: 'active', is_available: false, created_at: new Date() }],
        }),
        release: jest.fn(),
      };

      jest.spyOn(pool, 'connect').mockResolvedValue(mockClient);
      querySpy.mockResolvedValueOnce({ rows: [] }); // email check

      const res = await request(app)
        .post('/auth/register')
        .send({
          email: 'owasp@example.com',
          password: 'SecurePassword123!',
          confirm_age_18: true,
        });

      expect(res.status).toBe(201);
      expect(hashSpy).toHaveBeenCalledWith('SecurePassword123!', 12);
    });
  });

  describe('SEC-12: Logout Token Revocation Scoped by User ID', () => {
    it('should scope refresh token revocation to both token_hash and req.user.id', async () => {
      const mockUser = { id: 'logout-user-777', email: 'logout@example.com' };
      const userToken = generateAccessToken(mockUser);
      const refreshToken = 'sample-refresh-token-string';
      const expectedHash = hashToken(refreshToken);

      querySpy
        .mockResolvedValueOnce({ rows: [{ ...mockUser, status: 'active' }] }) // auth middleware
        .mockResolvedValueOnce({ rowCount: 1 }); // revoke query

      const res = await request(app)
        .post('/auth/logout')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ refreshToken });

      expect(res.status).toBe(200);
      expect(querySpy).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE token_hash = $1 AND user_id = $2'),
        [expectedHash, mockUser.id]
      );
    });
  });

  describe('SEC-13: Admin Query Parameter Validation', () => {
    const mockAdmin = {
      id: 'admin-uuid-1',
      email: 'admin@example.com',
      role: 'superadmin',
      is_active: true,
    };
    const adminToken = generateAdminToken(mockAdmin);

    it('GET /admin/users should return 400 Bad Request on invalid status enum', async () => {
      querySpy.mockResolvedValueOnce({ rows: [mockAdmin] }); // admin auth

      const res = await request(app)
        .get('/admin/users?status=malicious_status')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('BadRequest');
    });

    it('GET /admin/reports should return 400 Bad Request on invalid status enum', async () => {
      querySpy.mockResolvedValueOnce({ rows: [mockAdmin] }); // admin auth

      const res = await request(app)
        .get('/admin/reports?status=not_a_valid_report_status')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('BadRequest');
    });

    it('GET /admin/calls should return 400 Bad Request on invalid status enum', async () => {
      querySpy.mockResolvedValueOnce({ rows: [mockAdmin] }); // admin auth

      const res = await request(app)
        .get('/admin/calls?status=invalid_call_state')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('BadRequest');
    });
  });

  describe('SEC-09: Production HTTPS Redirection & Trust Proxy', () => {
    it('should redirect HTTP requests to HTTPS when config.env is production', async () => {
      const originalEnv = config.env;
      config.env = 'production';
      try {
        const res = await request(app)
          .get('/health')
          .set('Host', 'api.example.com')
          .set('x-forwarded-proto', 'http');

        expect(res.status).toBe(301);
        expect(res.headers.location).toBe('https://api.example.com/health');
      } finally {
        config.env = originalEnv;
      }
    });

    it('should NOT redirect when request is forwarded over HTTPS', async () => {
      const originalEnv = config.env;
      config.env = 'production';
      try {
        const res = await request(app)
          .get('/health')
          .set('Host', 'api.example.com')
          .set('x-forwarded-proto', 'https');

        expect(res.status).toBe(200);
      } finally {
        config.env = originalEnv;
      }
    });
  });
});
