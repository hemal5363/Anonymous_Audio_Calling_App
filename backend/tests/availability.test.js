import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import request from 'supertest';
import app from '../src/app.js';
import { pool } from '../src/db/index.js';
import { generateAccessToken } from '../src/utils/token.js';

describe('Availability & Push Token Endpoints', () => {
  let querySpy;
  const mockUser = {
    id: 'user-uuid-1111',
    email: 'test@example.com',
    phone: null,
    status: 'active',
    is_available: false,
  };
  let userToken;

  beforeEach(() => {
    userToken = generateAccessToken(mockUser);
    querySpy = jest.spyOn(pool, 'query');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('PUT /user/availability', () => {
    it('should reject unauthenticated request with 401', async () => {
      const res = await request(app)
        .put('/user/availability')
        .send({ is_available: true });

      expect(res.status).toBe(401);
      expect(res.body.message).toContain('token is missing or malformed');
    });

    it('should return 400 if is_available is not a boolean', async () => {
      querySpy.mockResolvedValueOnce({ rows: [mockUser] }); // auth check

      const res = await request(app)
        .put('/user/availability')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ is_available: 'yes' });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('must be a boolean');
    });

    it('should update availability to true and return updated status', async () => {
      const now = new Date().toISOString();
      querySpy
        .mockResolvedValueOnce({ rows: [mockUser] }) // auth check
        .mockResolvedValueOnce({
          rows: [{ is_available: true, available_changed_at: now }],
        });

      const res = await request(app)
        .put('/user/availability')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ is_available: true });

      expect(res.status).toBe(200);
      expect(res.body.is_available).toBe(true);
      expect(res.body.available_changed_at).toBe(now);
    });

    it('should update availability to false', async () => {
      const now = new Date().toISOString();
      querySpy
        .mockResolvedValueOnce({ rows: [mockUser] }) // auth check
        .mockResolvedValueOnce({
          rows: [{ is_available: false, available_changed_at: now }],
        });

      const res = await request(app)
        .put('/user/availability')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ is_available: false });

      expect(res.status).toBe(200);
      expect(res.body.is_available).toBe(false);
    });
  });

  describe('POST /user/push-token', () => {
    it('should reject unauthenticated request with 401', async () => {
      const res = await request(app)
        .post('/user/push-token')
        .send({ push_token: 'fcm_mock_token' });

      expect(res.status).toBe(401);
    });

    it('should reject empty push_token with 400', async () => {
      querySpy.mockResolvedValueOnce({ rows: [mockUser] }); // auth check

      const res = await request(app)
        .post('/user/push-token')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ push_token: '' });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('push_token cannot be empty');
    });

    it('should save push token successfully and return 200', async () => {
      querySpy
        .mockResolvedValueOnce({ rows: [mockUser] }) // auth check
        .mockResolvedValueOnce({ rows: [] }); // update users

      const res = await request(app)
        .post('/user/push-token')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ push_token: 'fcm_mock_token_123456789' });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Push token registered successfully');
    });
  });
});
