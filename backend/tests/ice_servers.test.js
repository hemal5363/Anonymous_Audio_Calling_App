import { jest, describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from '@jest/globals';
import http from 'node:http';
import crypto from 'node:crypto';
import request from 'supertest';
import { io as ioClient } from 'socket.io-client';
import app from '../src/app.js';
import { pool } from '../src/db/index.js';
import { config } from '../src/config/index.js';
import { logger } from '../src/utils/logger.js';
import { initSocketServer, userSocketMap, callSessionManager, SOCKET_EVENTS } from '../src/socket/index.js';
import { generateAccessToken } from '../src/utils/token.js';

describe('ICE Server Config & Isolation (STUN/TURN Ephemeral Credentials)', () => {
  describe('Unit: ICE Server List & Ephemeral Credential Generation', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it('should default STUN to Google public STUN when STUN_URLS is unset', () => {
      delete process.env.STUN_URLS;
      delete process.env.STUN_SERVER_URL;
      delete process.env.TURN_URL;
      delete process.env.TURN_SECRET;

      const servers = config.webrtc.getIceServers();
      expect(servers).toHaveLength(1);
      expect(servers[0].urls).toBe('stun:stun.l.google.com:19302');
    });

    it('should support multiple comma-separated STUN_URLS', () => {
      process.env.STUN_URLS = 'stun:stun1.l.google.com:19302, stun:stun2.l.google.com:19302';
      delete process.env.TURN_URL;
      delete process.env.TURN_SECRET;

      const servers = config.webrtc.getIceServers();
      expect(servers).toHaveLength(1);
      expect(servers[0].urls).toEqual([
        'stun:stun1.l.google.com:19302',
        'stun:stun2.l.google.com:19302',
      ]);
    });

    it('should skip TURN if TURN_URL is set but TURN_SECRET is not configured (and no static credentials)', () => {
      process.env.STUN_URLS = 'stun:stun.l.google.com:19302';
      process.env.TURN_URL = 'turn:turn.example.com:3478';
      delete process.env.TURN_SECRET;
      delete process.env.TURN_USERNAME;
      delete process.env.TURN_PASSWORD;
      delete process.env.TURN_CREDENTIAL;

      const servers = config.webrtc.getIceServers();
      expect(servers).toHaveLength(1);
      expect(servers[0].urls).toBe('stun:stun.l.google.com:19302');
      const turn = servers.find((s) =>
        (Array.isArray(s.urls) ? s.urls : [s.urls]).some((u) => u.startsWith('turn:'))
      );
      expect(turn).toBeUndefined();
    });

    it('should generate short-lived TURN credentials per call when TURN_SECRET is configured', () => {
      process.env.STUN_URLS = 'stun:stun.l.google.com:19302';
      process.env.TURN_URL = 'turn:turn.example.com:3478?transport=udp,turn:turn.example.com:3478?transport=tcp';
      process.env.TURN_SECRET = 'super_secret_shared_key';
      process.env.TURN_TTL = '3600';

      const callCodeA = 'call-uuid-aaa';
      const callCodeB = 'call-uuid-bbb';

      const serversA = config.webrtc.getIceServers({ callCode: callCodeA });
      const serversB = config.webrtc.getIceServers({ callCode: callCodeB });

      const turnA = serversA.find((s) => Array.isArray(s.urls) && s.urls[0].startsWith('turn:'));
      const turnB = serversB.find((s) => Array.isArray(s.urls) && s.urls[0].startsWith('turn:'));

      expect(turnA).toBeDefined();
      expect(turnB).toBeDefined();

      // TURN URLs preserved as array
      expect(turnA.urls).toEqual([
        'turn:turn.example.com:3478?transport=udp',
        'turn:turn.example.com:3478?transport=tcp',
      ]);

      // Verify username format: <timestamp>:<callCode>
      expect(turnA.username).toMatch(/^\d+:call-uuid-aaa$/);
      expect(turnB.username).toMatch(/^\d+:call-uuid-bbb$/);

      // Verify expiry timestamp is in the future (~3600s)
      const expiryA = parseInt(turnA.username.split(':')[0], 10);
      const nowSec = Math.floor(Date.now() / 1000);
      expect(expiryA).toBeGreaterThanOrEqual(nowSec + 3590);
      expect(expiryA).toBeLessThanOrEqual(nowSec + 3610);

      // Verify HMAC-SHA1 signature matches
      const expectedHmacA = crypto
        .createHmac('sha1', 'super_secret_shared_key')
        .update(turnA.username)
        .digest('base64');
      expect(turnA.credential).toBe(expectedHmacA);

      const expectedHmacB = crypto
        .createHmac('sha1', 'super_secret_shared_key')
        .update(turnB.username)
        .digest('base64');
      expect(turnB.credential).toBe(expectedHmacB);

      // Distinct calls have distinct credentials
      expect(turnA.username).not.toBe(turnB.username);
      expect(turnA.credential).not.toBe(turnB.credential);
    });

    it('should match coturn use-auth-secret scheme with turn:anoncall-api.duckdns.org:3478 and independent HMAC verification', () => {
      process.env.STUN_URLS = 'stun:stun.l.google.com:19302';
      process.env.TURN_URL = 'turn:anoncall-api.duckdns.org:3478';
      const secret = 'prod_shared_turn_secret_xyz_987';
      process.env.TURN_SECRET = secret;
      delete process.env.TURN_TTL; // Default should be 3600

      const callCode = 'anon-session-777';
      const servers = config.webrtc.getIceServers({ callCode });

      // Check STUN
      const stun = servers.find((s) => s.urls === 'stun:stun.l.google.com:19302' || (Array.isArray(s.urls) && s.urls.includes('stun:stun.l.google.com:19302')));
      expect(stun).toBeDefined();

      // Check TURN
      const turn = servers.find((s) => Array.isArray(s.urls) && s.urls.includes('turn:anoncall-api.duckdns.org:3478'));
      expect(turn).toBeDefined();
      expect(turn.urls).toEqual(['turn:anoncall-api.duckdns.org:3478']);

      // Check username: Unix timestamp in seconds + ":" + anonymous id
      const parts = turn.username.split(':');
      expect(parts.length).toBeGreaterThanOrEqual(2);
      const timestampSec = parseInt(parts[0], 10);
      const nowSec = Math.floor(Date.now() / 1000);

      // Expiry must be integer timestamp around 1 hour (3600 seconds) in the future
      expect(timestampSec).toBeGreaterThanOrEqual(nowSec + 3590);
      expect(timestampSec).toBeLessThanOrEqual(nowSec + 3610);
      expect(parts.slice(1).join(':')).toBe(callCode);

      // Independent HMAC-SHA1 recomputation check
      const independentlyComputedHmac = crypto
        .createHmac('sha1', secret)
        .update(turn.username)
        .digest('base64');

      expect(turn.credential).toBe(independentlyComputedHmac);
    });

    it('should support coturn timestamp-only username format when includeAnonymousId is false', () => {
      process.env.TURN_URL = 'turn:anoncall-api.duckdns.org:3478';
      const secret = 'standalone_secret_key';
      process.env.TURN_SECRET = secret;

      const servers = config.webrtc.getIceServers({ includeAnonymousId: false });
      const turn = servers.find((s) => Array.isArray(s.urls) && s.urls.includes('turn:anoncall-api.duckdns.org:3478'));
      expect(turn).toBeDefined();

      // Username is purely numeric Unix timestamp
      expect(turn.username).toMatch(/^\d+$/);
      const nowSec = Math.floor(Date.now() / 1000);
      const timestampSec = parseInt(turn.username, 10);
      expect(timestampSec).toBeGreaterThanOrEqual(nowSec + 3590);

      // Independent HMAC-SHA1 verification
      const expectedHmac = crypto
        .createHmac('sha1', secret)
        .update(turn.username)
        .digest('base64');
      expect(turn.credential).toBe(expectedHmac);
    });

    it('CRITICAL PRIVACY: should never embed real user ID, email, or phone number in TURN username', () => {
      process.env.TURN_URL = 'turn:anoncall-api.duckdns.org:3478';
      process.env.TURN_SECRET = 'privacy_test_secret';

      const secretUserId = 'user-uuid-11223344-sensitive';
      const userEmail = 'alice.personal@example.com';
      const userPhone = '+1-555-867-5309';

      // 1. Caller attempts to pass userId property
      const servers1 = config.webrtc.getIceServers({ userId: secretUserId, callCode: 'clean-call-id' });
      const turn1 = servers1.find((s) => Array.isArray(s.urls) && s.urls.includes('turn:anoncall-api.duckdns.org:3478'));
      expect(turn1.username).not.toContain(secretUserId);
      expect(turn1.username).toContain('clean-call-id');

      // 2. Someone maliciously or inadvertently passes email as identifier
      const servers2 = config.webrtc.getIceServers({ callCode: userEmail });
      const turn2 = servers2.find((s) => Array.isArray(s.urls) && s.urls.includes('turn:anoncall-api.duckdns.org:3478'));
      expect(turn2.username).not.toContain(userEmail);
      expect(turn2.username).not.toContain('@');
      // Replaced with a random UUID token
      expect(turn2.username.split(':')[1]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

      // 3. Someone passes phone number as identifier
      const servers3 = config.webrtc.getIceServers({ anonymousId: userPhone });
      const turn3 = servers3.find((s) => Array.isArray(s.urls) && s.urls.includes('turn:anoncall-api.duckdns.org:3478'));
      expect(turn3.username).not.toContain(userPhone);
      expect(turn3.username).not.toContain('+1');
      expect(turn3.username.split(':')[1]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

      // Independent HMAC matches the sanitized username
      const expectedHmac3 = crypto
        .createHmac('sha1', 'privacy_test_secret')
        .update(turn3.username)
        .digest('base64');
      expect(turn3.credential).toBe(expectedHmac3);
    });

    it('SECURITY: should NEVER log credentials, TURN secrets, or sensitive ICE payloads', () => {
      const secret = 'super_confidential_turn_secret_never_log_me';
      process.env.TURN_URL = 'turn:anoncall-api.duckdns.org:3478';
      process.env.TURN_SECRET = secret;

      const servers = config.webrtc.getIceServers({ callCode: 'call-999' });
      const turn = servers.find((s) => Array.isArray(s.urls) && s.urls.includes('turn:anoncall-api.duckdns.org:3478'));
      const generatedCredential = turn.credential;

      const loggedMessages = [];
      const spyStdout = jest.spyOn(process.stdout, 'write').mockImplementation((str) => {
        loggedMessages.push(String(str));
        return true;
      });
      const spyConsoleLog = jest.spyOn(console, 'log').mockImplementation((...args) => {
        loggedMessages.push(args.map(String).join(' '));
      });

      // Pass iceServers directly into logger
      logger.info('Call setup with ICE servers', { iceServers: servers, testKey: 'ok' });
      logger.debug('Generated ICE credentials', { credential: generatedCredential, turnSecret: secret });

      spyStdout.mockRestore();
      spyConsoleLog.mockRestore();

      const combinedLogs = loggedMessages.join('\n');

      // Assert secret is NEVER in logs
      expect(combinedLogs).not.toContain(secret);
      // Assert raw credential is NEVER in logs
      expect(combinedLogs).not.toContain(generatedCredential);
      // Assert redaction is applied
      expect(combinedLogs).toContain('[REDACTED]');
    });

    it('should support optional static TURN credentials when TURN_USERNAME and TURN_PASSWORD are set without secret', () => {
      process.env.STUN_URLS = 'stun:stun.l.google.com:19302';
      process.env.TURN_URL = 'turn:turn.example.com:3478';
      delete process.env.TURN_SECRET;
      process.env.TURN_USERNAME = 'static_user';
      process.env.TURN_PASSWORD = 'static_password';

      const servers = config.webrtc.getIceServers();
      const turn = servers.find((s) => Array.isArray(s.urls) && s.urls[0].startsWith('turn:'));
      expect(turn).toBeDefined();
      expect(turn.username).toBe('static_user');
      expect(turn.credential).toBe('static_password');
    });
  });

  describe('Integration: ICE Credentials Delivery & Isolation', () => {
    let server;
    let ioServer;
    let port;
    let querySpy;

    function createTestUser(role = 'user') {
      return {
        id: crypto.randomUUID(),
        email: `${role}-${Math.random().toString(36).slice(2)}@example.com`,
        status: 'active',
        is_available: true,
      };
    }

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
      callSessionManager.clear();
      querySpy = jest.spyOn(pool, 'query').mockImplementation((sql, params) => {
        if (typeof sql === 'string' && sql.includes('FROM users')) {
          return Promise.resolve({
            rows: [
              {
                id: params ? params[0] : crypto.randomUUID(),
                email: 'test@example.com',
                status: 'active',
                is_available: true,
              },
            ],
          });
        }
        return Promise.resolve({ rows: [] });
      });
    });

    afterEach(() => {
      callSessionManager.clear();
      jest.restoreAllMocks();
    });

    it('should NOT return iceServers in call:ringing or call:incoming or call:find ack before call is matched', (done) => {
      const caller = createTestUser('caller');
      const callee = createTestUser('callee');
      const callerToken = generateAccessToken(caller);
      const calleeToken = generateAccessToken(callee);

      const mockSession = {
        id: crypto.randomUUID(),
        call_code: crypto.randomUUID(),
        status: 'ringing',
        billing_mode: 'free',
        requested_at: new Date().toISOString(),
      };

      querySpy.mockImplementation((sql, params) => {
        if (params && params[0] === caller.id) return Promise.resolve({ rows: [caller] });
        if (params && params[0] === callee.id) return Promise.resolve({ rows: [callee] });
        return Promise.resolve({ rows: [caller] });
      });

      // Callee connects
      const calleeSocket = ioClient(`http://127.0.0.1:${port}`, {
        transports: ['websocket'],
        reconnection: false,
        auth: { token: calleeToken },
      });

      calleeSocket.on('connect', () => {
        // Caller connects
        const callerSocket = ioClient(`http://127.0.0.1:${port}`, {
          transports: ['websocket'],
          reconnection: false,
          auth: { token: callerToken },
        });

        callerSocket.on('connect', () => {
          // Mock pool.connect transaction for matchCaller
          const mockClient = {
            query: jest
              .fn()
              .mockResolvedValueOnce({ rows: [] }) // BEGIN
              .mockResolvedValueOnce({ rows: [caller] }) // lock caller
              .mockResolvedValueOnce({ rows: [] }) // active call check
              .mockResolvedValueOnce({ rows: [{ value_json: { mode: 'free' } }] }) // billing
              .mockResolvedValueOnce({ rows: [callee] }) // find callee
              .mockResolvedValueOnce({ rows: [mockSession] }) // insert call_sessions
              .mockResolvedValueOnce({ rows: [] }), // COMMIT
            release: jest.fn(),
          };
          jest.spyOn(pool, 'connect').mockResolvedValue(mockClient);

          let calleeIncomingData = null;
          let callerRingingData = null;

          calleeSocket.on('call:incoming', (data) => {
            calleeIncomingData = data;
          });

          callerSocket.on('call:ringing', (data) => {
            callerRingingData = data;
          });

          callerSocket.emit('call:find', {}, (ack) => {
            expect(ack.success).toBe(true);
            // CRITICAL: call:find ack must NOT leak ICE credentials
            expect(ack.iceServers).toBeUndefined();

            setTimeout(() => {
              // CRITICAL: Neither ringing nor incoming payloads contain iceServers
              expect(callerRingingData).toBeDefined();
              expect(callerRingingData.iceServers).toBeUndefined();

              expect(calleeIncomingData).toBeDefined();
              expect(calleeIncomingData.iceServers).toBeUndefined();

              callerSocket.disconnect();
              calleeSocket.disconnect();
              done();
            }, 100);
          });
        });
      });
    });

    it('should send iceServers ONLY to the two matched users at call start (call:matched)', (done) => {
      const caller = createTestUser('caller');
      const callee = createTestUser('callee');
      const callerToken = generateAccessToken(caller);
      const calleeToken = generateAccessToken(callee);
      const callCode = crypto.randomUUID();
      const sessionId = crypto.randomUUID();

      callSessionManager.createSession({
        sessionId,
        callCode,
        callerId: caller.id,
        calleeId: callee.id,
        billingMode: 'free',
        ringTimeoutMs: 10000,
      });

      const calleeSocket = ioClient(`http://127.0.0.1:${port}`, {
        transports: ['websocket'],
        reconnection: false,
        auth: { token: calleeToken },
      });

      const callerSocket = ioClient(`http://127.0.0.1:${port}`, {
        transports: ['websocket'],
        reconnection: false,
        auth: { token: callerToken },
      });

      let callerReceivedMatched = false;
      let calleeReceivedMatched = false;

      callerSocket.on('call:matched', (payload) => {
        callerReceivedMatched = true;
        expect(payload.callCode).toBe(callCode);
        expect(payload.role).toBe('caller');
        expect(payload.iceServers).toBeDefined();
        expect(Array.isArray(payload.iceServers)).toBe(true);

        const stun = payload.iceServers.find((s) =>
          typeof s.urls === 'string'
            ? s.urls.startsWith('stun:')
            : Array.isArray(s.urls) && s.urls[0].startsWith('stun:')
        );
        expect(stun).toBeDefined();
      });

      calleeSocket.on('call:matched', (payload) => {
        calleeReceivedMatched = true;
        expect(payload.callCode).toBe(callCode);
        expect(payload.role).toBe('callee');
        expect(payload.iceServers).toBeDefined();
        expect(Array.isArray(payload.iceServers)).toBe(true);
      });

      let connectedCount = 0;
      const onConnect = () => {
        connectedCount++;
        if (connectedCount === 2) {
          calleeSocket.emit('call:accept', { callCode }, (ack) => {
            expect(ack.success).toBe(true);
            // Ack does not contain iceServers
            expect(ack.iceServers).toBeUndefined();

            setTimeout(() => {
              expect(callerReceivedMatched).toBe(true);
              expect(calleeReceivedMatched).toBe(true);

              callerSocket.disconnect();
              calleeSocket.disconnect();
              done();
            }, 100);
          });
        }
      };

      callerSocket.on('connect', onConnect);
      calleeSocket.on('connect', onConnect);
    });

    it('CRITICAL SECURITY: credentials are NOT returned to anyone outside the call', (done) => {
      const caller = createTestUser('caller');
      const callee = createTestUser('callee');
      const eavesdropper = createTestUser('eavesdropper');

      const callerToken = generateAccessToken(caller);
      const calleeToken = generateAccessToken(callee);
      const eavesdropperToken = generateAccessToken(eavesdropper);

      const callCode = crypto.randomUUID();
      const sessionId = crypto.randomUUID();

      // Establish session between caller and callee
      callSessionManager.createSession({
        sessionId,
        callCode,
        callerId: caller.id,
        calleeId: callee.id,
        billingMode: 'free',
        ringTimeoutMs: 10000,
      });

      const calleeSocket = ioClient(`http://127.0.0.1:${port}`, {
        transports: ['websocket'],
        reconnection: false,
        auth: { token: calleeToken },
      });

      const callerSocket = ioClient(`http://127.0.0.1:${port}`, {
        transports: ['websocket'],
        reconnection: false,
        auth: { token: callerToken },
      });

      const eavesdropperSocket = ioClient(`http://127.0.0.1:${port}`, {
        transports: ['websocket'],
        reconnection: false,
        auth: { token: eavesdropperToken },
      });

      let eavesdropperReceivedMatched = false;
      let eavesdropperReceivedData = null;

      eavesdropperSocket.on('call:matched', (data) => {
        eavesdropperReceivedMatched = true;
        eavesdropperReceivedData = data;
      });

      let connectedCount = 0;
      const onConnect = () => {
        connectedCount++;
        if (connectedCount === 3) {
          // 1. Eavesdropper attempts unauthorized call:accept
          eavesdropperSocket.emit('call:accept', { callCode }, (ack) => {
            // Must be rejected
            expect(ack.success).toBe(false);
            expect(ack.error).toBe('unauthorized');
            // Must NOT return iceServers or credentials
            expect(ack.iceServers).toBeUndefined();
            expect(ack.credential).toBeUndefined();

            // 2. Legitimate callee accepts the call
            calleeSocket.emit('call:accept', { callCode }, (calleeAck) => {
              expect(calleeAck.success).toBe(true);

              setTimeout(() => {
                // Eavesdropper socket must NEVER receive call:matched or credentials
                expect(eavesdropperReceivedMatched).toBe(false);
                expect(eavesdropperReceivedData).toBeNull();

                callerSocket.disconnect();
                calleeSocket.disconnect();
                eavesdropperSocket.disconnect();
                done();
              }, 100);
            });
          });
        }
      };

      callerSocket.on('connect', onConnect);
      calleeSocket.on('connect', onConnect);
      eavesdropperSocket.on('connect', onConnect);
    });

    it('should expose GET /calls/turn-credentials returning ICE servers with valid HMAC credentials for authenticated users', async () => {
      const user = createTestUser('turn_requester');
      const token = generateAccessToken(user);

      process.env.TURN_URL = 'turn:anoncall-api.duckdns.org:3478';
      const secret = 'rest_endpoint_test_turn_secret_456';
      process.env.TURN_SECRET = secret;

      // 1. Unauthenticated request must return 401
      const unauthRes = await request(app).get('/calls/turn-credentials');
      expect(unauthRes.status).toBe(401);

      // 2. Authenticated request returns 200 with ICE servers
      const authRes = await request(app)
        .get('/calls/turn-credentials')
        .set('Authorization', `Bearer ${token}`);

      expect(authRes.status).toBe(200);
      expect(authRes.body.ttl).toBe(3600);
      expect(Array.isArray(authRes.body.iceServers)).toBe(true);

      const stun = authRes.body.iceServers.find((s) =>
        typeof s.urls === 'string' ? s.urls.startsWith('stun:') : Array.isArray(s.urls) && s.urls[0].startsWith('stun:')
      );
      expect(stun).toBeDefined();

      const turn = authRes.body.iceServers.find((s) =>
        Array.isArray(s.urls) && s.urls.includes('turn:anoncall-api.duckdns.org:3478')
      );
      expect(turn).toBeDefined();
      expect(turn.urls).toEqual(['turn:anoncall-api.duckdns.org:3478']);

      // Recompute HMAC independently and verify
      const expectedHmac = crypto
        .createHmac('sha1', secret)
        .update(turn.username)
        .digest('base64');
      expect(turn.credential).toBe(expectedHmac);

      // Ensure no PII in username
      expect(turn.username).not.toContain(user.id);
      expect(turn.username).not.toContain(user.email);
    });
  });
});
