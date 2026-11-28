import { jest, describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import http from 'node:http';
import request from 'supertest';
import crypto from 'node:crypto';
import { io as ioClient } from 'socket.io-client';
import app from '../src/app.js';
import { pool } from '../src/db/index.js';
import { settingsRegistry, compareSemver } from '../src/services/settings.service.js';
import { generateAccessToken, generateAdminToken } from '../src/utils/token.js';
import { callSessionManager } from '../src/socket/callSessionManager.js';
import { initSocketServer } from '../src/socket/index.js';
import { deductCallMinute } from '../src/services/billing.service.js';
import { processReportAutoModeration } from '../src/services/moderation.service.js';
import { sendIncomingCallPush, expo } from '../src/services/push.js';

describe('Settings Registry System & Dynamic Configuration', () => {
  let adminUser;
  let adminToken;
  let normalUser;
  let normalUserToken;

  beforeAll(async () => {
    // 1. Initialize settings registry cache from DB/defaults
    await settingsRegistry.init();

    // 2. Create or fetch test admin user
    const adminRes = await pool.query(`
      INSERT INTO admin_users (id, email, password_hash, role, is_active)
      VALUES ('a0000000-0000-0000-0000-000000000001', 'settings-admin@example.com', 'dummy_hash', 'superadmin', TRUE)
      ON CONFLICT (email) DO UPDATE SET is_active = TRUE
      RETURNING id, email, role;
    `);
    adminUser = adminRes.rows[0];
    adminToken = generateAdminToken(adminUser);

    // 3. Create regular user
    normalUser = {
      id: crypto.randomUUID(),
      email: 'normal-settings-user@example.com',
      role: 'user',
    };
    normalUserToken = generateAccessToken(normalUser);
  });

  afterAll(async () => {
    // Reset test overrides
    try {
      await settingsRegistry.reset('maintenance_mode_enabled', { adminId: adminUser.id });
    } catch {}
    try {
      await settingsRegistry.reset('min_supported_mobile_version', { adminId: adminUser.id });
    } catch {}
    try {
      await settingsRegistry.reset('cooldown_same_peer_seconds', { adminId: adminUser.id });
    } catch {}
    try {
      await settingsRegistry.reset('ring_timeout_seconds', { adminId: adminUser.id });
    } catch {}
    try {
      await settingsRegistry.reset('monetization_mode', { adminId: adminUser.id });
    } catch {}

    await pool.query('DELETE FROM admin_users WHERE email = $1;', ['settings-admin@example.com']).catch(() => {});
    await pool.end().catch(() => {});
  });

  describe('SemVer Numerical Comparison Helper', () => {
    it('should correctly compare numerical SemVer versions', () => {
      expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
      expect(compareSemver('1.1.0', '1.0.0')).toBeGreaterThan(0);
      expect(compareSemver('1.0.0', '1.1.0')).toBeLessThan(0);
      // Numerical vs lexicographical check (1.10.0 > 1.2.0)
      expect(compareSemver('1.10.0', '1.2.0')).toBeGreaterThan(0);
      expect(compareSemver('1.2.0', '1.10.0')).toBeLessThan(0);
      expect(compareSemver('2.0.0', '1.99.99')).toBeGreaterThan(0);
      expect(compareSemver('1.0.5', '1.0.12')).toBeLessThan(0);
    });
  });

  describe('Authentication & Authorization Access Control', () => {
    it('GET /admin/settings rejects unauthenticated requests with 401', async () => {
      const res = await request(app).get('/admin/settings');
      expect(res.status).toBe(401);
    });

    it('GET /admin/settings rejects normal user token with 403', async () => {
      const res = await request(app)
        .get('/admin/settings')
        .set('Authorization', `Bearer ${normalUserToken}`);
      expect(res.status).toBe(403);
    });

    it('PUT /admin/settings/:key rejects unauthenticated requests with 401', async () => {
      const res = await request(app)
        .put('/admin/settings/ring_timeout_seconds')
        .send({ value: 45 });
      expect(res.status).toBe(401);
    });

    it('PUT /admin/settings/:key rejects normal user token with 403', async () => {
      const res = await request(app)
        .put('/admin/settings/ring_timeout_seconds')
        .set('Authorization', `Bearer ${normalUserToken}`)
        .send({ value: 45 });
      expect(res.status).toBe(403);
    });

    it('DELETE /admin/settings/:key rejects unauthenticated requests with 401', async () => {
      const res = await request(app).delete('/admin/settings/ring_timeout_seconds');
      expect(res.status).toBe(401);
    });

    it('DELETE /admin/settings/:key rejects normal user token with 403', async () => {
      const res = await request(app)
        .delete('/admin/settings/ring_timeout_seconds')
        .set('Authorization', `Bearer ${normalUserToken}`);
      expect(res.status).toBe(403);
    });

    it('GET /admin/settings/history rejects normal user token with 403', async () => {
      const res = await request(app)
        .get('/admin/settings/history')
        .set('Authorization', `Bearer ${normalUserToken}`);
      expect(res.status).toBe(403);
    });

    it('GET /admin/settings/status returns environment and SMS configuration status for admin', async () => {
      const res = await request(app)
        .get('/admin/settings/status')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('sms_provider_configured');
      expect(res.body).toHaveProperty('environment');
    });
  });

  describe('Validation & Out-of-Range Rejection', () => {
    it('rejects unknown setting key with 400', async () => {
      const res = await request(app)
        .put('/admin/settings/non_existent_key')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ value: 123 });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Unknown setting key');
    });

    it('rejects ring_timeout_seconds below min (5) with 400', async () => {
      const res = await request(app)
        .put('/admin/settings/ring_timeout_seconds')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ value: 4 });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('BadRequest');
    });

    it('rejects ring_timeout_seconds above max (120) with 400', async () => {
      const res = await request(app)
        .put('/admin/settings/ring_timeout_seconds')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ value: 150 });
      expect(res.status).toBe(400);
    });

    it('rejects non-integer ring_timeout_seconds with 400', async () => {
      const res = await request(app)
        .put('/admin/settings/ring_timeout_seconds')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ value: 30.5 });
      expect(res.status).toBe(400);
    });

    it('rejects invalid enum value for monetization_mode with 400', async () => {
      const res = await request(app)
        .put('/admin/settings/monetization_mode')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ value: 'crypto_only' });
      expect(res.status).toBe(400);
    });

    it('rejects invalid subscription_plans shape with 400', async () => {
      const res = await request(app)
        .put('/admin/settings/subscription_plans')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          value: [{ id: 'plan-1', name: 'Test', price: -10, duration_days: 30, active: true }],
        });
      expect(res.status).toBe(400);
    });

    it('rejects subscription_plans missing required fields with 400', async () => {
      const res = await request(app)
        .put('/admin/settings/subscription_plans')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          value: [{ id: 'plan-1', name: 'Test' }], // missing price, duration_days, active
        });
      expect(res.status).toBe(400);
    });

    it('rejects maintenance_mode_message that is too long (>500 chars) or empty', async () => {
      const longMsg = 'a'.repeat(600);
      const res = await request(app)
        .put('/admin/settings/maintenance_mode_message')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ value: longMsg });
      expect(res.status).toBe(400);

      const emptyRes = await request(app)
        .put('/admin/settings/maintenance_mode_message')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ value: '' });
      expect(emptyRes.status).toBe(400);
    });
  });

  describe('Update, Instant Cache Propagation & Audit Logging', () => {
    it('successfully updates a setting, updates cache immediately, and records audit trail', async () => {
      const newTimeout = 42;
      const res = await request(app)
        .put('/admin/settings/ring_timeout_seconds')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ value: newTimeout });

      expect(res.status).toBe(200);
      expect(res.body.key).toBe('ring_timeout_seconds');
      expect(res.body.value).toBe(newTimeout);

      // Verify in-memory cache updated immediately (0ms lookup)
      expect(settingsRegistry.get('ring_timeout_seconds')).toBe(newTimeout);

      // Verify derived stuck ringing cleanup is ring_timeout_seconds + 30
      expect(settingsRegistry.getDerivedStuckRingingCleanupSeconds()).toBe(newTimeout + 30);

      // Verify override row in DB
      const { rows: dbRows } = await pool.query(
        'SELECT value_json FROM app_settings WHERE key = $1;',
        ['ring_timeout_seconds']
      );
      expect(dbRows.length).toBe(1);
      expect(dbRows[0].value_json).toBe(newTimeout);

      // Verify audit entry in settings_audit
      const { rows: auditRows } = await pool.query(
        'SELECT * FROM settings_audit WHERE key = $1 ORDER BY created_at DESC LIMIT 1;',
        ['ring_timeout_seconds']
      );
      expect(auditRows.length).toBe(1);
      expect(auditRows[0].key).toBe('ring_timeout_seconds');
      expect(auditRows[0].new_value).toBe(newTimeout);
      expect(auditRows[0].admin_email).toBe('settings-admin@example.com');
    });

    it('GET /admin/settings/history returns audit log entries', async () => {
      const res = await request(app)
        .get('/admin/settings/history?key=ring_timeout_seconds')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('history');
      expect(Array.isArray(res.body.history)).toBe(true);
      expect(res.body.history.length).toBeGreaterThan(0);
      expect(res.body.history[0].key).toBe('ring_timeout_seconds');
    });
  });

  describe('Reset Setting to Code Default', () => {
    it('DELETE /admin/settings/:key deletes override row, logs audit, and restores code default in cache', async () => {
      // First ensure it was overridden to 42
      expect(settingsRegistry.get('ring_timeout_seconds')).toBe(42);

      const res = await request(app)
        .delete('/admin/settings/ring_timeout_seconds')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('reset to default');
      expect(res.body.default_value).toBe(30);

      // Verify in-memory cache restored to code default (30)
      expect(settingsRegistry.get('ring_timeout_seconds')).toBe(30);

      // Verify DB override row is deleted
      const { rows: dbRows } = await pool.query(
        'SELECT * FROM app_settings WHERE key = $1;',
        ['ring_timeout_seconds']
      );
      expect(dbRows.length).toBe(0);

      // Verify audit log entry for reset
      const { rows: auditRows } = await pool.query(
        'SELECT * FROM settings_audit WHERE key = $1 ORDER BY created_at DESC LIMIT 1;',
        ['ring_timeout_seconds']
      );
      expect(auditRows.length).toBe(1);
      expect(auditRows[0].new_value).toBe(30);
    });
  });

  describe('Cache Atomicity on Failed DB Transaction', () => {
    it('does not mutate in-memory cache if DB transaction fails', async () => {
      const originalValue = settingsRegistry.get('ring_timeout_seconds');
      const failingPool = {
        connect: async () => {
          const realClient = await pool.connect();
          return {
            query: async (text, params) => {
              if (typeof text === 'string' && text.includes('INSERT INTO settings_audit')) {
                throw new Error('Simulated DB audit crash');
              }
              return realClient.query(text, params);
            },
            release: () => realClient.release(),
          };
        },
      };

      await expect(
        settingsRegistry.update('ring_timeout_seconds', 75, {
          adminId: adminUser.id,
          customPool: failingPool,
        })
      ).rejects.toThrow('Simulated DB audit crash');

      // In-memory cache must remain unchanged!
      expect(settingsRegistry.get('ring_timeout_seconds')).toBe(originalValue);
    });
  });

  describe('Public Configuration Endpoint (GET /api/v1/config/public)', () => {
    it('returns only public settings and report_note_max_length, with Cache-Control: no-store', async () => {
      const res = await request(app).get('/api/v1/config/public');

      expect(res.status).toBe(200);
      // Header check: must have no-store
      expect(res.headers['cache-control']).toContain('no-store');

      const body = res.body;

      // Check public fields exist
      expect(body).toHaveProperty('monetization');
      expect(body.monetization).toHaveProperty('mode');
      expect(body.monetization).toHaveProperty('rate_per_minute');
      expect(body.monetization).toHaveProperty('currency', 'INR');
      expect(body.monetization).toHaveProperty('subscription_plans');
      expect(Array.isArray(body.monetization.subscription_plans)).toBe(true);

      expect(body).toHaveProperty('auth');
      expect(body.auth).toHaveProperty('registration_enabled');
      expect(body.auth).toHaveProperty('email_login_enabled');
      expect(body.auth).toHaveProperty('mobile_login_enabled');
      expect(body.auth).toHaveProperty('password_min_length');

      expect(body).toHaveProperty('calls');
      expect(body.calls).toHaveProperty('ring_timeout_seconds');
      expect(body.calls).toHaveProperty('max_call_duration_seconds');
      expect(body.calls).toHaveProperty('disconnect_grace_period_seconds');

      expect(body).toHaveProperty('maintenance');
      expect(body.maintenance).toHaveProperty('enabled');
      expect(body.maintenance).toHaveProperty('message');

      expect(body).toHaveProperty('version_gating');
      expect(body.version_gating).toHaveProperty('min_supported_version');
      expect(body.version_gating).toHaveProperty('force_update_url');

      expect(body).toHaveProperty('legal');
      expect(body.legal).toHaveProperty('min_registration_age', 18);
      expect(body.legal).toHaveProperty('privacy_policy_url');
      expect(body.legal).toHaveProperty('terms_of_service_url');

      expect(body).toHaveProperty('moderation');
      expect(body.moderation).toHaveProperty('report_note_max_length', 1000);

      // Strict security check: NO private settings exposed anywhere in response
      const bodyJson = JSON.stringify(body);
      const privateKeys = [
        'cooldown_same_peer_seconds',
        'rate_limit_call_find_per_min',
        'rate_limit_auth_per_min',
        'rate_limit_socket_events_per_sec',
        'socket_max_payload_bytes',
        'otp_max_verify_attempts',
        'auto_suspend_report_threshold',
        'call_history_retention_days',
      ];

      for (const privKey of privateKeys) {
        expect(bodyJson).not.toContain(`"${privKey}"`);
      }
    });

    it('is also accessible via /v1/config/public', async () => {
      const res = await request(app).get('/v1/config/public');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('monetization');
      expect(res.body).toHaveProperty('version_gating');
    });
  });

  describe('Migration Preservation of Subscription Plans', () => {
    it('preserves subscription plans from migration', () => {
      const plans = settingsRegistry.get('subscription_plans');
      expect(Array.isArray(plans)).toBe(true);
      expect(plans.length).toBeGreaterThanOrEqual(2);
      const planNames = plans.map((p) => p.name);
      expect(planNames).toContain('Starter Pass');
      expect(planNames).toContain('Unlimited Monthly');
    });
  });

  describe('Maintenance Mode Enforcement & Exemptions', () => {
    beforeAll(async () => {
      await settingsRegistry.update('maintenance_mode_enabled', true, {
        adminId: adminUser.id,
      });
      await settingsRegistry.update('maintenance_mode_message', 'Under scheduled upgrade', {
        adminId: adminUser.id,
      });
    });

    afterAll(async () => {
      await settingsRegistry.reset('maintenance_mode_enabled', { adminId: adminUser.id });
      await settingsRegistry.reset('maintenance_mode_message', { adminId: adminUser.id });
    });

    it('exempts /health from maintenance mode', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('healthy');
    });

    it('exempts /api/v1/config/public so client can check maintenance flag', async () => {
      const res = await request(app).get('/api/v1/config/public');
      expect(res.status).toBe(200);
      expect(res.body.maintenance.enabled).toBe(true);
      expect(res.body.maintenance.message).toBe('Under scheduled upgrade');
    });

    it('exempts /admin routes and admin login during maintenance', async () => {
      const res = await request(app)
        .get('/admin/settings')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
    });

    it('blocks new user registrations with 503 during maintenance', async () => {
      const res = await request(app)
        .post('/auth/register')
        .send({
          email: 'blocked-maintenance@example.com',
          password: 'Password123!',
          confirm_age_18: true,
        });
      expect(res.status).toBe(503);
      expect(res.body.error).toBe('ServiceUnavailable');
      expect(res.body.message).toBe('Under scheduled upgrade');
    });

    it('blocks user email login with 503 during maintenance', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({
          email: 'user@example.com',
          password: 'Password123!',
        });
      expect(res.status).toBe(503);
      expect(res.body.error).toBe('ServiceUnavailable');
    });

    it('blocks user mobile OTP request with 503 during maintenance', async () => {
      const res = await request(app)
        .post('/auth/otp/request')
        .send({ phone: '+919876543210' });
      expect(res.status).toBe(503);
    });
  });

  describe('Version Gating Enforcement', () => {
    beforeAll(async () => {
      await settingsRegistry.update('min_supported_mobile_version', '2.0.0', {
        adminId: adminUser.id,
      });
      await settingsRegistry.update('force_update_store_url_android', 'https://play.google.com/store/apps/custom', {
        adminId: adminUser.id,
      });
    });

    afterAll(async () => {
      await settingsRegistry.reset('min_supported_mobile_version', { adminId: adminUser.id });
      await settingsRegistry.reset('force_update_store_url_android', { adminId: adminUser.id });
    });

    it('rejects client below min_supported_mobile_version with 426 Upgrade Required', async () => {
      const res = await request(app)
        .post('/auth/login')
        .set('X-App-Version', '1.9.5')
        .send({
          email: 'user@example.com',
          password: 'Password123!',
        });

      expect(res.status).toBe(426);
      expect(res.body.statusCode).toBe(426);
      expect(res.body.error).toBe('UpgradeRequired');
      expect(res.body.min_version).toBe('2.0.0');
      expect(res.body.force_update_url).toBe('https://play.google.com/store/apps/custom');
    });

    it('allows client with equal or higher version through to normal endpoint logic', async () => {
      const res = await request(app)
        .post('/auth/login')
        .set('X-App-Version', '2.0.0')
        .send({
          email: 'nonexistent@example.com',
          password: 'Password123!',
        });

      // Should not be blocked by 426 (proceeds to auth check -> 401)
      expect(res.status).toBe(401);
    });

    it('allows higher semver client (2.1.0 > 2.0.0) through', async () => {
      const res = await request(app)
        .post('/auth/login')
        .set('X-App-Version', '2.1.0')
        .send({
          email: 'nonexistent@example.com',
          password: 'Password123!',
        });

      expect(res.status).toBe(401);
    });
  });

  describe('User Registration Switch (user_registration_enabled)', () => {
    beforeAll(async () => {
      await settingsRegistry.update('user_registration_enabled', false, {
        adminId: adminUser.id,
      });
    });

    afterAll(async () => {
      await settingsRegistry.reset('user_registration_enabled', { adminId: adminUser.id });
    });

    it('blocks user registration with 403 Forbidden when switch is disabled', async () => {
      const res = await request(app)
        .post('/auth/register')
        .send({
          email: 'tryregister@example.com',
          password: 'Password123!',
          confirm_age_18: true,
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Forbidden');
      expect(res.body.message).toContain('registrations are temporarily paused');
    });
  });

  describe('Dynamic Password Minimum Length (user_password_min_length)', () => {
    beforeAll(async () => {
      await settingsRegistry.update('user_password_min_length', 12, {
        adminId: adminUser.id,
      });
    });

    afterAll(async () => {
      await settingsRegistry.reset('user_password_min_length', { adminId: adminUser.id });
    });

    it('rejects password shorter than dynamic minimum (10 chars < 12) with 400', async () => {
      const res = await request(app)
        .post('/auth/register')
        .send({
          email: `pwdtest-${Date.now()}@example.com`,
          password: 'Short12345!', // 11 characters (< 12)
          confirm_age_18: true,
        });

      expect(res.status).toBe(400);
      expect(res.body.message || res.body.error).toContain('12');
    });
  });

  describe('Dynamic Free Trial Minutes (free_trial_minutes_new_user)', () => {
    const testEmail = `trialuser-${Date.now()}@example.com`;

    beforeAll(async () => {
      await settingsRegistry.update('free_trial_minutes_new_user', 25, {
        adminId: adminUser.id,
      });
    });

    afterAll(async () => {
      await settingsRegistry.reset('free_trial_minutes_new_user', { adminId: adminUser.id });
      await pool.query('DELETE FROM users WHERE email = $1;', [testEmail]).catch(() => {});
    });

    it('initializes wallet with dynamically configured trial minutes (25)', async () => {
      const res = await request(app)
        .post('/auth/register')
        .send({
          email: testEmail,
          password: 'ValidPassword123!',
          confirm_age_18: true,
        });

      expect(res.status).toBe(201);
      const userId = res.body.user.id;

      const { rows } = await pool.query(
        'SELECT free_trial_minutes FROM wallets WHERE user_id = $1;',
        [userId]
      );
      expect(rows.length).toBe(1);
      expect(Number(rows[0].free_trial_minutes)).toBe(25);
    });
  });

  describe('Call Session Snapshots & Rate Immutability', () => {
    let testCallerId, testCalleeId, testCallCode, testSessionId;

    beforeAll(async () => {
      testCallerId = crypto.randomUUID();
      testCalleeId = crypto.randomUUID();
      testCallCode = crypto.randomUUID();
      testSessionId = crypto.randomUUID();

      await pool.query(`
        INSERT INTO users (id, email, password_hash, status, is_available)
        VALUES 
          ($1, 'caller-snapshot@example.com', 'dummy_hash', 'active', true),
          ($2, 'callee-snapshot@example.com', 'dummy_hash', 'active', true)
        ON CONFLICT DO NOTHING;
      `, [testCallerId, testCalleeId]);

      await pool.query(`
        INSERT INTO wallets (user_id, balance_amount, balance_minutes, free_trial_minutes)
        VALUES ($1, 50.00, 0, 0)
        ON CONFLICT (user_id) DO UPDATE SET balance_amount = 50.00, free_trial_minutes = 0;
      `, [testCallerId]);

      // Snapshot rate is 2.00 INR
      await pool.query(`
        INSERT INTO call_sessions (
          id, call_code, caller_id, callee_id, status, 
          snapshot_mode, snapshot_rate_per_minute, snapshot_ring_timeout, snapshot_max_duration, snapshot_currency
        )
        VALUES ($1, $2, $3, $4, 'connected', 'per_minute', 2.00, 30, 3600, 'INR');
      `, [testSessionId, testCallCode, testCallerId, testCalleeId]);
    });

    afterAll(async () => {
      await settingsRegistry.reset('billing_rate_per_minute', { adminId: adminUser.id });
      await pool.query('DELETE FROM call_sessions WHERE id = $1;', [testSessionId]).catch(() => {});
      await pool.query('DELETE FROM wallets WHERE user_id = $1;', [testCallerId]).catch(() => {});
      await pool.query('DELETE FROM users WHERE id IN ($1, $2);', [testCallerId, testCalleeId]).catch(() => {});
    });

    it('charges the snapshotted rate (2.00) even when live registry rate changes to 15.00', async () => {
      // Live rate changed by admin to 15.00
      await settingsRegistry.update('billing_rate_per_minute', 15.00, {
        adminId: adminUser.id,
      });

      const deduction = await deductCallMinute(pool, {
        callCode: testCallCode,
        callerId: testCallerId,
        sessionId: testSessionId,
      });

      expect(deduction.success).toBe(true);

      const { rows } = await pool.query(
        'SELECT balance_amount FROM wallets WHERE user_id = $1;',
        [testCallerId]
      );
      // 50.00 - 2.00 = 48.00 (NOT 50 - 15 = 35)
      expect(Number(rows[0].balance_amount)).toBe(48.00);
    });
  });

  describe('Max Call Duration Hard Stop Timer', () => {
    it('triggers callback with reason max_duration when timer fires', (done) => {
      const code = crypto.randomUUID();
      callSessionManager.createSession({
        sessionId: crypto.randomUUID(),
        callCode: code,
        callerId: crypto.randomUUID(),
        calleeId: crypto.randomUUID(),
        snapshotMaxDuration: 1, // 1 second hard cap
        onMaxDuration: (s) => {
          expect(s.callCode).toBe(code);
          callSessionManager.endSession(code);
          done();
        },
      });

      callSessionManager.markConnected(code);
    });
  });

  describe('Moderation Thresholds & Auto-Suspension', () => {
    let reportedUserId;

    beforeAll(async () => {
      reportedUserId = crypto.randomUUID();
      await pool.query(`
        INSERT INTO users (id, email, password_hash, status, is_available)
        VALUES ($1, 'abusive-user@example.com', 'dummy_hash', 'active', true);
      `, [reportedUserId]);

      await settingsRegistry.update('auto_suspend_report_threshold', 2, {
        adminId: adminUser.id,
      });
      await settingsRegistry.update('auto_suspension_duration_hours', 24, {
        adminId: adminUser.id,
      });
    });

    afterAll(async () => {
      await settingsRegistry.reset('auto_suspend_report_threshold', { adminId: adminUser.id });
      await settingsRegistry.reset('auto_suspension_duration_hours', { adminId: adminUser.id });
      await pool.query('DELETE FROM reports WHERE reported_id = $1;', [reportedUserId]).catch(() => {});
      await pool.query('DELETE FROM users WHERE id = $1;', [reportedUserId]).catch(() => {});
    });

    it('automatically suspends user and sets suspended_until when report threshold is reached', async () => {
      const reporter1 = crypto.randomUUID();
      const reporter2 = crypto.randomUUID();
      const testSessionId = crypto.randomUUID();
      const testCallCode = crypto.randomUUID();

      await pool.query(`
        INSERT INTO users (id, email, password_hash, status)
        VALUES 
          ($1, $2, 'h', 'active'),
          ($3, $4, 'h', 'active');
      `, [reporter1, `rep1-${Date.now()}@example.com`, reporter2, `rep2-${Date.now()}@example.com`]);

      await pool.query(`
        INSERT INTO call_sessions (id, call_code, caller_id, callee_id, status)
        VALUES ($1, $2, $3, $4, 'ended')
        ON CONFLICT DO NOTHING;
      `, [testSessionId, testCallCode, reporter1, reportedUserId]);

      // Report 1
      await pool.query(`
        INSERT INTO reports (reporter_id, reported_id, call_session_id, reason, status)
        VALUES ($1, $2, $3, 'harassment', 'pending');
      `, [reporter1, reportedUserId, testSessionId]);

      const res1 = await processReportAutoModeration(reportedUserId, pool);
      expect(res1.status).toBe('none');

      // Report 2 -> hits threshold (2)
      await pool.query(`
        INSERT INTO reports (reporter_id, reported_id, call_session_id, reason, status)
        VALUES ($1, $2, $3, 'abusive_language', 'pending');
      `, [reporter2, reportedUserId, testSessionId]);

      const res2 = await processReportAutoModeration(reportedUserId, pool);
      expect(res2.status).toBe('suspended');

      const { rows } = await pool.query(
        'SELECT status, suspended_until, is_flagged FROM users WHERE id = $1;',
        [reportedUserId]
      );
      expect(rows[0].status).toBe('suspended');
      expect(rows[0].suspended_until).not.toBeNull();
      expect(rows[0].is_flagged).toBe(true);

      // Verify audit trail entry was recorded
      const { rows: auditRows } = await pool.query(
        "SELECT * FROM settings_audit WHERE key = 'auto_suspend_user' AND old_value::text LIKE $1;",
        [`%${reportedUserId}%`]
      );
      expect(auditRows.length).toBeGreaterThanOrEqual(1);

      await pool.query('DELETE FROM users WHERE id IN ($1, $2);', [reporter1, reporter2]).catch(() => {});
    });
  });

  describe('Suspended User Rejection across Auth & Sockets', () => {
    let suspendedId;
    let suspendedEmail;
    let suspendedToken;
    let socketServer;
    let socketIo;
    let socketPort;

    beforeAll((done) => {
      suspendedId = crypto.randomUUID();
      suspendedEmail = `suspended-${Date.now()}@example.com`;

      pool.query(`
        INSERT INTO users (id, email, password_hash, status, suspended_until)
        VALUES ($1, $2, 'dummy_hash', 'suspended', CURRENT_TIMESTAMP + INTERVAL '12 hours');
      `, [suspendedId, suspendedEmail]).then(() => {
        suspendedToken = generateAccessToken({ id: suspendedId, email: suspendedEmail });

        socketServer = http.createServer(app);
        socketIo = initSocketServer(socketServer);
        socketServer.listen(0, () => {
          socketPort = socketServer.address().port;
          done();
        });
      });
    });

    afterAll((done) => {
      pool.query('DELETE FROM users WHERE id = $1;', [suspendedId]).catch(() => {});
      if (socketIo) socketIo.close();
      if (socketServer) socketServer.close(done);
      else done();
    });

    it('rejects login for suspended user with 403 and account_suspended error', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({
          email: suspendedEmail,
          password: 'AnyPassword123!',
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Forbidden');
      expect(res.body.message).toContain('suspended');
      expect(res.body).toHaveProperty('suspended_until');
    });

    it('rejects socket connection for suspended user with authentication error', (done) => {
      const client = ioClient(`http://127.0.0.1:${socketPort}`, {
        transports: ['websocket'],
        reconnection: false,
        auth: { token: suspendedToken },
      });

      client.on('connect_error', (err) => {
        expect(err.message).toContain('suspended');
        client.disconnect();
        done();
      });

      client.on('connect', () => {
        client.disconnect();
        done(new Error('Suspended user should not have connected'));
      });
    });
  });

  describe('Dynamic Push Notification Copy (push_notification_title, push_notification_body)', () => {
    let sendSpy;

    beforeAll(async () => {
      await settingsRegistry.update('push_notification_title', 'Encrypted Call Alert', {
        adminId: adminUser.id,
      });
      await settingsRegistry.update('push_notification_body', 'Incoming private conversation', {
        adminId: adminUser.id,
      });

      sendSpy = jest.spyOn(expo, 'sendPushNotificationsAsync').mockResolvedValue([{ status: 'ok', id: 'fake-ticket-1' }]);
    });

    afterAll(async () => {
      if (sendSpy) sendSpy.mockRestore();
      await settingsRegistry.reset('push_notification_title', { adminId: adminUser.id });
      await settingsRegistry.reset('push_notification_body', { adminId: adminUser.id });
    });

    it('reads custom push notification title and body dynamically from registry', async () => {
      const dummyToken = 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]';
      const fakeSessionId = crypto.randomUUID();

      await sendIncomingCallPush(dummyToken, fakeSessionId);

      expect(sendSpy).toHaveBeenCalled();
      const dispatchedMessage = sendSpy.mock.calls[0][0][0];
      expect(dispatchedMessage.title).toBe('Encrypted Call Alert');
      expect(dispatchedMessage.body).toBe('Incoming private conversation');
      expect(dispatchedMessage.ttl).toBe(settingsRegistry.get('ring_timeout_seconds'));
    });
  });
});
