import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import crypto from 'node:crypto';
import app from '../src/app.js';
import { pool } from '../src/db/index.js';
import { matchCaller, clearMatchingSettingsCache } from '../src/services/matching.service.js';
import { generateAccessToken, generateAdminToken } from '../src/utils/token.js';
import { callSessionManager } from '../src/socket/callSessionManager.js';
import { userSocketMap } from '../src/socket/userSocketMap.js';

describe('Configurable Same-Peer Rematch Cooldown (matching_settings)', () => {
  let adminUser;
  let adminToken;
  let regularUser;
  let regularUserToken;

  let testCallerId;
  let testCalleeId;

  beforeAll(async () => {
    // 1. Create or get admin for authenticated admin endpoints
    const adminRes = await pool.query(`
      INSERT INTO admin_users (email, password_hash, role, is_active)
      VALUES ('cooldown-admin@example.com', 'dummy_hash', 'superadmin', TRUE)
      ON CONFLICT (email) DO UPDATE SET is_active = TRUE
      RETURNING id, email, role;
    `);
    adminUser = adminRes.rows[0];
    adminToken = generateAdminToken(adminUser);

    // 2. Create regular user
    regularUser = {
      id: crypto.randomUUID(),
      email: 'regular-user@example.com',
      role: 'user',
    };
    regularUserToken = generateAccessToken(regularUser);

    // 3. Ensure free monetization mode is set so checkCallerBillingStanding passes
    await pool.query(`
      INSERT INTO app_settings (key, value_json, description)
      VALUES ('monetization', '{"mode": "free"}'::jsonb, 'Monetization settings')
      ON CONFLICT (key) DO UPDATE SET value_json = '{"mode": "free"}'::jsonb;
    `);
  });

  afterAll(async () => {
    // Clean up created admin and app_settings to default 60
    await pool.query(`
      UPDATE app_settings 
      SET value_json = jsonb_set(value_json, '{cooldown_same_peer_seconds}', '60'::jsonb)
      WHERE key = 'matching_settings';
    `);
    clearMatchingSettingsCache();
    await pool.query('DELETE FROM admin_users WHERE email = $1;', ['cooldown-admin@example.com']);
    await pool.end();
  });

  beforeEach(async () => {
    callSessionManager.clear();
    userSocketMap.clear();
    clearMatchingSettingsCache();

    // Mark any existing users unavailable so only our designated test callee is in the candidate pool
    await pool.query('UPDATE users SET is_available = FALSE;');

    // Create fresh unique caller and callee users in DB
    testCallerId = crypto.randomUUID();
    testCalleeId = crypto.randomUUID();

    await pool.query(`
      INSERT INTO users (id, email, status, is_available)
      VALUES 
        ($1, $2, 'active', TRUE),
        ($3, $4, 'active', TRUE);
    `, [
      testCallerId,
      `caller-${testCallerId.slice(0, 8)}@example.com`,
      testCalleeId,
      `callee-${testCalleeId.slice(0, 8)}@example.com`,
    ]);
  });

  afterEach(async () => {
    // Clean up test call_sessions, blocks, and users
    await pool.query('DELETE FROM call_sessions WHERE caller_id = $1 OR callee_id = $1 OR caller_id = $2 OR callee_id = $2;', [testCallerId, testCalleeId]);
    await pool.query('DELETE FROM blocks WHERE blocker_id = $1 OR blocked_id = $1 OR blocker_id = $2 OR blocked_id = $2;', [testCallerId, testCalleeId]);
    await pool.query('DELETE FROM users WHERE id IN ($1, $2);', [testCallerId, testCalleeId]);
  });

  // =========================================================================
  // 1. Admin Endpoint Access Control
  // =========================================================================
  describe('Admin Authorization: Non-admin tokens cannot change matching_settings', () => {
    it('should reject unauthenticated request with 401', async () => {
      const res = await request(app)
        .put('/admin/settings/matching_settings')
        .send({ value_json: { cooldown_same_peer_seconds: 120 } });

      expect(res.status).toBe(401);
    });

    it('should reject standard user token with 403 Forbidden', async () => {
      const res = await request(app)
        .put('/admin/settings/matching_settings')
        .set('Authorization', `Bearer ${regularUserToken}`)
        .send({ value_json: { cooldown_same_peer_seconds: 120 } });

      expect(res.status).toBe(403);
    });
  });

  // =========================================================================
  // 2. Admin Endpoint Zod Validation: Out-of-range values rejected
  // =========================================================================
  describe('Validation: Out-of-range and invalid values are rejected', () => {
    it('should reject negative cooldown seconds (< 0) with 400', async () => {
      const res = await request(app)
        .put('/admin/settings/matching_settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ value_json: { cooldown_same_peer_seconds: -1 } });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('cooldown_same_peer_seconds');
    });

    it('should reject cooldown seconds greater than 86400 (24h) with 400', async () => {
      const res = await request(app)
        .put('/admin/settings/matching_settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ value_json: { cooldown_same_peer_seconds: 86401 } });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('cooldown_same_peer_seconds');
    });

    it('should reject non-integer float values with 400', async () => {
      const res = await request(app)
        .put('/admin/settings/matching_settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ value_json: { cooldown_same_peer_seconds: 30.5 } });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('integer');
    });

    it('should reject non-numeric string values with 400', async () => {
      const res = await request(app)
        .put('/admin/settings/matching_settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ value_json: { cooldown_same_peer_seconds: 'not-a-number' } });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('cooldown_same_peer_seconds');
    });

    it('should accept valid values between 0 and 86400', async () => {
      const res = await request(app)
        .put('/admin/settings/matching_settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ value_json: { cooldown_same_peer_seconds: 60 } });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Setting updated successfully');
    });
  });

  // =========================================================================
  // 3. Cooldown = 0 Allows Immediate Rematch
  // =========================================================================
  describe('Cooldown = 0: Allows immediate rematch between same peer pair', () => {
    it('should match the same peer immediately when cooldown_same_peer_seconds is 0', async () => {
      // Set cooldown to 0
      await request(app)
        .put('/admin/settings/matching_settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ value_json: { cooldown_same_peer_seconds: 0 } });

      // Insert an ended call session between caller and callee created 2 seconds ago
      await pool.query(`
        INSERT INTO call_sessions (call_code, caller_id, callee_id, status, billing_mode, requested_at, ended_at, created_at)
        VALUES ($1, $2, $3, 'ended', 'free', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
      `, [crypto.randomUUID(), testCallerId, testCalleeId]);

      // Caller attempts to match
      const result = await matchCaller(testCallerId);

      expect(result.success).toBe(true);
      expect(result.callee.id).toBe(testCalleeId);
    });
  });

  // =========================================================================
  // 4. Positive Cooldown Blocks Pair Until Expiry
  // =========================================================================
  describe('Positive Cooldown: Blocks pair until time window expires', () => {
    it('should block rematch while recent session is within cooldown window, then allow after expiry', async () => {
      // Set cooldown to 60 seconds
      await request(app)
        .put('/admin/settings/matching_settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ value_json: { cooldown_same_peer_seconds: 60 } });

      // 1. Insert recent ended call session created 10 seconds ago
      const sessionCode = crypto.randomUUID();
      await pool.query(`
        INSERT INTO call_sessions (call_code, caller_id, callee_id, status, billing_mode, requested_at, ended_at, created_at)
        VALUES ($1, $2, $3, 'ended', 'free', NOW() - INTERVAL '10 seconds', NOW() - INTERVAL '5 seconds', NOW() - INTERVAL '10 seconds');
      `, [sessionCode, testCallerId, testCalleeId]);

      // Call match: must fail because 10s < 60s cooldown
      const blockedResult = await matchCaller(testCallerId);
      expect(blockedResult.success).toBe(false);
      expect(blockedResult.error).toBe('no_users_available');

      // 2. Age the call session to 75 seconds ago (exceeding the 60s cooldown)
      await pool.query(`
        UPDATE call_sessions 
        SET created_at = NOW() - INTERVAL '75 seconds'
        WHERE call_code = $1;
      `, [sessionCode]);

      // Call match again: must now succeed because 75s > 60s
      const allowedResult = await matchCaller(testCallerId);
      expect(allowedResult.success).toBe(true);
      expect(allowedResult.callee.id).toBe(testCalleeId);
    });
  });

  // =========================================================================
  // 5. Dynamic Setting Update Takes Effect on Next Match Without Restart
  // =========================================================================
  describe('Instant Propagation: Setting update takes effect immediately without restart', () => {
    it('should switch from blocked to allowed as soon as admin updates cooldown from 60 to 0', async () => {
      // 1. Initial setting: 60 seconds
      await request(app)
        .put('/admin/settings/matching_settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ value_json: { cooldown_same_peer_seconds: 60 } });

      // Insert recent session created 5 seconds ago
      await pool.query(`
        INSERT INTO call_sessions (call_code, caller_id, callee_id, status, billing_mode, requested_at, ended_at, created_at)
        VALUES ($1, $2, $3, 'ended', 'free', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
      `, [crypto.randomUUID(), testCallerId, testCalleeId]);

      // Under 60s cooldown, peer is blocked
      const firstResult = await matchCaller(testCallerId);
      expect(firstResult.success).toBe(false);
      expect(firstResult.error).toBe('no_users_available');

      // 2. Admin updates setting to 0 via HTTP PUT
      const updateRes = await request(app)
        .put('/admin/settings/matching_settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ value_json: { cooldown_same_peer_seconds: 0 } });
      expect(updateRes.status).toBe(200);

      // 3. Next match attempt immediately allows rematch without restarting server
      const secondResult = await matchCaller(testCallerId);
      expect(secondResult.success).toBe(true);
      expect(secondResult.callee.id).toBe(testCalleeId);
    });
  });

  // =========================================================================
  // 6. Blocked Users Remain Excluded When Cooldown = 0
  // =========================================================================
  describe('Safety Invariant: Blocked users stay excluded even when cooldown is 0', () => {
    it('should strictly exclude candidate if caller has blocked candidate, even with cooldown = 0', async () => {
      // Set cooldown to 0 (all cooldown restrictions disabled)
      await request(app)
        .put('/admin/settings/matching_settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ value_json: { cooldown_same_peer_seconds: 0 } });

      // Insert block: testCaller blocked testCallee
      await pool.query(`
        INSERT INTO blocks (blocker_id, blocked_id)
        VALUES ($1, $2);
      `, [testCallerId, testCalleeId]);

      // Attempt match: must be excluded despite cooldown = 0
      const result = await matchCaller(testCallerId);
      expect(result.success).toBe(false);
      expect(result.error).toBe('no_users_available');
    });

    it('should strictly exclude candidate if candidate has blocked caller, even with cooldown = 0', async () => {
      // Set cooldown to 0
      await request(app)
        .put('/admin/settings/matching_settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ value_json: { cooldown_same_peer_seconds: 0 } });

      // Insert reverse block: testCallee blocked testCaller
      await pool.query(`
        INSERT INTO blocks (blocker_id, blocked_id)
        VALUES ($1, $2);
      `, [testCalleeId, testCallerId]);

      // Attempt match: must be excluded despite cooldown = 0
      const result = await matchCaller(testCallerId);
      expect(result.success).toBe(false);
      expect(result.error).toBe('no_users_available');
    });
  });
});
