import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import request from 'supertest';
import app from '../src/app.js';
import { pool } from '../src/db/index.js';
import { generateAccessToken } from '../src/utils/token.js';

describe('User Legal Consent Endpoints', () => {
  let querySpy;
  const mockUser = {
    id: 'user-uuid-consent-1',
    email: 'consent@example.com',
    phone: null,
    status: 'active',
    is_available: false,
    terms_version: '1.0',
    privacy_version: '1.0',
  };
  let userToken;

  beforeEach(() => {
    userToken = generateAccessToken(mockUser);
    querySpy = jest.spyOn(pool, 'query');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('PUT /user/consent', () => {
    it('should reject unauthenticated request with 401', async () => {
      const res = await request(app)
        .put('/user/consent')
        .send({ terms_version: '1.1', privacy_version: '1.1' });

      expect(res.status).toBe(401);
      expect(res.body.message).toContain('token is missing or malformed');
    });

    it('should reject request with 400 when no version is provided', async () => {
      querySpy.mockResolvedValueOnce({ rows: [mockUser] }); // auth check

      const res = await request(app)
        .put('/user/consent')
        .set('Authorization', `Bearer ${userToken}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('At least one of terms_version or privacy_version must be provided');
    });

    it('should update consent successfully and return 200 with updated versions', async () => {
      querySpy.mockResolvedValueOnce({ rows: [mockUser] }); // auth check
      querySpy.mockResolvedValueOnce({
        rows: [
          {
            id: mockUser.id,
            email: mockUser.email,
            terms_version: '1.1',
            privacy_version: '1.2',
          },
        ],
      }); // update query

      const res = await request(app)
        .put('/user/consent')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ terms_version: '1.1', privacy_version: '1.2' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user.terms_version).toBe('1.1');
      expect(res.body.user.privacy_version).toBe('1.2');
    });
  });

  describe('GET /user/me with terms and privacy versions', () => {
    it('should include terms_version and privacy_version in user profile', async () => {
      querySpy.mockResolvedValueOnce({ rows: [mockUser] }); // auth check

      const res = await request(app)
        .get('/user/me')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.user.terms_version).toBe('1.0');
      expect(res.body.user.privacy_version).toBe('1.0');
    });
  });
});
