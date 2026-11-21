import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import request from 'supertest';
import app from '../src/app.js';
import { pool } from '../src/db/index.js';
import { hashToken } from '../src/utils/token.js';

describe('Mobile Login Admin Setting & OTP Flow', () => {
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

  describe('When mobile_login_enabled is FALSE (Default MVP state)', () => {
    beforeEach(() => {
      // Mock app_settings returning mobile_login_enabled: false
      querySpy.mockResolvedValue({
        rows: [
          {
            value_json: {
              email_login_enabled: true,
              mobile_login_enabled: false,
            },
          },
        ],
      });
    });

    it('POST /auth/otp/request should return 403 Forbidden with exact admin error message', async () => {
      const res = await request(app)
        .post('/auth/otp/request')
        .send({ phone: '+919876543210' });

      expect(res.status).toBe(403);
      expect(res.body.message).toBe('Mobile login is disabled by platform administrator');
    });

    it('POST /auth/otp/verify should return 403 Forbidden when setting is disabled', async () => {
      const res = await request(app)
        .post('/auth/otp/verify')
        .send({ phone: '+919876543210', otp: '123456' });

      expect(res.status).toBe(403);
      expect(res.body.message).toBe('Mobile login is disabled by platform administrator');
    });
  });

  describe('When mobile_login_enabled is TRUE (Admin enabled)', () => {
    it('POST /auth/otp/request should reject invalid non-E.164 phone formats with 400', async () => {
      querySpy.mockResolvedValueOnce({
        rows: [{ value_json: { mobile_login_enabled: true } }],
      });

      const res = await request(app)
        .post('/auth/otp/request')
        .send({ phone: '9876543210' }); // missing + country code

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('E.164 format');
    });

    it('POST /auth/otp/request should generate OTP, print to console, and return 200', async () => {
      querySpy
        .mockResolvedValueOnce({
          rows: [{ value_json: { mobile_login_enabled: true } }],
        })
        .mockResolvedValueOnce({ rows: [] }) // invalidate old OTPs
        .mockResolvedValueOnce({ rows: [] }); // insert new OTP

      const res = await request(app)
        .post('/auth/otp/request')
        .send({ phone: '+919876543210' });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('OTP sent successfully');
      expect(res.body.expires_in_seconds).toBe(300);
    });

    it('POST /auth/otp/verify should return 401 on incorrect OTP code', async () => {
      const storedHash = hashToken('654321');

      querySpy
        .mockResolvedValueOnce({
          rows: [{ value_json: { mobile_login_enabled: true } }],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'otp-id-123',
              code_hash: storedHash,
              attempts: 0,
              max_attempts: 3,
              expires_at: new Date(Date.now() + 100000).toISOString(),
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }); // increment attempts

      const res = await request(app)
        .post('/auth/otp/verify')
        .send({ phone: '+919876543210', otp: '111111' });

      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Invalid OTP code');
    });

    it('POST /auth/otp/verify should authenticate and provision new user on correct OTP', async () => {
      const otp = '998877';
      const storedHash = hashToken(otp);

      querySpy
        .mockResolvedValueOnce({
          rows: [{ value_json: { mobile_login_enabled: true } }],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'otp-id-123',
              code_hash: storedHash,
              attempts: 0,
              max_attempts: 3,
              expires_at: new Date(Date.now() + 100000).toISOString(),
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }); // mark OTP as used

      const mockNewUser = {
        id: 'phone-user-id',
        email: null,
        phone: '+919876543210',
        status: 'active',
        is_available: false,
      };

      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // check existing user
        .mockResolvedValueOnce({ rows: [mockNewUser] }) // insert new user
        .mockResolvedValueOnce({ rows: [] }) // insert wallet
        .mockResolvedValueOnce({ rows: [] }) // insert refresh_token
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      const res = await request(app)
        .post('/auth/otp/verify')
        .send({ phone: '+919876543210', otp });

      expect(res.status).toBe(200);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.phone).toBe('+919876543210');
      expect(res.body.tokens).toBeDefined();
      expect(res.body.tokens.accessToken).toBeDefined();
    });
  });
});
