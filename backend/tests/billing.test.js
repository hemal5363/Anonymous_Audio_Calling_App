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
import {
  getMonetizationSettings,
  checkCallerBillingStanding,
  deductCallMinute,
  startCallBillingTimer,
  stopCallBillingTimer,
  isCallBillingTimerActive,
  clearAllBillingTimers,
} from '../src/services/billing.service.js';
import { generateAccessToken } from '../src/utils/token.js';

describe('Billing Service & Monetization Enforcement', () => {
  let mockClient;
  const testCallerId = crypto.randomUUID();
  const testCalleeId = crypto.randomUUID();
  const testCallCode = crypto.randomUUID();
  const testSessionId = crypto.randomUUID();

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
  // 1. Pre-Call Billing Standing Checks
  // =========================================================================
  describe('Pre-Call Billing Standing (checkCallerBillingStanding)', () => {
    describe('Free Mode', () => {
      it('should always allow call when in free mode without daily cap', async () => {
        mockClient.query.mockResolvedValueOnce({
          rows: [{ value_json: { mode: 'free', free_daily_minute_cap: null } }],
        });

        const res = await checkCallerBillingStanding(mockClient, testCallerId);
        expect(res.allowed).toBe(true);
        expect(res.mode).toBe('free');
        expect(mockClient.query).toHaveBeenCalledTimes(1);
      });

      it('should allow call when within configured daily cap', async () => {
        mockClient.query
          .mockResolvedValueOnce({
            rows: [{ value_json: { mode: 'free', free_daily_minute_cap: 60 } }],
          })
          .mockResolvedValueOnce({
            rows: [{ total_seconds: 1200 }], // 20 minutes used
          });

        const res = await checkCallerBillingStanding(mockClient, testCallerId);
        expect(res.allowed).toBe(true);
        expect(res.mode).toBe('free');
      });

      it('should reject call when daily free cap is exceeded', async () => {
        mockClient.query
          .mockResolvedValueOnce({
            rows: [{ value_json: { mode: 'free', free_daily_minute_cap: 30 } }],
          })
          .mockResolvedValueOnce({
            rows: [{ total_seconds: 1860 }], // 31 minutes used
          });

        const res = await checkCallerBillingStanding(mockClient, testCallerId);
        expect(res.allowed).toBe(false);
        expect(res.error).toBe('daily_limit_reached');
      });
    });

    describe('Subscription Mode', () => {
      it('should reject call when user has no active subscription', async () => {
        mockClient.query
          .mockResolvedValueOnce({
            rows: [{ value_json: { mode: 'subscription' } }],
          })
          .mockResolvedValueOnce({
            rows: [], // No subscription record found
          });

        const res = await checkCallerBillingStanding(mockClient, testCallerId);
        expect(res.allowed).toBe(false);
        expect(res.error).toBe('subscription_required');
      });

      it('should allow call when user has an active unexpired subscription', async () => {
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

        const res = await checkCallerBillingStanding(mockClient, testCallerId);
        expect(res.allowed).toBe(true);
        expect(res.mode).toBe('subscription');
      });

      it('should reject call when subscription plan daily minute cap is reached', async () => {
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
                daily_minute_cap: 45,
              },
            ],
          })
          .mockResolvedValueOnce({
            rows: [{ total_seconds: 2800 }], // ~46.6 minutes used
          });

        const res = await checkCallerBillingStanding(mockClient, testCallerId);
        expect(res.allowed).toBe(false);
        expect(res.error).toBe('daily_limit_reached');
      });
    });

    describe('Per-Minute Mode', () => {
      it('should reject call when wallet is not found', async () => {
        mockClient.query
          .mockResolvedValueOnce({
            rows: [{ value_json: { mode: 'per_minute', per_minute_rate: 1.5 } }],
          })
          .mockResolvedValueOnce({
            rows: [],
          });

        const res = await checkCallerBillingStanding(mockClient, testCallerId);
        expect(res.allowed).toBe(false);
        expect(res.error).toBe('wallet_not_found');
      });

      it('should reject call when user wallet is locked', async () => {
        mockClient.query
          .mockResolvedValueOnce({
            rows: [{ value_json: { mode: 'per_minute', per_minute_rate: 1.5 } }],
          })
          .mockResolvedValueOnce({
            rows: [
              {
                id: crypto.randomUUID(),
                balance_amount: '50.00',
                balance_minutes: 10,
                free_trial_minutes: 5,
                is_locked: true,
              },
            ],
          });

        const res = await checkCallerBillingStanding(mockClient, testCallerId);
        expect(res.allowed).toBe(false);
        expect(res.error).toBe('wallet_locked');
      });

      it('should reject call when user balance is 0 and 0 trial minutes', async () => {
        mockClient.query
          .mockResolvedValueOnce({
            rows: [{ value_json: { mode: 'per_minute', per_minute_rate: 2.0 } }],
          })
          .mockResolvedValueOnce({
            rows: [
              {
                id: crypto.randomUUID(),
                balance_amount: '0.00',
                balance_minutes: 0,
                free_trial_minutes: 0,
                is_locked: false,
              },
            ],
          });

        const res = await checkCallerBillingStanding(mockClient, testCallerId);
        expect(res.allowed).toBe(false);
        expect(res.error).toBe('insufficient_balance');
      });

      it('should reject call when balance_amount is less than minimum 1 minute rate', async () => {
        mockClient.query
          .mockResolvedValueOnce({
            rows: [{ value_json: { mode: 'per_minute', per_minute_rate: 3.0 } }],
          })
          .mockResolvedValueOnce({
            rows: [
              {
                id: crypto.randomUUID(),
                balance_amount: '2.50', // Less than 3.00
                balance_minutes: 0,
                free_trial_minutes: 0,
                is_locked: false,
              },
            ],
          });

        const res = await checkCallerBillingStanding(mockClient, testCallerId);
        expect(res.allowed).toBe(false);
        expect(res.error).toBe('insufficient_balance');
      });

      it('should allow call when caller has free_trial_minutes > 0', async () => {
        mockClient.query
          .mockResolvedValueOnce({
            rows: [{ value_json: { mode: 'per_minute', per_minute_rate: 5.0 } }],
          })
          .mockResolvedValueOnce({
            rows: [
              {
                id: crypto.randomUUID(),
                balance_amount: '0.00',
                balance_minutes: 0,
                free_trial_minutes: 3,
                is_locked: false,
              },
            ],
          });

        const res = await checkCallerBillingStanding(mockClient, testCallerId);
        expect(res.allowed).toBe(true);
        expect(res.mode).toBe('per_minute');
      });

      it('should allow call when caller has balance_minutes >= 1', async () => {
        mockClient.query
          .mockResolvedValueOnce({
            rows: [{ value_json: { mode: 'per_minute', per_minute_rate: 5.0 } }],
          })
          .mockResolvedValueOnce({
            rows: [
              {
                id: crypto.randomUUID(),
                balance_amount: '0.00',
                balance_minutes: 5,
                free_trial_minutes: 0,
                is_locked: false,
              },
            ],
          });

        const res = await checkCallerBillingStanding(mockClient, testCallerId);
        expect(res.allowed).toBe(true);
        expect(res.mode).toBe('per_minute');
      });

      it('should allow call when balance_amount >= per_minute_rate', async () => {
        mockClient.query
          .mockResolvedValueOnce({
            rows: [{ value_json: { mode: 'per_minute', per_minute_rate: 2.0 } }],
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

        const res = await checkCallerBillingStanding(mockClient, testCallerId);
        expect(res.allowed).toBe(true);
        expect(res.mode).toBe('per_minute');
      });
    });
  });

  // =========================================================================
  // 2. Immediate Admin Change Application
  // =========================================================================
  describe('Immediate Application of Admin Settings Changes', () => {
    it('should immediately apply monetization mode changes across calls', async () => {
      // Call 1: Admin mode is 'free' -> Allowed
      mockClient.query.mockResolvedValueOnce({
        rows: [{ value_json: { mode: 'free' } }],
      });
      const res1 = await checkCallerBillingStanding(mockClient, testCallerId);
      expect(res1.allowed).toBe(true);

      // Admin updates DB to 'subscription' -> Call 2 immediately rejects without active sub
      mockClient.query
        .mockResolvedValueOnce({
          rows: [{ value_json: { mode: 'subscription' } }],
        })
        .mockResolvedValueOnce({
          rows: [],
        });
      const res2 = await checkCallerBillingStanding(mockClient, testCallerId);
      expect(res2.allowed).toBe(false);
      expect(res2.error).toBe('subscription_required');

      // Admin updates DB to 'per_minute' -> Call 3 checks wallet balance
      mockClient.query
        .mockResolvedValueOnce({
          rows: [{ value_json: { mode: 'per_minute', per_minute_rate: 10.0 } }],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: crypto.randomUUID(),
              balance_amount: '5.00', // Insufficient
              balance_minutes: 0,
              free_trial_minutes: 0,
              is_locked: false,
            },
          ],
        });
      const res3 = await checkCallerBillingStanding(mockClient, testCallerId);
      expect(res3.allowed).toBe(false);
      expect(res3.error).toBe('insufficient_balance');
    });

    it('should immediately reflect updated per_minute_rate from DB', async () => {
      // Rate is 2.00, user balance is 3.00 -> Allowed
      mockClient.query
        .mockResolvedValueOnce({
          rows: [{ value_json: { mode: 'per_minute', per_minute_rate: 2.0 } }],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: crypto.randomUUID(),
              balance_amount: '3.00',
              balance_minutes: 0,
              free_trial_minutes: 0,
              is_locked: false,
            },
          ],
        });
      const res1 = await checkCallerBillingStanding(mockClient, testCallerId);
      expect(res1.allowed).toBe(true);

      // Admin increases rate to 5.00 in DB -> User with 3.00 is immediately rejected
      mockClient.query
        .mockResolvedValueOnce({
          rows: [{ value_json: { mode: 'per_minute', per_minute_rate: 5.0 } }],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: crypto.randomUUID(),
              balance_amount: '3.00',
              balance_minutes: 0,
              free_trial_minutes: 0,
              is_locked: false,
            },
          ],
        });
      const res2 = await checkCallerBillingStanding(mockClient, testCallerId);
      expect(res2.allowed).toBe(false);
      expect(res2.error).toBe('insufficient_balance');
    });
  });

  // =========================================================================
  // 3. In-Call Per-Minute Deductions (deductCallMinute)
  // =========================================================================
  describe('In-Call Deductions (deductCallMinute)', () => {
    it('should skip deduction if mode is free or subscription', async () => {
      mockClient.query.mockResolvedValueOnce({
        rows: [{ value_json: { mode: 'free' } }],
      });

      const res = await deductCallMinute(mockClient, {
        callCode: testCallCode,
        callerId: testCallerId,
        sessionId: testSessionId,
      });

      expect(res.success).toBe(true);
      expect(res.deducted).toBe(false);
      expect(res.mode).toBe('free');
      expect(res.balanceExhausted).toBe(false);
    });

    it('should prioritize deducting 1 free_trial_minute with 0.00 charge', async () => {
      const walletId = crypto.randomUUID();

      mockClient.query
        // 1. App settings
        .mockResolvedValueOnce({
          rows: [{ value_json: { mode: 'per_minute', per_minute_rate: 2.0, currency: 'INR' } }],
        })
        // 2. Select wallet FOR UPDATE
        .mockResolvedValueOnce({
          rows: [
            {
              id: walletId,
              balance_amount: '10.00',
              balance_minutes: 0,
              free_trial_minutes: 2,
              is_locked: false,
            },
          ],
        })
        // 3. Update wallet free_trial_minutes
        .mockResolvedValueOnce({
          rows: [
            {
              balance_amount: '10.00',
              balance_minutes: 0,
              free_trial_minutes: 1, // Decremented to 1
            },
          ],
        })
        // 4. Insert wallet_transaction
        .mockResolvedValueOnce({ rowCount: 1 })
        // 5. Update call_sessions
        .mockResolvedValueOnce({ rowCount: 1 });

      const res = await deductCallMinute(mockClient, {
        callCode: testCallCode,
        callerId: testCallerId,
        sessionId: testSessionId,
      });

      expect(res.success).toBe(true);
      expect(res.deducted).toBe(true);
      expect(res.deductionType).toBe('free_trial');
      expect(res.amountCharged).toBe(0.0);
      expect(res.balanceAmount).toBe(10.0);
      expect(res.remainingMinutes).toBe(6); // 1 trial + 10/2 = 6 minutes
      expect(res.balanceExhausted).toBe(false);
      expect(res.warning).toBe(false);
    });

    it('should prioritize balance_minutes when free_trial_minutes is 0', async () => {
      const walletId = crypto.randomUUID();

      mockClient.query
        .mockResolvedValueOnce({
          rows: [{ value_json: { mode: 'per_minute', per_minute_rate: 2.0, currency: 'INR' } }],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: walletId,
              balance_amount: '0.00',
              balance_minutes: 3,
              free_trial_minutes: 0,
              is_locked: false,
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              balance_amount: '0.00',
              balance_minutes: 2,
              free_trial_minutes: 0,
            },
          ],
        })
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rowCount: 1 });

      const res = await deductCallMinute(mockClient, {
        callCode: testCallCode,
        callerId: testCallerId,
        sessionId: testSessionId,
      });

      expect(res.success).toBe(true);
      expect(res.deducted).toBe(true);
      expect(res.deductionType).toBe('prepaid_minute');
      expect(res.amountCharged).toBe(0.0);
      expect(res.remainingMinutes).toBe(2);
      expect(res.balanceExhausted).toBe(false);
    });

    it('should debit per_minute_rate from balance_amount when no trial/prepaid minutes left', async () => {
      const walletId = crypto.randomUUID();

      mockClient.query
        .mockResolvedValueOnce({
          rows: [{ value_json: { mode: 'per_minute', per_minute_rate: 2.5, currency: 'INR' } }],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: walletId,
              balance_amount: '10.00',
              balance_minutes: 0,
              free_trial_minutes: 0,
              is_locked: false,
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              balance_amount: '7.50', // 10.00 - 2.50
              balance_minutes: 0,
              free_trial_minutes: 0,
            },
          ],
        })
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rowCount: 1 });

      const res = await deductCallMinute(mockClient, {
        callCode: testCallCode,
        callerId: testCallerId,
        sessionId: testSessionId,
      });

      expect(res.success).toBe(true);
      expect(res.deducted).toBe(true);
      expect(res.deductionType).toBe('balance_amount');
      expect(res.amountCharged).toBe(2.5);
      expect(res.balanceAmount).toBe(7.5);
      expect(res.remainingMinutes).toBe(3); // 7.50 / 2.50 = 3 minutes
      expect(res.balanceExhausted).toBe(false);
    });

    it('should flag warning: true when exactly 1 minute remains', async () => {
      const walletId = crypto.randomUUID();

      mockClient.query
        .mockResolvedValueOnce({
          rows: [{ value_json: { mode: 'per_minute', per_minute_rate: 2.0, currency: 'INR' } }],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: walletId,
              balance_amount: '4.00',
              balance_minutes: 0,
              free_trial_minutes: 0,
              is_locked: false,
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              balance_amount: '2.00', // Only 1 minute left
              balance_minutes: 0,
              free_trial_minutes: 0,
            },
          ],
        })
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rowCount: 1 });

      const res = await deductCallMinute(mockClient, {
        callCode: testCallCode,
        callerId: testCallerId,
        sessionId: testSessionId,
      });

      expect(res.success).toBe(true);
      expect(res.deducted).toBe(true);
      expect(res.remainingMinutes).toBe(1);
      expect(res.warning).toBe(true);
      expect(res.balanceExhausted).toBe(false);
    });

    it('should flag balanceExhausted: true when balance reaches zero', async () => {
      const walletId = crypto.randomUUID();

      mockClient.query
        .mockResolvedValueOnce({
          rows: [{ value_json: { mode: 'per_minute', per_minute_rate: 2.0, currency: 'INR' } }],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: walletId,
              balance_amount: '2.00',
              balance_minutes: 0,
              free_trial_minutes: 0,
              is_locked: false,
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              balance_amount: '0.00', // Reached zero!
              balance_minutes: 0,
              free_trial_minutes: 0,
            },
          ],
        })
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rowCount: 1 });

      const res = await deductCallMinute(mockClient, {
        callCode: testCallCode,
        callerId: testCallerId,
        sessionId: testSessionId,
      });

      expect(res.success).toBe(true);
      expect(res.deducted).toBe(true);
      expect(res.balanceAmount).toBe(0.0);
      expect(res.remainingMinutes).toBe(0);
      expect(res.balanceExhausted).toBe(true);
    });

    it('should return balanceExhausted: true if balance is already below 1 minute rate', async () => {
      mockClient.query
        .mockResolvedValueOnce({
          rows: [{ value_json: { mode: 'per_minute', per_minute_rate: 3.0, currency: 'INR' } }],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: crypto.randomUUID(),
              balance_amount: '1.00', // Less than 3.00
              balance_minutes: 0,
              free_trial_minutes: 0,
              is_locked: false,
            },
          ],
        });

      const res = await deductCallMinute(mockClient, {
        callCode: testCallCode,
        callerId: testCallerId,
        sessionId: testSessionId,
      });

      expect(res.success).toBe(false);
      expect(res.deducted).toBe(false);
      expect(res.balanceExhausted).toBe(true);
      expect(res.remainingMinutes).toBe(0);
    });
  });

  // =========================================================================
  // 4. In-Call Real-Time Billing Timer (startCallBillingTimer)
  // =========================================================================
  describe('In-Call Billing Timer & Auto Termination', () => {
    let server;
    let ioServer;
    let callerSocket;
    let port;
    let querySpy;

    beforeAll((done) => {
      server = http.createServer(app);
      ioServer = initSocketServer(server);
      server.listen(0, () => {
        port = server.address().port;
        done();
      });
    });

    afterAll((done) => {
      clearAllBillingTimers();
      ioServer.close();
      server.close(done);
    });

    beforeEach((done) => {
      clearAllBillingTimers();
      callSessionManager.clear();
      userSocketMap.clear();

      querySpy = jest.spyOn(pool, 'query');

      const callerToken = generateAccessToken({ id: testCallerId, email: 'caller@example.com' });

      querySpy.mockResolvedValue({
        rows: [{ id: testCallerId, email: 'caller@example.com', status: 'active' }],
      });

      callerSocket = Client(`http://127.0.0.1:${port}`, {
        auth: { token: callerToken },
        transports: ['websocket'],
      });

      callerSocket.on('connect', () => {
        done();
      });
    });

    afterEach((done) => {
      clearAllBillingTimers();
      callSessionManager.clear();
      jest.restoreAllMocks();

      if (callerSocket && callerSocket.connected) {
        callerSocket.disconnect();
      }
      setTimeout(done, 50);
    });

    it('should start timer, emit billing:balance and billing:warning on tick', (done) => {
      callSessionManager.createSession({
        sessionId: testSessionId,
        callCode: testCallCode,
        callerId: testCallerId,
        calleeId: testCalleeId,
        billingMode: 'per_minute',
      });
      callSessionManager.markConnected(testCallCode);

      const walletId = crypto.randomUUID();

      // Mock mockClient queries for 1 tick that results in 1 remaining minute
      mockClient.query
        .mockResolvedValueOnce({
          rows: [{ value_json: { mode: 'per_minute', per_minute_rate: 2.0, currency: 'INR' } }],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: walletId,
              balance_amount: '4.00',
              balance_minutes: 0,
              free_trial_minutes: 0,
              is_locked: false,
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [{ balance_amount: '2.00', balance_minutes: 0, free_trial_minutes: 0 }],
        })
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rowCount: 1 });

      let receivedBalance = false;
      let receivedWarning = false;

      callerSocket.on(SOCKET_EVENTS.BILLING_BALANCE, (data) => {
        expect(data.callCode).toBe(testCallCode);
        expect(data.balanceAmount).toBe(2.0);
        expect(data.remainingMinutes).toBe(1);
        receivedBalance = true;
        if (receivedBalance && receivedWarning) {
          stopCallBillingTimer(testCallCode);
          done();
        }
      });

      callerSocket.on(SOCKET_EVENTS.BILLING_WARNING, (data) => {
        expect(data.callCode).toBe(testCallCode);
        expect(data.remainingMinutes).toBe(1);
        receivedWarning = true;
        if (receivedBalance && receivedWarning) {
          stopCallBillingTimer(testCallCode);
          done();
        }
      });

      startCallBillingTimer({
        io: ioServer,
        callCode: testCallCode,
        callerId: testCallerId,
        sessionId: testSessionId,
        db: mockClient,
        intervalMs: 50, // Fast interval for testing
      });

      expect(isCallBillingTimerActive(testCallCode)).toBe(true);
    });

    it('should automatically end call when balance reaches zero', (done) => {
      callSessionManager.createSession({
        sessionId: testSessionId,
        callCode: testCallCode,
        callerId: testCallerId,
        calleeId: testCalleeId,
        billingMode: 'per_minute',
      });
      callSessionManager.markConnected(testCallCode);

      const walletId = crypto.randomUUID();

      // Mock mockClient queries: tick causes balance to drop to 0.00
      mockClient.query
        .mockResolvedValueOnce({
          rows: [{ value_json: { mode: 'per_minute', per_minute_rate: 2.0, currency: 'INR' } }],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: walletId,
              balance_amount: '2.00',
              balance_minutes: 0,
              free_trial_minutes: 0,
              is_locked: false,
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [{ balance_amount: '0.00', balance_minutes: 0, free_trial_minutes: 0 }],
        })
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rowCount: 1 });

      // Database update in endCall
      querySpy.mockResolvedValue({ rowCount: 1, rows: [] });

      callerSocket.on(SOCKET_EVENTS.CALL_ENDED, (data) => {
        expect(data.callCode).toBe(testCallCode);
        expect(data.reason).toBe('balance_exhausted');
        expect(isCallBillingTimerActive(testCallCode)).toBe(false);
        done();
      });

      startCallBillingTimer({
        io: ioServer,
        callCode: testCallCode,
        callerId: testCallerId,
        sessionId: testSessionId,
        db: mockClient,
        intervalMs: 50,
      });
    });

    it('should stop timer cleanly when stopCallBillingTimer is called', () => {
      startCallBillingTimer({
        io: ioServer,
        callCode: testCallCode,
        callerId: testCallerId,
        sessionId: testSessionId,
        intervalMs: 5000,
      });

      expect(isCallBillingTimerActive(testCallCode)).toBe(true);
      const stopped = stopCallBillingTimer(testCallCode);
      expect(stopped).toBe(true);
      expect(isCallBillingTimerActive(testCallCode)).toBe(false);
    });
  });
});
