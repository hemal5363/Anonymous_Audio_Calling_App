import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import request from 'supertest';
import app from '../src/app.js';
import { pool } from '../src/db/index.js';
import { generateAccessToken } from '../src/utils/token.js';
import {
  runStartupRecovery,
  cleanupExpiredOtpCodes,
  cleanupStuckCallSessions,
  cleanupStaleAvailability,
  applyCallHistoryRetention,
  runCleanupCycle,
  startCleanupJob,
  stopCleanupJob,
} from '../src/services/cleanup.service.js';
import { userSocketMap } from '../src/socket/userSocketMap.js';
import { callSessionManager } from '../src/socket/callSessionManager.js';

describe('Database Cleanup Service & Account Deletion (Google Play Compliance)', () => {
  let querySpy;
  let connectSpy;

  const mockUser = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'user@example.com',
    phone: null,
    status: 'active',
    is_available: true,
  };
  let userToken;

  beforeEach(() => {
    userToken = generateAccessToken(mockUser);
    querySpy = jest.spyOn(pool, 'query');
    userSocketMap.clear();
    callSessionManager.clear();
  });

  afterEach(() => {
    stopCleanupJob();
    jest.restoreAllMocks();
    userSocketMap.clear();
    callSessionManager.clear();
  });

  describe('1. runStartupRecovery', () => {
    it('should close call sessions stuck in requested, ringing, or connected states after server restart', async () => {
      querySpy.mockResolvedValueOnce({
        rows: [
          { id: 'session-1', call_code: 'code-1', status: 'ringing' },
          { id: 'session-2', call_code: 'code-2', status: 'connected' },
        ],
      });

      const res = await runStartupRecovery();

      expect(querySpy).toHaveBeenCalledTimes(1);
      const sql = querySpy.mock.calls[0][0];
      expect(sql).toContain('UPDATE call_sessions');
      expect(sql).toContain("end_reason = 'system_shutdown'");
      expect(sql).toContain("status IN ('requested', 'ringing', 'connected')");
      expect(res.recoveredSessions).toBe(2);
    });

    it('should return 0 recovered sessions when none are stuck', async () => {
      querySpy.mockResolvedValueOnce({ rows: [] });

      const res = await runStartupRecovery();
      expect(res.recoveredSessions).toBe(0);
    });
  });

  describe('2. cleanupExpiredOtpCodes', () => {
    it('should mark expired codes as used and purge codes expired > 24 hours ago', async () => {
      querySpy
        .mockResolvedValueOnce({ rowCount: 4 }) // mark expired as used
        .mockResolvedValueOnce({ rowCount: 2 }); // delete older than 24h

      const res = await cleanupExpiredOtpCodes();

      expect(querySpy).toHaveBeenCalledTimes(2);
      expect(querySpy.mock.calls[0][0]).toContain('SET is_used = TRUE');
      expect(querySpy.mock.calls[1][0]).toContain("INTERVAL '24 hours'");
      expect(res.expiredCount).toBe(4);
      expect(res.purgedCount).toBe(2);
    });
  });

  describe('3. cleanupStuckCallSessions', () => {
    it('should close ringing calls older than 60s and connected calls where users have no socket', async () => {
      // Mock ringing cleanup query
      querySpy.mockResolvedValueOnce({
        rows: [{ id: 'sess-stuck-1', call_code: 'code-stuck-1' }],
        rowCount: 1,
      });

      // No users online in userSocketMap -> connected query runs without onlineUserIds
      querySpy.mockResolvedValueOnce({
        rows: [{ id: 'sess-conn-1', call_code: 'code-conn-1' }],
        rowCount: 1,
      });

      const res = await cleanupStuckCallSessions();

      expect(res.stuckRingingClosed).toBe(1);
      expect(res.stuckConnectedClosed).toBe(1);
    });

    it('should pass online user IDs to connected call cleanup when some users are connected', async () => {
      userSocketMap.set('user-online-1', 'socket-1');

      querySpy
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // ringing
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // connected

      const res = await cleanupStuckCallSessions();

      expect(querySpy).toHaveBeenCalledTimes(2);
      const connectedSql = querySpy.mock.calls[1][0];
      const connectedParams = querySpy.mock.calls[1][1];
      expect(connectedSql).toContain('caller_id != ALL($1::uuid[])');
      expect(connectedParams[0]).toEqual(['user-online-1']);
      expect(res.stuckRingingClosed).toBe(0);
      expect(res.stuckConnectedClosed).toBe(0);
    });
  });

  describe('4. cleanupStaleAvailability', () => {
    it('should set is_available = false for users with no socket after grace period', async () => {
      // 1. Settings query
      querySpy.mockResolvedValueOnce({
        rows: [{ value_json: { availability_grace_period_minutes: 45 } }],
      });
      // 2. Update query
      querySpy.mockResolvedValueOnce({
        rows: [{ id: 'user-stale-1' }, { id: 'user-stale-2' }],
        rowCount: 2,
      });

      const res = await cleanupStaleAvailability();

      expect(querySpy).toHaveBeenCalledTimes(2);
      const updateParams = querySpy.mock.calls[1][1];
      expect(updateParams[0]).toBe(45);
      expect(res.deactivatedUsersCount).toBe(2);
    });

    it('should exclude currently online socket users from availability reset', async () => {
      userSocketMap.set(mockUser.id, 'socket-123');

      // 1. Settings query
      querySpy.mockResolvedValueOnce({
        rows: [{ value_json: { availability_grace_period_minutes: 60 } }],
      });
      // 2. Update query with online users array
      querySpy.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const res = await cleanupStaleAvailability();

      const updateSql = querySpy.mock.calls[1][0];
      const updateParams = querySpy.mock.calls[1][1];
      expect(updateSql).toContain('NOT (id = ANY($2::uuid[]))');
      expect(updateParams[1]).toEqual([mockUser.id]);
      expect(res.deactivatedUsersCount).toBe(0);
    });
  });

  describe('5. applyCallHistoryRetention', () => {
    it('should delete ended call sessions older than configured retention days', async () => {
      // 1. Settings query
      querySpy.mockResolvedValueOnce({
        rows: [{ value_json: { call_history_retention_days: 90 } }],
      });
      // 2. Delete query
      querySpy.mockResolvedValueOnce({
        rows: [{ id: 'call-old-1' }],
        rowCount: 1,
      });

      const res = await applyCallHistoryRetention();

      expect(querySpy).toHaveBeenCalledTimes(2);
      const deleteSql = querySpy.mock.calls[1][0];
      const deleteParams = querySpy.mock.calls[1][1];
      expect(deleteSql).toContain('DELETE FROM call_sessions');
      expect(deleteSql).toContain("status = 'ended'");
      expect(deleteParams[0]).toBe(90);
      expect(res.deletedCallsCount).toBe(1);
    });

    it('should skip deletion when retention days <= 0', async () => {
      querySpy.mockResolvedValueOnce({
        rows: [{ value_json: { call_history_retention_days: 0 } }],
      });

      const res = await applyCallHistoryRetention();

      expect(querySpy).toHaveBeenCalledTimes(1);
      expect(res.deletedCallsCount).toBe(0);
    });
  });

  describe('6. runCleanupCycle & Interval Scheduler', () => {
    it('should execute all cleanup stages in one cycle', async () => {
      // 1. OTP mark
      querySpy.mockResolvedValueOnce({ rowCount: 1 });
      // 2. OTP purge
      querySpy.mockResolvedValueOnce({ rowCount: 0 });
      // 3. Ringing stuck
      querySpy.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      // 4. Connected stuck
      querySpy.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      // 5. Stale settings
      querySpy.mockResolvedValueOnce({ rows: [{ value_json: { availability_grace_period_minutes: 60 } }] });
      // 6. Stale update
      querySpy.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      // 7. Retention settings
      querySpy.mockResolvedValueOnce({ rows: [{ value_json: { call_history_retention_days: 90 } }] });
      // 8. Retention delete
      querySpy.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const results = await runCleanupCycle();

      expect(results.otp).toBeDefined();
      expect(results.calls).toBeDefined();
      expect(results.availability).toBeDefined();
      expect(results.retention).toBeDefined();
      expect(results.timestamp).toBeDefined();
    });

    it('should start and stop cleanup interval cleanly', () => {
      const timer = startCleanupJob(60000);
      expect(timer).toBeDefined();
      stopCleanupJob();
    });
  });

  describe('7. Account Deletion Endpoint (DELETE /user/account & DELETE /user/me)', () => {
    it('should reject unauthenticated deletion request with 401', async () => {
      const res = await request(app).delete('/user/account');
      expect(res.status).toBe(401);
      expect(res.body.message).toContain('token is missing or malformed');
    });

    it('should delete account, sanitize personal PII, revoke tokens, and anonymize calls/reports', async () => {
      const mockClient = {
        query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
        release: jest.fn(),
      };
      connectSpy = jest.spyOn(pool, 'connect').mockResolvedValue(mockClient);

      // Authenticate check in middleware
      querySpy.mockResolvedValueOnce({ rows: [mockUser] });

      const res = await request(app)
        .delete('/user/account')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('permanently deleted');

      // Verify transaction queries
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');

      // 1. User PII sanitize query
      const userUpdateCall = mockClient.query.mock.calls.find((call) =>
        call[0].includes('UPDATE users')
      );
      expect(userUpdateCall).toBeDefined();
      expect(userUpdateCall[0]).toContain('email = NULL');
      expect(userUpdateCall[0]).toContain('phone = NULL');
      expect(userUpdateCall[0]).toContain('password_hash = NULL');
      expect(userUpdateCall[0]).toContain('push_token = NULL');
      expect(userUpdateCall[0]).toContain("status = 'deleted'");
      expect(userUpdateCall[0]).toContain('is_available = FALSE');

      // 2. Refresh tokens revocation
      const tokenDeleteCall = mockClient.query.mock.calls.find((call) =>
        call[0].includes('DELETE FROM refresh_tokens')
      );
      expect(tokenDeleteCall).toBeDefined();

      // 3. Blocks removal
      const blockDeleteCall = mockClient.query.mock.calls.find((call) =>
        call[0].includes('DELETE FROM blocks')
      );
      expect(blockDeleteCall).toBeDefined();

      // 4. Call sessions anonymization (caller_id / callee_id set to NULL)
      const callAnonCalls = mockClient.query.mock.calls.filter((call) =>
        call[0].includes('UPDATE call_sessions')
      );
      expect(callAnonCalls.length).toBeGreaterThanOrEqual(2);

      // 5. Reports anonymization (reporter_id / reported_id set to NULL)
      const reportAnonCalls = mockClient.query.mock.calls.filter((call) =>
        call[0].includes('UPDATE reports')
      );
      expect(reportAnonCalls.length).toBeGreaterThanOrEqual(2);

      // 6. Wallet lock
      const walletLockCall = mockClient.query.mock.calls.find((call) =>
        call[0].includes('UPDATE wallets SET is_locked = TRUE')
      );
      expect(walletLockCall).toBeDefined();

      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should support DELETE /user/me as an alias', async () => {
      const mockClient = {
        query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
        release: jest.fn(),
      };
      connectSpy = jest.spyOn(pool, 'connect').mockResolvedValue(mockClient);

      // Authenticate check in middleware
      querySpy.mockResolvedValueOnce({ rows: [mockUser] });

      const res = await request(app)
        .delete('/user/me')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
