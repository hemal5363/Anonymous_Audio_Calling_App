import { jest } from '@jest/globals';
import http from 'http';
import { io as Client } from 'socket.io-client';
import crypto from 'crypto';
import app from '../src/app.js';
import { pool } from '../src/db/index.js';
import { initSocketServer } from '../src/socket/index.js';
import { userSocketMap } from '../src/socket/userSocketMap.js';
import { callSessionManager } from '../src/socket/callSessionManager.js';
import { SOCKET_EVENTS } from '../src/socket/events.js';
import { matchCaller } from '../src/services/matching.service.js';
import { handleRingingTimeout, endCall } from '../src/services/call.service.js';
import {
  checkCallerBillingStanding,
  deductCallMinute,
  startCallBillingTimer,
  stopCallBillingTimer,
  clearAllBillingTimers,
} from '../src/services/billing.service.js';
import { generateAccessToken } from '../src/utils/token.js';

describe('Call Flow Scenarios & Architectural Edge Cases', () => {
  let mockClient;
  const callerId = crypto.randomUUID();
  const calleeId = crypto.randomUUID();

  beforeEach(() => {
    clearAllBillingTimers();
    callSessionManager.clear();
    userSocketMap.clear();

    mockClient = {
      query: jest.fn(),
      release: jest.fn(),
    };
  });

  afterEach(() => {
    clearAllBillingTimers();
    callSessionManager.clear();
    jest.restoreAllMocks();
  });

  // =========================================================================
  // 1. Matching Excludes Self
  // =========================================================================
  describe('Matching Excludes Self', () => {
    it('should strictly exclude the caller from matching with themself', async () => {
      jest.spyOn(pool, 'connect').mockResolvedValue(mockClient);

      // Caller is available in users table, but candidate query must filter u.id <> $1
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 }) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ id: callerId, status: 'active', is_available: true }], // Caller check
        })
        .mockResolvedValueOnce({ rows: [] }) // No active call
        .mockResolvedValueOnce({
          rows: [{ value_json: { mode: 'free' } }], // Free mode
        })
        .mockResolvedValueOnce({
          rows: [], // Candidate query excludes caller, returning 0 candidates
        })
        .mockResolvedValueOnce({ rowCount: 1 }); // ROLLBACK

      const result = await matchCaller(callerId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('no_users_available');

      // Verify the candidate query contains the self-exclusion clause: u.id <> $1
      const candidateCall = mockClient.query.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('u.id <> $1')
      );
      expect(candidateCall).toBeDefined();
      expect(candidateCall[1][0]).toBe(callerId);
    });
  });

  // =========================================================================
  // 2. Matching Excludes Blocked Users (Bidirectional)
  // =========================================================================
  describe('Matching Excludes Blocked Users (Bidirectional)', () => {
    it('should exclude candidates blocked by the caller', async () => {
      jest.spyOn(pool, 'connect').mockResolvedValue(mockClient);

      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 }) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ id: callerId, status: 'active', is_available: true }],
        })
        .mockResolvedValueOnce({ rows: [] }) // No active call
        .mockResolvedValueOnce({
          rows: [{ value_json: { mode: 'free' } }],
        })
        .mockResolvedValueOnce({
          rows: [], // Candidate excluded because caller blocked candidate
        })
        .mockResolvedValueOnce({ rowCount: 1 }); // ROLLBACK

      const result = await matchCaller(callerId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('no_users_available');

      // Check query excludes blocks where blocker_id = $1 AND blocked_id = u.id
      const queryCall = mockClient.query.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('b.blocker_id = $1 AND b.blocked_id = u.id')
      );
      expect(queryCall).toBeDefined();
    });

    it('should exclude candidates who have blocked the caller (reverse block)', async () => {
      jest.spyOn(pool, 'connect').mockResolvedValue(mockClient);

      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 }) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ id: callerId, status: 'active', is_available: true }],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{ value_json: { mode: 'free' } }],
        })
        .mockResolvedValueOnce({
          rows: [], // Candidate excluded because candidate blocked caller
        })
        .mockResolvedValueOnce({ rowCount: 1 }); // ROLLBACK

      const result = await matchCaller(callerId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('no_users_available');

      // Check query excludes blocks where blocker_id = u.id AND blocked_id = $1
      const queryCall = mockClient.query.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('b.blocker_id = u.id AND b.blocked_id = $1')
      );
      expect(queryCall).toBeDefined();
    });

    it('should match successfully when neither party has blocked the other', async () => {
      jest.spyOn(pool, 'connect').mockResolvedValue(mockClient);
      const sessionUUID = crypto.randomUUID();
      const callCode = crypto.randomUUID();

      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 }) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ id: callerId, status: 'active', is_available: true }],
        })
        .mockResolvedValueOnce({ rows: [] }) // Not busy
        .mockResolvedValueOnce({
          rows: [{ value_json: { mode: 'free' } }], // Free mode
        })
        .mockResolvedValueOnce({
          rows: [{ id: calleeId, push_token: null }], // Unblocked candidate found
        })
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
        })
        .mockResolvedValueOnce({ rowCount: 1 }); // COMMIT

      const result = await matchCaller(callerId);

      expect(result.success).toBe(true);
      expect(result.session.callCode).toBe(callCode);
      expect(result.callee.id).toBe(calleeId);
    });
  });

  // =========================================================================
  // 3. No Double-Matching When Two Users Call at the Same Moment
  // =========================================================================
  describe('No Double-Matching Concurrency', () => {
    it('should prevent double-matching via FOR UPDATE SKIP LOCKED when two users call simultaneously', async () => {
      const caller1Id = crypto.randomUUID();
      const caller2Id = crypto.randomUUID();
      const availableTargetId = crypto.randomUUID();

      const client1 = { query: jest.fn(), release: jest.fn() };
      const client2 = { query: jest.fn(), release: jest.fn() };

      let callCount = 0;
      jest.spyOn(pool, 'connect').mockImplementation(async () => {
        callCount++;
        return callCount === 1 ? client1 : client2;
      });

      const session1Id = crypto.randomUUID();
      const code1 = crypto.randomUUID();

      // Client 1 (Caller 1): Acquires candidate lock first
      client1.query
        .mockResolvedValueOnce({ rowCount: 1 }) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ id: caller1Id, status: 'active', is_available: true }],
        })
        .mockResolvedValueOnce({ rows: [] }) // not in call
        .mockResolvedValueOnce({
          rows: [{ value_json: { mode: 'free' } }],
        })
        .mockResolvedValueOnce({
          rows: [{ id: availableTargetId, push_token: null }], // Locks target
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: session1Id,
              call_code: code1,
              status: 'ringing',
              billing_mode: 'free',
              requested_at: new Date().toISOString(),
            },
          ],
        })
        .mockResolvedValueOnce({ rowCount: 1 }); // COMMIT

      // Client 2 (Caller 2): Candidate is locked, FOR UPDATE SKIP LOCKED skips it -> 0 candidates
      client2.query
        .mockResolvedValueOnce({ rowCount: 1 }) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ id: caller2Id, status: 'active', is_available: true }],
        })
        .mockResolvedValueOnce({ rows: [] }) // not in call
        .mockResolvedValueOnce({
          rows: [{ value_json: { mode: 'free' } }],
        })
        .mockResolvedValueOnce({
          rows: [], // Target was skipped due to lock, candidate pool empty
        })
        .mockResolvedValueOnce({ rowCount: 1 }); // ROLLBACK

      // Execute both matching calls simultaneously
      const [res1, res2] = await Promise.all([
        matchCaller(caller1Id),
        matchCaller(caller2Id),
      ]);

      // Exactly one succeeds
      expect(res1.success).toBe(true);
      expect(res1.session.callCode).toBe(code1);
      expect(res1.callee.id).toBe(availableTargetId);

      // Other fails gracefully with no_users_available, preventing double-booking
      expect(res2.success).toBe(false);
      expect(res2.error).toBe('no_users_available');
    });
  });

  // =========================================================================
  // 4. Ringing Timeout
  // =========================================================================
  describe('Ringing Timeout Lifecycle', () => {
    it('should transition ringing call to missed with ring_timeout reason after 30s timeout', async () => {
      const callCode = crypto.randomUUID();
      const sessionId = crypto.randomUUID();

      callSessionManager.createSession({
        sessionId,
        callCode,
        callerId,
        calleeId,
        billingMode: 'free',
        ringTimeoutMs: 100, // Short timeout for test
      });

      expect(callSessionManager.getSession(callCode)).not.toBeNull();

      const querySpy = jest.spyOn(pool, 'query').mockResolvedValue({ rowCount: 1 });

      const res = await handleRingingTimeout({ callCode });

      expect(res.success).toBe(true);
      expect(res.callerId).toBe(callerId);
      expect(res.calleeId).toBe(calleeId);

      // In-memory session must be released
      expect(callSessionManager.getSession(callCode)).toBeNull();
      expect(callSessionManager.getSessionByUserId(callerId)).toBeNull();
      expect(callSessionManager.getSessionByUserId(calleeId)).toBeNull();

      // Database record updated to 'missed' and 'ring_timeout'
      expect(querySpy).toHaveBeenCalledWith(
        expect.stringContaining("SET status = 'missed', end_reason = 'ring_timeout'"),
        [callCode]
      );
    });
  });

  // =========================================================================
  // 5. Disconnect Mid-Call
  // =========================================================================
  describe('Disconnect Mid-Call Lifecycle', () => {
    let server;
    let ioServer;
    let callerSocket;
    let calleeSocket;
    let port;
    const testCaller = crypto.randomUUID();
    const testCallee = crypto.randomUUID();
    const testCallCode = crypto.randomUUID();
    const testSessionId = crypto.randomUUID();

    beforeAll((done) => {
      server = http.createServer(app);
      ioServer = initSocketServer(server);
      server.listen(0, () => {
        port = server.address().port;
        done();
      });
    });

    afterAll((done) => {
      ioServer.close();
      server.close(done);
    });

    beforeEach((done) => {
      callSessionManager.clear();
      userSocketMap.clear();

      jest.spyOn(pool, 'query').mockImplementation(async (sql, params) => {
        if (typeof sql === 'string' && sql.includes('FROM users WHERE id = $1')) {
          const uId = params[0];
          return { rows: [{ id: uId, email: `${uId}@example.com`, status: 'active' }] };
        }
        return { rows: [{ id: testSessionId, caller_id: testCaller, callee_id: testCallee, status: 'connected' }] };
      });

      const tokenCaller = generateAccessToken({ id: testCaller, email: 'caller@example.com' });
      const tokenCallee = generateAccessToken({ id: testCallee, email: 'callee@example.com' });

      callerSocket = Client(`http://127.0.0.1:${port}`, {
        auth: { token: tokenCaller },
        transports: ['websocket'],
      });
      calleeSocket = Client(`http://127.0.0.1:${port}`, {
        auth: { token: tokenCallee },
        transports: ['websocket'],
      });

      let connectCount = 0;
      const onConnect = () => {
        connectCount++;
        if (connectCount === 2) done();
      };

      callerSocket.on('connect', onConnect);
      calleeSocket.on('connect', onConnect);
    });

    afterEach((done) => {
      callSessionManager.clear();
      userSocketMap.clear();
      jest.restoreAllMocks();

      if (callerSocket?.connected) callerSocket.disconnect();
      if (calleeSocket?.connected) calleeSocket.disconnect();
      setTimeout(done, 50);
    });

    it('should terminate active call with network_error and notify opposite peer when socket drops', (done) => {
      // Setup connected session
      callSessionManager.createSession({
        sessionId: testSessionId,
        callCode: testCallCode,
        callerId: testCaller,
        calleeId: testCallee,
        billingMode: 'free',
      });
      callSessionManager.markConnected(testCallCode);

      // Remaining peer (callee) expects call:ended with network_error
      calleeSocket.on(SOCKET_EVENTS.CALL_ENDED, (payload) => {
        expect(payload.callCode).toBe(testCallCode);
        expect(payload.reason).toBe('network_error');

        // Session must be removed from memory
        expect(callSessionManager.getSession(testCallCode)).toBeNull();
        done();
      });

      // Caller socket abruptly disconnects
      callerSocket.disconnect();
    });
  });

  // =========================================================================
  // 6. Each Billing Mode (Free, Subscription, Per-Minute)
  // =========================================================================
  describe('Each Billing Mode Verification', () => {
    describe('Mode 1: Free Mode', () => {
      it('should always allow call in free mode without cap', async () => {
        mockClient.query.mockResolvedValueOnce({
          rows: [{ value_json: { mode: 'free' } }],
        });

        const res = await checkCallerBillingStanding(mockClient, callerId);
        expect(res.allowed).toBe(true);
        expect(res.mode).toBe('free');
      });

      it('should enforce daily limit when free_daily_minute_cap is exceeded', async () => {
        mockClient.query
          .mockResolvedValueOnce({
            rows: [{ value_json: { mode: 'free', free_daily_minute_cap: 30 } }],
          })
          .mockResolvedValueOnce({
            rows: [{ total_seconds: 1800 }], // 30 minutes already used
          });

        const res = await checkCallerBillingStanding(mockClient, callerId);
        expect(res.allowed).toBe(false);
        expect(res.error).toBe('daily_limit_reached');
      });
    });

    describe('Mode 2: Subscription Mode', () => {
      it('should reject call when caller has no subscription plan', async () => {
        mockClient.query
          .mockResolvedValueOnce({
            rows: [{ value_json: { mode: 'subscription' } }],
          })
          .mockResolvedValueOnce({
            rows: [], // No active subscription
          });

        const res = await checkCallerBillingStanding(mockClient, callerId);
        expect(res.allowed).toBe(false);
        expect(res.error).toBe('subscription_required');
      });

      it('should allow call when caller has an active subscription', async () => {
        mockClient.query
          .mockResolvedValueOnce({
            rows: [{ value_json: { mode: 'subscription' } }],
          })
          .mockResolvedValueOnce({
            rows: [
              {
                id: crypto.randomUUID(),
                status: 'active',
                ends_at: new Date(Date.now() + 86400000).toISOString(),
                daily_minute_cap: null,
              },
            ],
          });

        const res = await checkCallerBillingStanding(mockClient, callerId);
        expect(res.allowed).toBe(true);
        expect(res.mode).toBe('subscription');
      });
    });

    describe('Mode 3: Per-Minute Mode', () => {
      it('should reject call when wallet balance is below per_minute_rate', async () => {
        mockClient.query
          .mockResolvedValueOnce({
            rows: [{ value_json: { mode: 'per_minute', per_minute_rate: 3.0 } }],
          })
          .mockResolvedValueOnce({
            rows: [
              {
                id: crypto.randomUUID(),
                balance_amount: '1.50', // Less than 3.00
                balance_minutes: 0,
                free_trial_minutes: 0,
                is_locked: false,
              },
            ],
          });

        const res = await checkCallerBillingStanding(mockClient, callerId);
        expect(res.allowed).toBe(false);
        expect(res.error).toBe('insufficient_balance');
      });

      it('should allow call when wallet has sufficient balance_amount', async () => {
        mockClient.query
          .mockResolvedValueOnce({
            rows: [{ value_json: { mode: 'per_minute', per_minute_rate: 3.0 } }],
          })
          .mockResolvedValueOnce({
            rows: [
              {
                id: crypto.randomUUID(),
                balance_amount: '10.00',
                balance_minutes: 0,
                free_trial_minutes: 0,
                is_locked: false,
              },
            ],
          });

        const res = await checkCallerBillingStanding(mockClient, callerId);
        expect(res.allowed).toBe(true);
        expect(res.mode).toBe('per_minute');
      });

      it('should deduct minute, warn at 1 min left, and exhaust at 0 in per-minute mode', async () => {
        const walletId = crypto.randomUUID();
        const callCode = crypto.randomUUID();
        const sessionId = crypto.randomUUID();

        // 1. Minute 1: balance drops to 1 min remaining -> warning
        mockClient.query
          .mockResolvedValueOnce({
            rows: [{ value_json: { mode: 'per_minute', per_minute_rate: 2.0, currency: 'INR' } }],
          })
          .mockResolvedValueOnce({
            rows: [{ id: walletId, balance_amount: '4.00', balance_minutes: 0, free_trial_minutes: 0, is_locked: false }],
          })
          .mockResolvedValueOnce({
            rows: [{ balance_amount: '2.00', balance_minutes: 0, free_trial_minutes: 0 }],
          })
          .mockResolvedValueOnce({ rowCount: 1 })
          .mockResolvedValueOnce({ rowCount: 1 });

        const tick1 = await deductCallMinute(mockClient, { callCode, callerId, sessionId });
        expect(tick1.success).toBe(true);
        expect(tick1.remainingMinutes).toBe(1);
        expect(tick1.warning).toBe(true);
        expect(tick1.balanceExhausted).toBe(false);

        // 2. Minute 2: balance drops to 0 -> exhausted!
        mockClient.query
          .mockResolvedValueOnce({
            rows: [{ value_json: { mode: 'per_minute', per_minute_rate: 2.0, currency: 'INR' } }],
          })
          .mockResolvedValueOnce({
            rows: [{ id: walletId, balance_amount: '2.00', balance_minutes: 0, free_trial_minutes: 0, is_locked: false }],
          })
          .mockResolvedValueOnce({
            rows: [{ balance_amount: '0.00', balance_minutes: 0, free_trial_minutes: 0 }],
          })
          .mockResolvedValueOnce({ rowCount: 1 })
          .mockResolvedValueOnce({ rowCount: 1 });

        const tick2 = await deductCallMinute(mockClient, { callCode, callerId, sessionId });
        expect(tick2.success).toBe(true);
        expect(tick2.remainingMinutes).toBe(0);
        expect(tick2.balanceExhausted).toBe(true);
      });
    });
  });
});
