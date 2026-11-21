import { jest, describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from '@jest/globals';
import http from 'node:http';
import { io as ioClient } from 'socket.io-client';
import app from '../src/app.js';
import { pool } from '../src/db/index.js';
import { initSocketServer, userSocketMap, SOCKET_EVENTS } from '../src/socket/index.js';
import { checkCallerBillingStanding } from '../src/services/billing.service.js';
import { matchCaller } from '../src/services/matching.service.js';
import { generateAccessToken } from '../src/utils/token.js';

describe('Matching Logic & Call Find Protocol', () => {
  let server;
  let ioServer;
  let port;
  let querySpy;
  let connectSpy;
  let mockClient;

  const callerUser = {
    id: '11111111-1111-4111-a111-111111111111',
    email: 'caller@example.com',
    status: 'active',
    is_available: true,
  };

  const calleeUser = {
    id: '22222222-2222-4222-a222-222222222222',
    email: 'callee@example.com',
    status: 'active',
    is_available: true,
    push_token: 'callee-fcm-push-token-12345',
  };

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

  beforeEach(() => {
    userSocketMap.clear();

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

  describe('Pre-Call Billing Checks (checkCallerBillingStanding)', () => {
    it('Free Mode: allows call when within daily cap', async () => {
      mockClient.query
        .mockResolvedValueOnce({
          rows: [{ value_json: { mode: 'free', free_daily_minute_cap: 30 } }],
        })
        .mockResolvedValueOnce({
          rows: [{ total_seconds: 600 }], // 10 minutes used
        });

      const res = await checkCallerBillingStanding(mockClient, callerUser.id);
      expect(res.allowed).toBe(true);
      expect(res.mode).toBe('free');
    });

    it('Free Mode: rejects call when daily cap is exceeded', async () => {
      mockClient.query
        .mockResolvedValueOnce({
          rows: [{ value_json: { mode: 'free', free_daily_minute_cap: 30 } }],
        })
        .mockResolvedValueOnce({
          rows: [{ total_seconds: 1860 }], // 31 minutes used
        });

      const res = await checkCallerBillingStanding(mockClient, callerUser.id);
      expect(res.allowed).toBe(false);
      expect(res.error).toBe('daily_limit_reached');
    });

    it('Subscription Mode: rejects when user has no active subscription', async () => {
      mockClient.query
        .mockResolvedValueOnce({
          rows: [{ value_json: { mode: 'subscription' } }],
        })
        .mockResolvedValueOnce({
          rows: [], // no active subscription
        });

      const res = await checkCallerBillingStanding(mockClient, callerUser.id);
      expect(res.allowed).toBe(false);
      expect(res.error).toBe('subscription_required');
    });

    it('Subscription Mode: allows when user has active subscription', async () => {
      mockClient.query
        .mockResolvedValueOnce({
          rows: [{ value_json: { mode: 'subscription' } }],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'sub-id-1', status: 'active', daily_minute_cap: null }],
        });

      const res = await checkCallerBillingStanding(mockClient, callerUser.id);
      expect(res.allowed).toBe(true);
      expect(res.mode).toBe('subscription');
    });

    it('Per-Minute Mode: rejects when wallet has 0 balance and 0 trial minutes', async () => {
      mockClient.query
        .mockResolvedValueOnce({
          rows: [{ value_json: { mode: 'per_minute', per_minute_rate: 2.0 } }],
        })
        .mockResolvedValueOnce({
          rows: [{ balance_amount: '1.00', balance_minutes: 0, free_trial_minutes: 0, is_locked: false }],
        });

      const res = await checkCallerBillingStanding(mockClient, callerUser.id);
      expect(res.allowed).toBe(false);
      expect(res.error).toBe('insufficient_balance');
    });

    it('Per-Minute Mode: allows when user has free trial minutes', async () => {
      mockClient.query
        .mockResolvedValueOnce({
          rows: [{ value_json: { mode: 'per_minute', per_minute_rate: 2.0 } }],
        })
        .mockResolvedValueOnce({
          rows: [{ balance_amount: '0.00', balance_minutes: 0, free_trial_minutes: 5, is_locked: false }],
        });

      const res = await checkCallerBillingStanding(mockClient, callerUser.id);
      expect(res.allowed).toBe(true);
      expect(res.mode).toBe('per_minute');
    });

    it('Per-Minute Mode: allows when wallet balance is sufficient for at least 1 minute', async () => {
      mockClient.query
        .mockResolvedValueOnce({
          rows: [{ value_json: { mode: 'per_minute', per_minute_rate: 2.5 } }],
        })
        .mockResolvedValueOnce({
          rows: [{ balance_amount: '10.00', balance_minutes: 0, free_trial_minutes: 0, is_locked: false }],
        });

      const res = await checkCallerBillingStanding(mockClient, callerUser.id);
      expect(res.allowed).toBe(true);
      expect(res.mode).toBe('per_minute');
    });
  });

  describe('Atomic Matching Function (matchCaller)', () => {
    it('should reject if caller is already participating in an active call', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [callerUser] }) // SELECT caller FOR UPDATE
        .mockResolvedValueOnce({ rows: [{ id: 'active-session-id' }] }) // active call exists
        .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

      const result = await matchCaller(callerUser.id, []);
      expect(result.success).toBe(false);
      expect(result.error).toBe('already_in_call');
    });

    it('should return no_users_available when no eligible candidates match criteria', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [callerUser] }) // caller status
        .mockResolvedValueOnce({ rows: [] }) // no active call
        .mockResolvedValueOnce({ rows: [{ value_json: { mode: 'free' } }] }) // billing mode
        .mockResolvedValueOnce({ rows: [] }) // candidate query (none available)
        .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

      const result = await matchCaller(callerUser.id, []);
      expect(result.success).toBe(false);
      expect(result.error).toBe('no_users_available');
    });

    it('should atomically claim candidate, create ringing call_session, and commit', async () => {
      const mockSession = {
        id: '99999999-9999-4999-a999-999999999999',
        call_code: 'c7a1e2b4-5f6d-7e8a-9b0c-1d2e3f4a5b6c',
        status: 'ringing',
        billing_mode: 'free',
        requested_at: new Date().toISOString(),
      };

      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [callerUser] }) // caller status
        .mockResolvedValueOnce({ rows: [] }) // no active call
        .mockResolvedValueOnce({ rows: [{ value_json: { mode: 'free' } }] }) // billing check
        .mockResolvedValueOnce({ rows: [calleeUser] }) // candidate found with FOR UPDATE SKIP LOCKED
        .mockResolvedValueOnce({ rows: [mockSession] }) // INSERT INTO call_sessions
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      const result = await matchCaller(callerUser.id, [calleeUser.id]);
      expect(result.success).toBe(true);
      expect(result.session.id).toBe(mockSession.id);
      expect(result.session.callCode).toBe(mockSession.call_code);
      expect(result.session.status).toBe('ringing');
      expect(result.callee.id).toBe(calleeUser.id);
    });
  });

  describe('Socket.IO event "call:find"', () => {
    it('should return no_users_available via event and callback when candidate pool is empty', (done) => {
      const callerToken = generateAccessToken(callerUser);

      // Mock DB for socket auth
      querySpy.mockResolvedValue({ rows: [callerUser] });

      // Mock DB for matchCaller inside transaction
      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [callerUser] }) // lock caller
        .mockResolvedValueOnce({ rows: [] }) // no active call
        .mockResolvedValueOnce({ rows: [{ value_json: { mode: 'free' } }] }) // billing check
        .mockResolvedValueOnce({ rows: [] }) // candidate search: 0 rows found
        .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

      const callerSocket = ioClient(`http://127.0.0.1:${port}`, {
        transports: ['websocket'],
        reconnection: false,
        auth: { token: callerToken },
      });

      callerSocket.on('connect', () => {
        let eventReceived = false;

        callerSocket.on('no_users_available', (payload) => {
          expect(payload.error).toBe('no_users_available');
          eventReceived = true;
        });

        callerSocket.emit('call:find', {}, (response) => {
          expect(response.success).toBe(false);
          expect(response.error).toBe('no_users_available');
          expect(eventReceived).toBe(true);
          callerSocket.disconnect();
          done();
        });
      });
    });

    it('should match caller with callee, emit call:ringing and call:incoming, preserving complete anonymity', (done) => {
      const callerToken = generateAccessToken(callerUser);
      const calleeToken = generateAccessToken(calleeUser);

      const mockSession = {
        id: 'session-uuid-7777',
        call_code: 'code-uuid-8888',
        status: 'ringing',
        billing_mode: 'free',
        requested_at: new Date().toISOString(),
      };

      // Mock auth lookup for caller and callee
      querySpy.mockImplementation((sql, params) => {
        if (params && params[0] === callerUser.id) {
          return Promise.resolve({ rows: [callerUser] });
        }
        if (params && params[0] === calleeUser.id) {
          return Promise.resolve({ rows: [calleeUser] });
        }
        return Promise.resolve({ rows: [callerUser] });
      });

      // Connect callee first
      const calleeSocket = ioClient(`http://127.0.0.1:${port}`, {
        transports: ['websocket'],
        reconnection: false,
        auth: { token: calleeToken },
      });

      calleeSocket.on('connect', () => {
        // Connect caller
        const callerSocket = ioClient(`http://127.0.0.1:${port}`, {
          transports: ['websocket'],
          reconnection: false,
          auth: { token: callerToken },
        });

        callerSocket.on('connect', () => {
          // Prepare match transaction query mocks
          mockClient.query
            .mockResolvedValueOnce({ rows: [] }) // BEGIN
            .mockResolvedValueOnce({ rows: [callerUser] }) // caller status
            .mockResolvedValueOnce({ rows: [] }) // no active call
            .mockResolvedValueOnce({ rows: [{ value_json: { mode: 'free' } }] }) // billing check
            .mockResolvedValueOnce({ rows: [calleeUser] }) // callee claimed with FOR UPDATE SKIP LOCKED
            .mockResolvedValueOnce({ rows: [mockSession] }) // INSERT call_sessions
            .mockResolvedValueOnce({ rows: [] }); // COMMIT

          let calleeReceivedIncoming = false;

          // Callee listens for call:incoming
          calleeSocket.on('call:incoming', (data) => {
            calleeReceivedIncoming = true;
            expect(data.callCode).toBe(mockSession.call_code);
            expect(data.sessionId).toBe(mockSession.id);
            expect(data.ringSeconds).toBe(30);
            expect(data.role).toBe('callee');

            // CRITICAL: Ensure NO personal identifiers are exposed
            expect(data.callerId).toBeUndefined();
            expect(data.email).toBeUndefined();
            expect(data.phone).toBeUndefined();
            expect(data.name).toBeUndefined();
          });

          // Caller emits call:find
          callerSocket.emit('call:find', {}, (ack) => {
            expect(ack.success).toBe(true);
            expect(ack.sessionId).toBe(mockSession.id);
            expect(ack.callCode).toBe(mockSession.call_code);
            expect(ack.status).toBe('ringing');

            // Ensure NO personal identifiers are in the ack
            expect(ack.calleeId).toBeUndefined();
            expect(ack.email).toBeUndefined();
            expect(ack.phone).toBeUndefined();
            expect(ack.name).toBeUndefined();

            setTimeout(() => {
              expect(calleeReceivedIncoming).toBe(true);
              callerSocket.disconnect();
              calleeSocket.disconnect();
              done();
            }, 100);
          });
        });
      });
    });
  });
});
