import { jest, describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from '@jest/globals';
import http from 'node:http';
import request from 'supertest';
import { io as ioClient } from 'socket.io-client';
import bcrypt from 'bcrypt';
import app from '../src/app.js';
import { pool } from '../src/db/index.js';
import { initSocketServer, userSocketMap, SOCKET_EVENTS } from '../src/socket/index.js';
import { callSessionManager } from '../src/socket/callSessionManager.js';
import { socketAbuseGuard } from '../src/socket/socketAbuseGuard.js';
import { generateAccessToken } from '../src/utils/token.js';
import { config } from '../src/config/index.js';

describe('Comprehensive Abuse Protection & Rate Limiting Suite', () => {
  let server;
  let ioServer;
  let port;
  let querySpy;
  let activeClients = [];

  const originalEnv = { ...process.env };

  const mockUser1 = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'user1@example.com',
    phone: '+919876543201',
    status: 'active',
    is_available: true,
  };

  const mockUser2 = {
    id: '22222222-2222-4222-8222-222222222222',
    email: 'user2@example.com',
    phone: '+919876543202',
    status: 'active',
    is_available: true,
  };

  const mockAdmin = {
    id: '99999999-9999-4999-8999-999999999999',
    email: 'admin_abuse@example.com',
    role: 'superadmin',
    is_active: true,
    failed_login_attempts: 0,
    locked_until: null,
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
    process.env = { ...originalEnv };
    for (const client of activeClients) {
      client.removeAllListeners();
      if (client.connected) client.disconnect();
    }
    ioServer.close(done);
  });

  beforeEach(() => {
    // Reset env config values to generous defaults for isolation
    process.env.RATE_LIMIT_GLOBAL_MAX = '300';
    process.env.RATE_LIMIT_LOGIN_MAX = '50';
    process.env.RATE_LIMIT_LOGIN_ACCOUNT_MAX = '50';
    process.env.RATE_LIMIT_REGISTER_MAX = '50';
    process.env.RATE_LIMIT_OTP_REQUEST_MAX = '50';
    process.env.RATE_LIMIT_OTP_REQUEST_PHONE_MAX = '50';
    process.env.RATE_LIMIT_OTP_VERIFY_MAX = '50';
    process.env.RATE_LIMIT_OTP_VERIFY_PHONE_MAX = '50';
    process.env.SOCKET_RATE_LIMIT_CALL_FIND_MAX = '50';
    process.env.SOCKET_RATE_LIMIT_ACCEPT_MAX = '50';
    process.env.SOCKET_RATE_LIMIT_SIGNAL_MAX = '50';
    process.env.SOCKET_MAX_MALFORMED_EVENTS = '10';
    process.env.SOCKET_MAX_PAYLOAD_BYTES = '65536';
    process.env.SOCKET_SKIP_CANCEL_THRESHOLD = '10';
    process.env.ADMIN_MAX_LOGIN_ATTEMPTS = '5';

    userSocketMap.clear();
    socketAbuseGuard.clear();
    querySpy = jest.spyOn(pool, 'query');
  });

  afterEach(() => {
    while (activeClients.length > 0) {
      const c = activeClients.pop();
      try {
        c.removeAllListeners();
        c.disconnect();
      } catch (_) {}
    }
    jest.restoreAllMocks();
  });

  const connectClient = (token) => {
    return new Promise((resolve, reject) => {
      const client = ioClient(`http://127.0.0.1:${port}`, {
        path: '/socket.io',
        transports: ['websocket'],
        reconnection: false,
        auth: { token },
      });
      activeClients.push(client);
      client.on('connect', () => resolve(client));
      client.on('connect_error', (err) => reject(err));
    });
  };

  // =========================================================================
  // 1. REST Rate Limiting & Abuse Protection
  // =========================================================================
  describe('1. REST API Rate Limiting', () => {
    describe('Global Rate Limiter & Reverse Proxy IP Attribution', () => {
      it('should enforce global rate limit per client IP and recognize X-Forwarded-For via trust proxy', async () => {
        process.env.RATE_LIMIT_GLOBAL_MAX = '3';
        const clientIp = '203.0.113.101';

        // 3 requests allowed under limit
        for (let i = 0; i < 3; i++) {
          const res = await request(app)
            .get('/health')
            .set('X-Forwarded-For', clientIp);
          expect(res.status).toBe(200);
        }

        // 4th request from same IP should be blocked with 429
        const blockedRes = await request(app)
          .get('/health')
          .set('X-Forwarded-For', clientIp);
        expect(blockedRes.status).toBe(429);
        expect(blockedRes.body.error).toBe('TooManyRequests');

        // A different IP should NOT be blocked
        const otherIpRes = await request(app)
          .get('/health')
          .set('X-Forwarded-For', '203.0.113.102');
        expect(otherIpRes.status).toBe(200);
      });
    });

    describe('Registration Rate Limiting (per IP)', () => {
      it('should limit account registrations from the same IP', async () => {
        process.env.RATE_LIMIT_REGISTER_MAX = '2';
        const regIp = '198.51.100.11';

        querySpy.mockResolvedValue({ rows: [] }); // user lookup

        // First 2 registration requests
        for (let i = 1; i <= 2; i++) {
          const res = await request(app)
            .post('/auth/register')
            .set('X-Forwarded-For', regIp)
            .send({
              email: `reg_test_${i}@example.com`,
              password: 'ValidPassword123!',
            });
          expect(res.status).not.toBe(429);
        }

        // 3rd attempt from same IP should be blocked
        const blockedRes = await request(app)
          .post('/auth/register')
          .set('X-Forwarded-For', regIp)
          .send({
            email: 'reg_test_3@example.com',
            password: 'ValidPassword123!',
          });
        expect(blockedRes.status).toBe(429);
        expect(blockedRes.body.message).toContain('Too many account registrations');
      });
    });

    describe('Login Rate Limiting (Per-IP & Per-Account)', () => {
      it('should limit failed login attempts per account across different client IPs (anti-credential stuffing)', async () => {
        process.env.RATE_LIMIT_LOGIN_ACCOUNT_MAX = '2';
        process.env.RATE_LIMIT_LOGIN_MAX = '100';

        const targetEmail = 'targeted_user@example.com';

        querySpy.mockResolvedValue({
          rows: [
            {
              id: 'target-uuid',
              email: targetEmail,
              password_hash: await bcrypt.hash('CorrectPass123!', 10),
              status: 'active',
            },
          ],
        });

        // Attempt 1 from IP 1
        const res1 = await request(app)
          .post('/auth/login')
          .set('X-Forwarded-For', '10.50.0.1')
          .send({ email: targetEmail, password: 'WrongPassword1' });
        expect(res1.status).toBe(401);

        // Attempt 2 from IP 2
        const res2 = await request(app)
          .post('/auth/login')
          .set('X-Forwarded-For', '10.50.0.2')
          .send({ email: targetEmail, password: 'WrongPassword2' });
        expect(res2.status).toBe(401);

        // Attempt 3 from IP 3 targeting same account should hit account-level 429
        const res3 = await request(app)
          .post('/auth/login')
          .set('X-Forwarded-For', '10.50.0.3')
          .send({ email: targetEmail, password: 'WrongPassword3' });
        expect(res3.status).toBe(429);
        expect(res3.body.message).toContain('Too many failed login attempts for this account');
      });

      it('should limit login attempts from the same IP across multiple accounts (anti-spray attack)', async () => {
        process.env.RATE_LIMIT_LOGIN_MAX = '2';
        process.env.RATE_LIMIT_LOGIN_ACCOUNT_MAX = '100';
        const sprayIp = '10.50.1.99';

        querySpy.mockResolvedValue({ rows: [] });

        await request(app)
          .post('/auth/login')
          .set('X-Forwarded-For', sprayIp)
          .send({ email: 'account1@example.com', password: 'Password123!' });

        await request(app)
          .post('/auth/login')
          .set('X-Forwarded-For', sprayIp)
          .send({ email: 'account2@example.com', password: 'Password123!' });

        const res3 = await request(app)
          .post('/auth/login')
          .set('X-Forwarded-For', sprayIp)
          .send({ email: 'account3@example.com', password: 'Password123!' });

        expect(res3.status).toBe(429);
        expect(res3.body.message).toContain('Too many login attempts from this IP');
      });
    });

    describe('OTP Request & Verify Rate Limiting (Per-IP & Per-Phone)', () => {
      it('should enforce per-phone limit on OTP request across different IPs (anti-SMS flood)', async () => {
        process.env.RATE_LIMIT_OTP_REQUEST_PHONE_MAX = '2';
        process.env.RATE_LIMIT_OTP_REQUEST_MAX = '100';

        const targetPhone = '+919876543999';

        querySpy.mockImplementation((sql) => {
          if (sql.includes('app_settings')) {
            return Promise.resolve({ rows: [{ value_json: { mobile_login_enabled: true } }] });
          }
          return Promise.resolve({ rows: [] });
        });

        const r1 = await request(app)
          .post('/auth/otp/request')
          .set('X-Forwarded-For', '10.60.0.1')
          .send({ phone: targetPhone });
        expect(r1.status).toBe(200);

        const r2 = await request(app)
          .post('/auth/otp/request')
          .set('X-Forwarded-For', '10.60.0.2')
          .send({ phone: targetPhone });
        expect(r2.status).toBe(200);

        const r3 = await request(app)
          .post('/auth/otp/request')
          .set('X-Forwarded-For', '10.60.0.3')
          .send({ phone: targetPhone });
        expect(r3.status).toBe(429);
        expect(r3.body.message).toContain('Too many OTP requests for this phone number');
      });

      it('should enforce per-phone limit on OTP verification (anti-code brute-force)', async () => {
        process.env.RATE_LIMIT_OTP_VERIFY_PHONE_MAX = '2';
        process.env.RATE_LIMIT_OTP_VERIFY_MAX = '100';

        const targetPhone = '+919876543888';

        querySpy.mockImplementation((sql) => {
          if (sql.includes('app_settings')) {
            return Promise.resolve({ rows: [{ value_json: { mobile_login_enabled: true } }] });
          }
          return Promise.resolve({ rows: [] });
        });

        const v1 = await request(app)
          .post('/auth/otp/verify')
          .set('X-Forwarded-For', '10.70.0.1')
          .send({ phone: targetPhone, otp: '111111' });
        expect(v1.status).toBe(401);

        const v2 = await request(app)
          .post('/auth/otp/verify')
          .set('X-Forwarded-For', '10.70.0.2')
          .send({ phone: targetPhone, otp: '222222' });
        expect(v2.status).toBe(401);

        const v3 = await request(app)
          .post('/auth/otp/verify')
          .set('X-Forwarded-For', '10.70.0.3')
          .send({ phone: targetPhone, otp: '333333' });
        expect(v3.status).toBe(429);
        expect(v3.body.message).toContain('Too many OTP verification attempts for this phone number');
      });
    });
  });

  // =========================================================================
  // 2. Socket.IO Abuse Protection & Single Session Takeover
  // =========================================================================
  describe('2. Socket.IO Abuse Protection', () => {
    it('Single Active Calling Session: second login on another device takes over and notifies earlier socket', (done) => {
      const userToken = generateAccessToken(mockUser1);

      querySpy.mockImplementation((sql) => {
        if (sql.includes('FROM users WHERE id = $1')) {
          return Promise.resolve({ rows: [mockUser1] });
        }
        return Promise.resolve({ rows: [] });
      });

      connectClient(userToken).then((socketA) => {
        expect(userSocketMap.getSocketId(mockUser1.id)).toBe(socketA.id);

        let supersededReceived = false;
        socketA.on('auth:superseded', (data) => {
          supersededReceived = true;
          expect(data.message).toContain('Signed in from another device');
        });

        socketA.on('disconnect', () => {
          expect(supersededReceived).toBe(true);
        });

        // Now connect Socket B with the same user account
        connectClient(userToken).then((socketB) => {
          expect(userSocketMap.getSocketId(mockUser1.id)).toBe(socketB.id);

          setTimeout(() => {
            expect(socketA.connected).toBe(false);
            expect(socketB.connected).toBe(true);
            socketA.disconnect();
            socketB.disconnect();
            done();
          }, 100);
        });
      }).catch(done);
    });

    it('should terminate in-flight call when second socket connection takes over', (done) => {
      const callerToken = generateAccessToken(mockUser1);
      const calleeToken = generateAccessToken(mockUser2);
      const callCode = '33333333-3333-4333-8333-333333333333';

      querySpy.mockImplementation((sql, params) => {
        if (sql.includes('FROM users WHERE id = $1')) {
          if (params && params[0] === mockUser1.id) return Promise.resolve({ rows: [mockUser1] });
          if (params && params[0] === mockUser2.id) return Promise.resolve({ rows: [mockUser2] });
        }
        return Promise.resolve({ rows: [] });
      });

      Promise.all([connectClient(callerToken), connectClient(calleeToken)]).then(([callerSocket, calleeSocket]) => {
        callSessionManager.createSession({
          callCode,
          sessionId: '44444444-4444-4444-8444-444444444444',
          callerId: mockUser1.id,
          calleeId: mockUser2.id,
        });

        let callerBRef = null;
        calleeSocket.on(SOCKET_EVENTS.CALL_ENDED, (payload) => {
          if (payload.callCode === callCode) {
            expect(payload.reason).toBe('superseded');
            callerSocket.disconnect();
            calleeSocket.disconnect();
            if (callerBRef) callerBRef.disconnect();
            done();
          }
        });

        // Device B connects as caller
        connectClient(callerToken).then((callerSocketB) => {
          callerBRef = callerSocketB;
        }).catch(done);
      }).catch(done);
    });

    it('should enforce per-user rate limit on call:find requests', (done) => {
      process.env.SOCKET_RATE_LIMIT_CALL_FIND_MAX = '2';
      const token = generateAccessToken(mockUser1);
      querySpy.mockImplementation((sql) => {
        if (sql.includes('FROM users WHERE id = $1')) {
          return Promise.resolve({ rows: [mockUser1] });
        }
        return Promise.resolve({ rows: [] });
      });

      connectClient(token).then((socket) => {
        socket.emit('call:find');
        socket.emit('call:find');

        socket.on(SOCKET_EVENTS.CALL_ERROR, (err) => {
          expect(err.error).toBe('rate_limit_exceeded');
          expect(err.message).toContain('Too many call search requests');
          socket.disconnect();
          done();
        });

        socket.emit('call:find');
      }).catch(done);
    });

    it('should enforce per-user rate limit on accept/reject responses', (done) => {
      process.env.SOCKET_RATE_LIMIT_ACCEPT_MAX = '2';
      const token = generateAccessToken(mockUser1);
      querySpy.mockImplementation((sql) => {
        if (sql.includes('FROM users WHERE id = $1')) {
          return Promise.resolve({ rows: [mockUser1] });
        }
        return Promise.resolve({ rows: [] });
      });

      connectClient(token).then((socket) => {
        socket.on(SOCKET_EVENTS.CALL_ERROR, (err) => {
          if (err.error === 'rate_limit_exceeded') {
            expect(err.message).toContain('Too many call response actions');
            socket.disconnect();
            done();
          }
        });

        socket.emit(SOCKET_EVENTS.CALL_ACCEPT, { callCode: 'code-1' });
        socket.emit(SOCKET_EVENTS.CALL_ACCEPT, { callCode: 'code-2' });
        socket.emit(SOCKET_EVENTS.CALL_ACCEPT, { callCode: 'code-3' });
      }).catch(done);
    });

    it('should reject signaling messages exceeding maximum payload size', (done) => {
      process.env.SOCKET_MAX_PAYLOAD_BYTES = '500';
      const token = generateAccessToken(mockUser1);
      querySpy.mockImplementation((sql) => {
        if (sql.includes('FROM users WHERE id = $1')) {
          return Promise.resolve({ rows: [mockUser1] });
        }
        return Promise.resolve({ rows: [] });
      });

      connectClient(token).then((socket) => {
        const largeString = 'A'.repeat(800);

        socket.on(SOCKET_EVENTS.CALL_ERROR, (err) => {
          expect(err.error).toBe('payload_too_large');
          socket.disconnect();
          done();
        });

        socket.emit(SOCKET_EVENTS.SIGNAL_ICE, {
          callCode: 'some-code',
          candidate: largeString,
        });
      }).catch(done);
    });

    it('should count malformed events and forcibly disconnect after exceeding threshold', (done) => {
      process.env.SOCKET_MAX_MALFORMED_EVENTS = '3';
      const token = generateAccessToken(mockUser1);
      querySpy.mockImplementation((sql) => {
        if (sql.includes('FROM users WHERE id = $1')) {
          return Promise.resolve({ rows: [mockUser1] });
        }
        return Promise.resolve({ rows: [] });
      });

      connectClient(token).then((socket) => {
        let errorCount = 0;
        socket.on(SOCKET_EVENTS.CALL_ERROR, () => {
          errorCount++;
        });

        socket.on('disconnect', () => {
          expect(errorCount).toBeGreaterThanOrEqual(2);
          done();
        });

        // Send invalid, non-object / empty payload events
        socket.emit(SOCKET_EVENTS.SIGNAL_OFFER, 'not-an-object');
        socket.emit(SOCKET_EVENTS.SIGNAL_ANSWER, null);
        socket.emit(SOCKET_EVENTS.SIGNAL_ICE, 'malformed-again');
      }).catch(done);
    });

    it('should trigger cooldown after repeated rapid skips/cancels and block call:find', (done) => {
      process.env.SOCKET_SKIP_CANCEL_THRESHOLD = '3';
      process.env.SOCKET_SKIP_CANCEL_COOLDOWN_MS = '10000';
      const token = generateAccessToken(mockUser1);
      querySpy.mockImplementation((sql) => {
        if (sql.includes('FROM users WHERE id = $1')) {
          return Promise.resolve({ rows: [mockUser1] });
        }
        return Promise.resolve({ rows: [] });
      });

      connectClient(token).then((socket) => {
        for (let i = 1; i <= 3; i++) {
          const code = `rapid-cancel-code-${i}`;
          callSessionManager.createSession({
            callCode: code,
            sessionId: `44444444-4444-4444-8444-00000000000${i}`,
            callerId: mockUser1.id,
            calleeId: mockUser2.id,
          });
          socket.emit(SOCKET_EVENTS.CALL_CANCEL, { callCode: code });
        }

        setTimeout(() => {
          socket.on(SOCKET_EVENTS.CALL_ERROR, (err) => {
            expect(err.error).toBe('cooldown_active');
            expect(err.retryAfterSeconds).toBeGreaterThan(0);
            socket.disconnect();
            done();
          });

          socket.emit('call:find');
        }, 50);
      }).catch(done);
    });
  });

  // =========================================================================
  // 3. Auto-Moderation: Flagging Without Auto-Ban
  // =========================================================================
  describe('3. Auto-Moderation (Report-based Flagging)', () => {
    it('should mark a user as flagged when distinct reporter threshold is reached without auto-banning', async () => {
      const reporterUser = {
        id: '77777777-7777-4777-8777-777777777777',
        email: 'reporter@example.com',
        phone: '+919876543201',
        status: 'active',
        is_available: true,
      };
      const userToken = generateAccessToken(reporterUser);
      const targetUserId = '88888888-8888-4888-8888-888888888888';
      const callCode = '55555555-5555-4555-8555-555555555555';

      let dbUserStatus = 'active';
      let dbUserFlagged = false;

      // Mock database operations
      querySpy.mockImplementation((sql, params) => {
        if (sql.includes('FROM users WHERE id = $1')) {
          return Promise.resolve({ rows: [reporterUser] });
        }
        if (sql.includes('call_sessions') && sql.includes('call_code = $1')) {
          return Promise.resolve({
            rows: [
              {
                id: '66666666-6666-4666-8666-666666666666',
                caller_id: reporterUser.id,
                callee_id: targetUserId,
              },
            ],
          });
        }
        if (sql.includes('reports') && sql.includes('call_session_id = $1')) {
          return Promise.resolve({ rows: [] });
        }
        if (sql.includes('INSERT INTO reports')) {
          return Promise.resolve({ rows: [{ id: 'report-new-id', status: 'pending' }] });
        }
        if (sql.includes('app_settings') && sql.includes('moderation')) {
          return Promise.resolve({
            rows: [{ value_json: { flag_report_threshold: 3 } }],
          });
        }
        if (sql.includes('COUNT(DISTINCT reporter_id)')) {
          return Promise.resolve({ rows: [{ count: '3' }] });
        }
        if (sql.includes('UPDATE users') && sql.includes('is_flagged = TRUE')) {
          dbUserFlagged = true;
          return Promise.resolve({ rowCount: 1 });
        }
        if (sql.includes('UPDATE users') && sql.includes('status =')) {
          dbUserStatus = params[0];
          return Promise.resolve({ rowCount: 1 });
        }
        return Promise.resolve({ rows: [] });
      });

      const res = await request(app)
        .post('/user/reports')
        .set('Authorization', `Bearer ${userToken}`)
        .set('X-Forwarded-For', '10.88.1.1')
        .send({
          call_code: callCode,
          reason: 'harassment',
          note: 'Abusive language',
        });

      expect(res.status).toBe(201);
      expect(res.body.message).toBe('Report submitted successfully');

      // User must be flagged for admin review
      expect(dbUserFlagged).toBe(true);
      // User must NOT be auto-banned or auto-suspended
      expect(dbUserStatus).toBe('active');
    });
  });

  // =========================================================================
  // 4. Admin Login Brute-Force Lockout
  // =========================================================================
  describe('4. Admin Login Lockout', () => {
    it('should temporarily lock admin account after repeated password failures and return HTTP 423', async () => {
      process.env.ADMIN_MAX_LOGIN_ATTEMPTS = '3';
      process.env.ADMIN_LOCKOUT_MINUTES = '15';

      let failedAttempts = 0;
      let lockedUntil = null;

      const adminPasswordHash = await bcrypt.hash('CorrectAdminSecret123!', 10);

      querySpy.mockImplementation((sql, params) => {
        if (sql.includes('admin_users') && sql.includes('email = $1')) {
          return Promise.resolve({
            rows: [
              {
                id: mockAdmin.id,
                email: mockAdmin.email,
                password_hash: adminPasswordHash,
                role: 'superadmin',
                is_active: true,
                failed_login_attempts: failedAttempts,
                locked_until: lockedUntil,
              },
            ],
          });
        }
        if (sql.includes('UPDATE admin_users') && sql.includes('failed_login_attempts')) {
          failedAttempts = params[0];
          if (params[1] === true) {
            lockedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
          }
          return Promise.resolve({ rowCount: 1 });
        }
        return Promise.resolve({ rows: [] });
      });

      // Attempt 1: wrong password
      const res1 = await request(app)
        .post('/admin/auth/login')
        .set('X-Forwarded-For', '10.99.1.1')
        .send({ email: mockAdmin.email, password: 'WrongPassword1' });
      expect(res1.status).toBe(401);
      expect(res1.body.remainingAttempts).toBe(2);

      // Attempt 2: wrong password
      const res2 = await request(app)
        .post('/admin/auth/login')
        .set('X-Forwarded-For', '10.99.1.1')
        .send({ email: mockAdmin.email, password: 'WrongPassword2' });
      expect(res2.status).toBe(401);
      expect(res2.body.remainingAttempts).toBe(1);

      // Attempt 3: wrong password -> threshold reached -> HTTP 423 Locked
      const res3 = await request(app)
        .post('/admin/auth/login')
        .set('X-Forwarded-For', '10.99.1.1')
        .send({ email: mockAdmin.email, password: 'WrongPassword3' });
      expect(res3.status).toBe(423);
      expect(res3.body.error).toBe('Locked');
      expect(res3.body.message).toContain('temporarily locked');

      // Attempt 4: even with CORRECT password, locked account is rejected with HTTP 423
      const res4 = await request(app)
        .post('/admin/auth/login')
        .set('X-Forwarded-For', '10.99.1.1')
        .send({ email: mockAdmin.email, password: 'CorrectAdminSecret123!' });
      expect(res4.status).toBe(423);
      expect(res4.body.error).toBe('Locked');
    });

    it('should reset failed login attempts upon successful admin authentication', async () => {
      let resetCalled = false;
      const adminPasswordHash = await bcrypt.hash('CorrectAdminSecret123!', 10);

      querySpy.mockImplementation((sql) => {
        if (sql.includes('admin_users') && sql.includes('email = $1')) {
          return Promise.resolve({
            rows: [
              {
                id: mockAdmin.id,
                email: mockAdmin.email,
                password_hash: adminPasswordHash,
                role: 'superadmin',
                is_active: true,
                failed_login_attempts: 2,
                locked_until: null,
              },
            ],
          });
        }
        if (sql.includes('failed_login_attempts = 0')) {
          resetCalled = true;
          return Promise.resolve({ rowCount: 1 });
        }
        return Promise.resolve({ rows: [] });
      });

      const res = await request(app)
        .post('/admin/auth/login')
        .set('X-Forwarded-For', '10.99.2.1')
        .send({ email: mockAdmin.email, password: 'CorrectAdminSecret123!' });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(resetCalled).toBe(true);
    });
  });
});
