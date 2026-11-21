import { jest, describe, it, expect, beforeEach, afterEach, test } from '@jest/globals';
import request from 'supertest';
import bcrypt from 'bcrypt';
import app from '../src/app.js';
import { pool } from '../src/db/index.js';
import { generateAccessToken, generateAdminToken } from '../src/utils/token.js';

describe('Admin Authorization & Endpoints', () => {
  let querySpy;

  const mockAdmin = {
    id: 'admin-uuid-0001',
    email: 'admin@example.com',
    role: 'superadmin',
    is_active: true,
  };

  const mockNormalUser = {
    id: 'user-uuid-9999',
    email: 'normaluser@example.com',
    role: 'user',
  };

  let validAdminToken;
  let normalUserToken;

  beforeEach(() => {
    validAdminToken = generateAdminToken(mockAdmin);
    normalUserToken = generateAccessToken(mockNormalUser);
    querySpy = jest.spyOn(pool, 'query');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('POST /admin/auth/login', () => {
    it('should return 400 if credentials are empty', async () => {
      const res = await request(app).post('/admin/auth/login').send({});
      expect(res.status).toBe(400);
    });

    it('should return 401 if admin email is not found', async () => {
      querySpy.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .post('/admin/auth/login')
        .send({ email: 'fake@example.com', password: 'Password123!' });

      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Invalid admin credentials');
    });

    it('should return 401 on incorrect password', async () => {
      const hash = await bcrypt.hash('CorrectPass123!', 10);
      querySpy.mockResolvedValueOnce({
        rows: [
          {
            id: mockAdmin.id,
            email: mockAdmin.email,
            password_hash: hash,
            role: 'superadmin',
            is_active: true,
          },
        ],
      });

      const res = await request(app)
        .post('/admin/auth/login')
        .send({ email: mockAdmin.email, password: 'WrongPassword!' });

      expect(res.status).toBe(401);
    });

    it('should authenticate admin and return 200 with admin token', async () => {
      const hash = await bcrypt.hash('AdminPassword123!', 10);
      querySpy
        .mockResolvedValueOnce({
          rows: [
            {
              id: mockAdmin.id,
              email: mockAdmin.email,
              password_hash: hash,
              role: 'superadmin',
              is_active: true,
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }); // update last_login_at

      const res = await request(app)
        .post('/admin/auth/login')
        .send({ email: mockAdmin.email, password: 'AdminPassword123!' });

      expect(res.status).toBe(200);
      expect(res.body.admin).toBeDefined();
      expect(res.body.admin.email).toBe(mockAdmin.email);
      expect(res.body.admin.role).toBe('superadmin');
      expect(res.body.token).toBeDefined();
    });
  });

  describe('Security: Admin Route Access Control', () => {
    const adminEndpoints = [
      { method: 'get', path: '/admin/settings' },
      { method: 'get', path: '/admin/stats' },
      { method: 'get', path: '/admin/users' },
      { method: 'get', path: '/admin/reports' },
    ];

    test.each(adminEndpoints)(
      'Unauthenticated request to %s %s should return 401 Unauthorized',
      async ({ method, path }) => {
        const res = await request(app)[method](path);
        expect(res.status).toBe(401);
        expect(res.body.message).toContain('Admin authorization token is missing or malformed');
      }
    );

    test.each(adminEndpoints)(
      'Normal User Token on %s %s must be strictly rejected with 403 Forbidden',
      async ({ method, path }) => {
        const res = await request(app)[method](path).set('Authorization', `Bearer ${normalUserToken}`);

        expect(res.status).toBe(403);
        expect(res.body.message).toBe('Admin access required. User tokens are not allowed on admin routes.');
      }
    );

    it('should reject deactivated admin with 403 Forbidden', async () => {
      querySpy.mockResolvedValueOnce({
        rows: [{ ...mockAdmin, is_active: false }],
      });

      const res = await request(app)
        .get('/admin/settings')
        .set('Authorization', `Bearer ${validAdminToken}`);

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('deactivated or not found');
    });
  });

  describe('Authenticated Admin Endpoints', () => {
    it('GET /admin/settings should return settings object when authenticated with Admin token', async () => {
      querySpy
        .mockResolvedValueOnce({ rows: [mockAdmin] }) // auth check
        .mockResolvedValueOnce({
          rows: [
            { key: 'monetization', value_json: { mode: 'free' } },
            { key: 'auth_settings', value_json: { mobile_login_enabled: false } },
          ],
        });

      const res = await request(app)
        .get('/admin/settings')
        .set('Authorization', `Bearer ${validAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.monetization).toEqual({ mode: 'free' });
      expect(res.body.auth_settings).toEqual({ mobile_login_enabled: false });
    });

    it('PUT /admin/settings/:key should update setting when authenticated with Admin token', async () => {
      querySpy
        .mockResolvedValueOnce({ rows: [mockAdmin] }) // auth check
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ key: 'monetization' }] }); // update setting

      const res = await request(app)
        .put('/admin/settings/monetization')
        .set('Authorization', `Bearer ${validAdminToken}`)
        .send({ value_json: { mode: 'per_minute', per_minute_rate: 1.5 } });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Setting updated successfully');
      expect(res.body.key).toBe('monetization');
    });

    it('GET /admin/stats should return dashboard statistics', async () => {
      querySpy
        .mockResolvedValueOnce({ rows: [mockAdmin] }) // auth check
        .mockResolvedValueOnce({ rows: [{ count: 120 }] }) // total users
        .mockResolvedValueOnce({ rows: [{ count: 15 }] }) // available users
        .mockResolvedValueOnce({ rows: [{ count: 2 }] }) // active calls
        .mockResolvedValueOnce({ rows: [{ count: 45 }] }) // today calls
        .mockResolvedValueOnce({ rows: [{ count: 38 }] }) // today connected
        .mockResolvedValueOnce({ rows: [{ seconds: 3600 }] }) // today seconds
        .mockResolvedValueOnce({ rows: [{ revenue: '150.00' }] }) // today revenue
        .mockResolvedValueOnce({ rows: [{ count: 1 }] }) // pending reports
        .mockResolvedValueOnce({ rows: [{ count: 3 }] }); // banned users

      const res = await request(app)
        .get('/admin/stats')
        .set('Authorization', `Bearer ${validAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.overview).toBeDefined();
      expect(res.body.overview.total_registered_users).toBe(120);
      expect(res.body.today_metrics.total_call_minutes).toBe(60);
      expect(res.body.safety_metrics.pending_reports_count).toBe(1);
    });
  });
});
