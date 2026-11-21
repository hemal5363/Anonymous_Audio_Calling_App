import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import request from 'supertest';
import bcrypt from 'bcrypt';
import app from '../src/app.js';
import { pool } from '../src/db/index.js';
import { generateAccessToken, generateRefreshToken } from '../src/utils/token.js';

describe('Auth Endpoints (POST /auth/register, /auth/login, /auth/refresh, /auth/logout)', () => {
  let querySpy;
  let connectSpy;
  let mockClient;

  beforeEach(() => {
    mockClient = {
      query: jest.fn(),
      release: jest.fn(),
    };
    querySpy = jest.spyOn(pool, 'query');
    connectSpy = jest.spyOn(pool, 'connect').mockResolvedValue(mockClient);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('POST /auth/register', () => {
    it('should reject registration if user is under 18', async () => {
      const res = await request(app)
        .post('/auth/register')
        .send({
          email: 'underage@example.com',
          password: 'Password123!',
          confirm_age_18: false,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('18 years or older');
    });

    it('should reject registration with invalid email', async () => {
      const res = await request(app)
        .post('/auth/register')
        .send({
          email: 'not-an-email',
          password: 'Password123!',
          confirm_age_18: true,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Invalid email');
    });

    it('should reject registration if password is too short (<8 chars)', async () => {
      const res = await request(app)
        .post('/auth/register')
        .send({
          email: 'user@example.com',
          password: '123',
          confirm_age_18: true,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('at least 8 characters');
    });

    it('should return 409 Conflict if email is already registered', async () => {
      querySpy.mockResolvedValueOnce({
        rows: [{ id: 'existing-uuid-123' }],
      });

      const res = await request(app)
        .post('/auth/register')
        .send({
          email: 'existing@example.com',
          password: 'Password123!',
          confirm_age_18: true,
        });

      expect(res.status).toBe(409);
      expect(res.body.message).toBe('Email already registered');
    });

    it('should register a new user successfully and return 201 with tokens', async () => {
      querySpy.mockResolvedValueOnce({ rows: [] }); // check existing email

      const mockUser = {
        id: 'new-user-uuid',
        email: 'newuser@example.com',
        status: 'active',
        is_available: false,
        created_at: new Date().toISOString(),
      };

      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [mockUser] }) // INSERT user
        .mockResolvedValueOnce({ rows: [] }) // INSERT wallet
        .mockResolvedValueOnce({ rows: [] }) // INSERT refresh_token
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      const res = await request(app)
        .post('/auth/register')
        .send({
          email: 'newuser@example.com',
          password: 'Password123!',
          confirm_age_18: true,
        });

      expect(res.status).toBe(201);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.email).toBe('newuser@example.com');
      expect(res.body.tokens).toBeDefined();
      expect(res.body.tokens.accessToken).toBeDefined();
      expect(res.body.tokens.refreshToken).toBeDefined();
    });
  });

  describe('POST /auth/login', () => {
    it('should return 400 if email or password is missing', async () => {
      const res = await request(app).post('/auth/login').send({});
      expect(res.status).toBe(400);
    });

    it('should return 401 if user is not found', async () => {
      querySpy.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .post('/auth/login')
        .send({ email: 'notfound@example.com', password: 'Password123!' });

      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Invalid email or password');
    });

    it('should return 401 if password does not match', async () => {
      const hash = await bcrypt.hash('CorrectPassword123!', 10);
      querySpy.mockResolvedValueOnce({
        rows: [
          {
            id: 'user-uuid',
            email: 'user@example.com',
            password_hash: hash,
            status: 'active',
            is_available: false,
          },
        ],
      });

      const res = await request(app)
        .post('/auth/login')
        .send({ email: 'user@example.com', password: 'WrongPassword!' });

      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Invalid email or password');
    });

    it('should return 403 if account is suspended', async () => {
      const hash = await bcrypt.hash('Password123!', 10);
      querySpy.mockResolvedValueOnce({
        rows: [
          {
            id: 'user-uuid',
            email: 'user@example.com',
            password_hash: hash,
            status: 'suspended',
            is_available: false,
          },
        ],
      });

      const res = await request(app)
        .post('/auth/login')
        .send({ email: 'user@example.com', password: 'Password123!' });

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('suspended or banned');
    });

    it('should authenticate user and return 200 with tokens', async () => {
      const hash = await bcrypt.hash('Password123!', 10);
      querySpy
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'user-uuid',
              email: 'user@example.com',
              phone: null,
              password_hash: hash,
              status: 'active',
              is_available: false,
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }); // insert refresh_token

      const res = await request(app)
        .post('/auth/login')
        .send({ email: 'user@example.com', password: 'Password123!' });

      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe('user@example.com');
      expect(res.body.tokens.accessToken).toBeDefined();
      expect(res.body.tokens.refreshToken).toBeDefined();
    });
  });

  describe('POST /auth/refresh', () => {
    it('should return 400 if refreshToken is omitted', async () => {
      const res = await request(app).post('/auth/refresh').send({});
      expect(res.status).toBe(400);
    });

    it('should return 401 if refreshToken is invalid or tampered', async () => {
      const res = await request(app)
        .post('/auth/refresh')
        .send({ refreshToken: 'invalid.jwt.token' });

      expect(res.status).toBe(401);
    });

    it('should rotate token and return new token pair if valid', async () => {
      const user = { id: 'test-user-id', email: 'test@example.com' };
      const refreshToken = generateRefreshToken(user);

      querySpy
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'token-record-id',
              user_id: user.id,
              expires_at: new Date(Date.now() + 86400000).toISOString(),
              revoked_at: null,
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [{ id: user.id, email: user.email, status: 'active', is_available: false }],
        })
        .mockResolvedValueOnce({ rows: [] }) // revoke old
        .mockResolvedValueOnce({ rows: [] }); // insert new

      const res = await request(app)
        .post('/auth/refresh')
        .send({ refreshToken });

      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBeDefined();
      expect(res.body.refreshToken).toBeDefined();
    });
  });

  describe('POST /auth/logout', () => {
    it('should return 401 Unauthorized if no auth token is provided', async () => {
      const res = await request(app).post('/auth/logout').send({});
      expect(res.status).toBe(401);
    });

    it('should revoke refresh token and return 200 when authenticated', async () => {
      const user = { id: 'user-id-123', email: 'user@example.com', status: 'active' };
      const accessToken = generateAccessToken(user);

      querySpy
        .mockResolvedValueOnce({
          rows: [user], // auth middleware check
        })
        .mockResolvedValueOnce({ rows: [] }); // update refresh_tokens

      const res = await request(app)
        .post('/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ refreshToken: 'some-refresh-token' });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Logged out successfully');
    });
  });
});
