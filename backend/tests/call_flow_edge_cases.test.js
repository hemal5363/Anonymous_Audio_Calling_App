import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import crypto from 'node:crypto';
import request from 'supertest';
import app from '../src/app.js';
import { pool } from '../src/db/index.js';
import { callSessionManager } from '../src/socket/callSessionManager.js';
import { userSocketMap } from '../src/socket/userSocketMap.js';
import { matchCaller } from '../src/services/matching.service.js';
import { handleRingingTimeout } from '../src/services/call.service.js';
import { runStartupRecovery } from '../src/services/cleanup.service.js';
import { generateAccessToken } from '../src/utils/token.js';

describe('CALL_FLOW.md Edge Cases & Fault Tolerance', () => {
  let querySpy;

  beforeEach(() => {
    querySpy = jest.spyOn(pool, 'query');
    callSessionManager.clear();
    userSocketMap.clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    callSessionManager.clear();
    userSocketMap.clear();
  });

  // =========================================================================
  // 1. Both Tap Call at Once (Concurrent Matching)
  // =========================================================================
  describe('Edge Case 1: Both Users Tap Call at Once (Race Condition & Lock Avoidance)', () => {
    it('should prevent race conditions and ensure no user is double-booked when two users tap Call simultaneously', async () => {
      const userAId = crypto.randomUUID();
      const userBId = crypto.randomUUID();

      const clientA = { query: jest.fn(), release: jest.fn() };
      const clientB = { query: jest.fn(), release: jest.fn() };

      let connectCounter = 0;
      jest.spyOn(pool, 'connect').mockImplementation(async () => {
        connectCounter++;
        return connectCounter === 1 ? clientA : clientB;
      });

      const sessionUUID = crypto.randomUUID();
      const callCode = crypto.randomUUID();

      // Transaction A (User A calls):
      // Locks candidate User B via SELECT ... FOR UPDATE SKIP LOCKED and creates session
      clientA.query
        .mockResolvedValueOnce({ rowCount: 1 }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: userAId, status: 'active', is_available: true }] }) // lock caller A
        .mockResolvedValueOnce({ rows: [] }) // caller A not in call
        .mockResolvedValueOnce({ rows: [{ value_json: { mode: 'free' } }] }) // billing check
        .mockResolvedValueOnce({ rows: [{ id: userBId, push_token: null }] }) // candidate query claims User B
        .mockResolvedValueOnce({
          rows: [
            {
              id: sessionUUID,
              call_code: callCode,
              status: 'ringing',
              billing_mode: 'free',
              requested_at: new Date().toISOString(),
            },
          ],
        }) // insert call_sessions
        .mockResolvedValueOnce({ rowCount: 1 }); // COMMIT

      // Transaction B (User B calls simultaneously):
      // User B attempts to match, but User B is already locked/claimed by User A, so SKIP LOCKED skips B or B sees busy
      clientB.query
        .mockResolvedValueOnce({ rowCount: 1 }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: userBId, status: 'active', is_available: true }] }) // lock caller B
        .mockResolvedValueOnce({ rows: [] }) // caller B not in call yet at check time
        .mockResolvedValueOnce({ rows: [{ value_json: { mode: 'free' } }] }) // billing check
        .mockResolvedValueOnce({ rows: [] }) // candidate query finds 0 candidates because A is calling B
        .mockResolvedValueOnce({ rowCount: 1 }); // ROLLBACK

      // Execute both match requests concurrently
      const [resultA, resultB] = await Promise.all([
        matchCaller(userAId),
        matchCaller(userBId),
      ]);

      // Exactly one match transaction succeeds
      expect(resultA.success).toBe(true);
      expect(resultA.session.callCode).toBe(callCode);
      expect(resultA.callee.id).toBe(userBId);

      // The second caller receives no_users_available gracefully without deadlocks or double-booking
      expect(resultB.success).toBe(false);
      expect(resultB.error).toBe('no_users_available');
    });
  });

  // =========================================================================
  // 2. Callee Goes Unavailable Mid-Match While Ringing
  // =========================================================================
  describe('Edge Case 2: Callee Goes Unavailable Mid-Match (docs/CALL_FLOW.md Section 9.3)', () => {
    it('should cancel ringing session and notify caller when callee toggles availability OFF mid-match', async () => {
      const callerId = crypto.randomUUID();
      const calleeId = crypto.randomUUID();
      const callCode = crypto.randomUUID();
      const sessionId = crypto.randomUUID();

      const calleeUser = {
        id: calleeId,
        email: 'callee@example.com',
        status: 'active',
        is_available: true,
      };
      const calleeToken = generateAccessToken(calleeUser);

      // Register active ringing call in CallSessionManager
      callSessionManager.createSession({
        sessionId,
        callCode,
        callerId,
        calleeId,
        billingMode: 'free',
        ringTimeoutMs: 30000,
      });

      expect(callSessionManager.getSession(callCode)).not.toBeNull();
      expect(callSessionManager.getSessionByUserId(calleeId)).not.toBeNull();

      // Mock database queries: auth check, update users, update call_sessions
      querySpy
        .mockResolvedValueOnce({ rows: [calleeUser] }) // Auth middleware
        .mockResolvedValueOnce({
          rows: [{ is_available: false, available_changed_at: new Date().toISOString() }],
        }) // UPDATE users SET is_available = false
        .mockResolvedValueOnce({ rowCount: 1 }); // UPDATE call_sessions SET status = 'ended', end_reason = 'callee_hangup'

      const res = await request(app)
        .put('/user/availability')
        .set('Authorization', `Bearer ${calleeToken}`)
        .send({ is_available: false });

      expect(res.status).toBe(200);
      expect(res.body.is_available).toBe(false);

      // In-memory ringing session must be cleanly removed
      expect(callSessionManager.getSession(callCode)).toBeNull();
      expect(callSessionManager.getSessionByUserId(calleeId)).toBeNull();
      expect(callSessionManager.getSessionByUserId(callerId)).toBeNull();

      // Database call_sessions update must have set end_reason to callee_hangup
      const callSessionUpdate = querySpy.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes("end_reason = 'callee_hangup'")
      );
      expect(callSessionUpdate).toBeDefined();
      expect(callSessionUpdate[1][0]).toBe(callCode);
    });
  });

  // =========================================================================
  // 3. Server Restart Mid-Call (Startup Recovery)
  // =========================================================================
  describe('Edge Case 3: Server Restart Mid-Call', () => {
    it('should cleanly conclude stuck connected or ringing call sessions on server startup recovery', async () => {
      const callSession1 = { id: crypto.randomUUID(), call_code: 'code-mid-call-1', status: 'connected' };
      const callSession2 = { id: crypto.randomUUID(), call_code: 'code-mid-call-2', status: 'ringing' };

      querySpy.mockResolvedValueOnce({
        rows: [callSession1, callSession2],
      });

      const recoveryResult = await runStartupRecovery();

      expect(recoveryResult.recoveredSessions).toBe(2);
      expect(querySpy).toHaveBeenCalledWith(
        expect.stringContaining("end_reason = 'system_shutdown'"),
      );
      const sql = querySpy.mock.calls[0][0];
      expect(sql).toContain("status IN ('requested', 'ringing', 'connected')");
    });
  });

  // =========================================================================
  // 4. Blocked Users (Bidirectional Block Exclusion)
  // =========================================================================
  describe('Edge Case 4: Blocked Users Exclusion (Bidirectional)', () => {
    const callerId = crypto.randomUUID();
    const candidateId = crypto.randomUUID();

    it('should strictly exclude candidates blocked by the caller', async () => {
      const mockClient = { query: jest.fn(), release: jest.fn() };
      jest.spyOn(pool, 'connect').mockResolvedValue(mockClient);

      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: callerId, status: 'active', is_available: true }] })
        .mockResolvedValueOnce({ rows: [] }) // not in call
        .mockResolvedValueOnce({ rows: [{ value_json: { mode: 'free' } }] }) // billing
        .mockResolvedValueOnce({ rows: [] }) // 0 candidates found due to block filter
        .mockResolvedValueOnce({ rowCount: 1 }); // ROLLBACK

      const result = await matchCaller(callerId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('no_users_available');

      const candidateQuery = mockClient.query.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes('b.blocker_id = $1 AND b.blocked_id = u.id')
      );
      expect(candidateQuery).toBeDefined();
    });

    it('should strictly exclude candidates who have blocked the caller (reverse block)', async () => {
      const mockClient = { query: jest.fn(), release: jest.fn() };
      jest.spyOn(pool, 'connect').mockResolvedValue(mockClient);

      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: callerId, status: 'active', is_available: true }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ value_json: { mode: 'free' } }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rowCount: 1 });

      const result = await matchCaller(callerId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('no_users_available');

      const candidateQuery = mockClient.query.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes('b.blocker_id = u.id AND b.blocked_id = $1')
      );
      expect(candidateQuery).toBeDefined();
    });
  });

  // =========================================================================
  // 5. Expired Ringing (30s Timeout Lifecycle)
  // =========================================================================
  describe('Edge Case 5: Expired Ringing (Ring Timeout Lifecycle)', () => {
    it('should transition call session to missed with ring_timeout, release users, and clear ringing timers', async () => {
      const callerId = crypto.randomUUID();
      const calleeId = crypto.randomUUID();
      const callCode = crypto.randomUUID();
      const sessionId = crypto.randomUUID();

      // Create ringing session in CallSessionManager
      callSessionManager.createSession({
        sessionId,
        callCode,
        callerId,
        calleeId,
        billingMode: 'free',
        ringTimeoutMs: 1000,
      });

      expect(callSessionManager.getSession(callCode)).not.toBeNull();
      expect(callSessionManager.getSessionByUserId(callerId)).not.toBeNull();
      expect(callSessionManager.getSessionByUserId(calleeId)).not.toBeNull();

      querySpy.mockResolvedValueOnce({ rowCount: 1 });

      // Trigger ring timeout
      const result = await handleRingingTimeout({ callCode });

      expect(result.success).toBe(true);
      expect(result.callerId).toBe(callerId);
      expect(result.calleeId).toBe(calleeId);

      // Both users must be unlinked and free to receive/initiate calls immediately
      expect(callSessionManager.getSession(callCode)).toBeNull();
      expect(callSessionManager.getSessionByUserId(callerId)).toBeNull();
      expect(callSessionManager.getSessionByUserId(calleeId)).toBeNull();

      // Database must be updated to status 'missed' and end_reason 'ring_timeout'
      expect(querySpy).toHaveBeenCalledWith(
        expect.stringContaining("SET status = 'missed', end_reason = 'ring_timeout'"),
        [callCode]
      );
    });
  });
});
