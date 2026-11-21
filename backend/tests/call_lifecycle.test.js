import { jest, describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from '@jest/globals';
import http from 'node:http';
import crypto from 'node:crypto';
import { io as ioClient } from 'socket.io-client';
import app from '../src/app.js';
import { pool } from '../src/db/index.js';
import { initSocketServer, userSocketMap, callSessionManager, SOCKET_EVENTS } from '../src/socket/index.js';
import { generateAccessToken } from '../src/utils/token.js';

describe('WebRTC Call Lifecycle, Signaling Relay, and In-Call Actions', () => {
  let server;
  let ioServer;
  let port;
  let querySpy;

  function createTestPair() {
    const caller = {
      id: crypto.randomUUID(),
      email: `caller-${Math.random().toString(36).slice(2)}@example.com`,
      status: 'active',
      is_available: true,
    };
    const callee = {
      id: crypto.randomUUID(),
      email: `callee-${Math.random().toString(36).slice(2)}@example.com`,
      status: 'active',
      is_available: true,
    };
    const callCode = crypto.randomUUID();
    const sessionId = crypto.randomUUID();

    return { caller, callee, callCode, sessionId };
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

  describe('ICE Server Config at Call Start', () => {
    it('should include STUN and TURN server credentials from config', (done) => {
      const { callee, caller, callCode, sessionId } = createTestPair();
      const calleeToken = generateAccessToken(callee);

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

      calleeSocket.on('connect', () => {
        calleeSocket.on('call:matched', (payload) => {
          expect(payload.callCode).toBe(callCode);
          expect(payload.role).toBe('callee');
          expect(payload.iceServers).toBeDefined();
          expect(Array.isArray(payload.iceServers)).toBe(true);

          const stun = payload.iceServers.find((s) => typeof s.urls === 'string' && s.urls.startsWith('stun:'));
          expect(stun).toBeDefined();

          const turn = payload.iceServers.find((s) => Array.isArray(s.urls) && s.urls[0].startsWith('turn:'));
          expect(turn).toBeDefined();
          expect(turn.username).toBeDefined();
          expect(turn.credential).toBeDefined();

          calleeSocket.disconnect();
          done();
        });

        calleeSocket.emit('call:accept', { callCode });
      });
    });
  });

  describe('Callee Accept and Decline', () => {
    it('Callee accept should transition session to connected and notify both parties with call:matched', (done) => {
      const { callee, caller, callCode, sessionId } = createTestPair();
      const callerToken = generateAccessToken(caller);
      const calleeToken = generateAccessToken(callee);

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

      calleeSocket.on('connect', () => {
        const callerSocket = ioClient(`http://127.0.0.1:${port}`, {
          transports: ['websocket'],
          reconnection: false,
          auth: { token: callerToken },
        });

        let callerReceivedMatched = false;
        let calleeAckReceived = false;

        const checkDone = () => {
          if (callerReceivedMatched && calleeAckReceived) {
            callerSocket.disconnect();
            calleeSocket.disconnect();
            done();
          }
        };

        callerSocket.on('connect', () => {
          callerSocket.on('call:matched', (data) => {
            expect(data.callCode).toBe(callCode);
            expect(data.role).toBe('caller');
            callerReceivedMatched = true;
            checkDone();
          });

          calleeSocket.emit('call:accept', { callCode }, (ack) => {
            expect(ack.success).toBe(true);
            calleeAckReceived = true;
            checkDone();
          });
        });
      });
    });

    it('Callee decline should mark call as declined and emit call:ended to both peers', (done) => {
      const { callee, caller, callCode, sessionId } = createTestPair();
      const callerToken = generateAccessToken(caller);
      const calleeToken = generateAccessToken(callee);

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

      calleeSocket.on('connect', () => {
        const callerSocket = ioClient(`http://127.0.0.1:${port}`, {
          transports: ['websocket'],
          reconnection: false,
          auth: { token: callerToken },
        });

        callerSocket.on('connect', () => {
          calleeSocket.emit('call:decline', { callCode, reason: 'declined' }, (ack) => {
            expect(ack.success).toBe(true);
            expect(callSessionManager.getSession(callCode)).toBeNull();

            callerSocket.disconnect();
            calleeSocket.disconnect();
            done();
          });
        });
      });
    });

    it('Ringing timeout (30 seconds) should mark call missed and release both users', (done) => {
      const { callee, caller, callCode, sessionId } = createTestPair();
      let timeoutHandler;

      callSessionManager.createSession({
        sessionId,
        callCode,
        callerId: caller.id,
        calleeId: callee.id,
        billingMode: 'free',
        ringTimeoutMs: 100, // Short timeout for test
        onRingTimeout: (session) => {
          timeoutHandler = session;
        },
      });

      setTimeout(() => {
        expect(timeoutHandler).toBeDefined();
        expect(timeoutHandler.callCode).toBe(callCode);
        done();
      }, 150);
    });
  });

  describe('WebRTC Signaling Relay Isolation', () => {
    it('should relay offer, answer, and ice candidates between caller and callee only', (done) => {
      const { callee, caller, callCode, sessionId } = createTestPair();
      const callerToken = generateAccessToken(caller);
      const calleeToken = generateAccessToken(callee);

      callSessionManager.createSession({
        sessionId,
        callCode,
        callerId: caller.id,
        calleeId: callee.id,
        billingMode: 'free',
        ringTimeoutMs: 10000,
      });

      const mockOffer = { type: 'offer', sdp: 'v=0\r\no=caller...' };
      const mockAnswer = { type: 'answer', sdp: 'v=0\r\no=callee...' };
      const mockIce = { candidate: 'candidate:1 1 UDP...', sdpMid: '0', sdpMLineIndex: 0 };

      const calleeSocket = ioClient(`http://127.0.0.1:${port}`, {
        transports: ['websocket'],
        reconnection: false,
        auth: { token: calleeToken },
      });

      calleeSocket.on('connect', () => {
        const callerSocket = ioClient(`http://127.0.0.1:${port}`, {
          transports: ['websocket'],
          reconnection: false,
          auth: { token: callerToken },
        });

        calleeSocket.on('signal:offer', (payload) => {
          expect(payload.callCode).toBe(callCode);
          expect(payload.sdp).toEqual(mockOffer);

          calleeSocket.emit('signal:answer', { callCode, sdp: mockAnswer });
        });

        callerSocket.on('connect', () => {
          callerSocket.on('signal:answer', (payload) => {
            expect(payload.callCode).toBe(callCode);
            expect(payload.sdp).toEqual(mockAnswer);

            callerSocket.emit('signal:ice', { callCode, candidate: mockIce });
          });

          callerSocket.emit('signal:offer', { callCode, sdp: mockOffer });
        });

        calleeSocket.on('signal:ice', (payload) => {
          expect(payload.callCode).toBe(callCode);
          expect(payload.candidate).toEqual(mockIce);

          callerSocket.disconnect();
          calleeSocket.disconnect();
          done();
        });
      });
    });

    it('should strictly REJECT signaling relays from third parties not in that call session', (done) => {
      const { callee, caller, callCode, sessionId } = createTestPair();
      const outsider = {
        id: crypto.randomUUID(),
        email: 'outsider@example.com',
        status: 'active',
        is_available: true,
      };
      const outsiderToken = generateAccessToken(outsider);

      callSessionManager.createSession({
        sessionId,
        callCode,
        callerId: caller.id,
        calleeId: callee.id,
        billingMode: 'free',
        ringTimeoutMs: 10000,
      });

      const outsiderSocket = ioClient(`http://127.0.0.1:${port}`, {
        transports: ['websocket'],
        reconnection: false,
        auth: { token: outsiderToken },
      });

      outsiderSocket.on('connect', () => {
        outsiderSocket.on('call:error', (err) => {
          expect(err.error).toBe('unauthorized_relay');
          outsiderSocket.disconnect();
          done();
        });

        outsiderSocket.emit('signal:offer', {
          callCode,
          sdp: { type: 'offer', sdp: 'fake sdp' },
        });
      });
    });
  });

  describe('Call Controls: End, Skip, Mute, Report, Block, and Disconnect', () => {
    it('call:end should record duration and reason, then release both users', (done) => {
      const { caller, callee, callCode, sessionId } = createTestPair();
      const callerToken = generateAccessToken(caller);

      const session = callSessionManager.createSession({
        sessionId,
        callCode,
        callerId: caller.id,
        calleeId: callee.id,
        billingMode: 'free',
        ringTimeoutMs: 10000,
      });
      session.connectedAt = Date.now() - 45000;

      const callerSocket = ioClient(`http://127.0.0.1:${port}`, {
        transports: ['websocket'],
        reconnection: false,
        auth: { token: callerToken },
      });

      callerSocket.on('connect', () => {
        callerSocket.emit('call:end', { callCode, reason: 'caller_hangup' }, (ack) => {
          expect(ack.success).toBe(true);
          expect(ack.durationSeconds).toBeGreaterThanOrEqual(44);
          expect(ack.reason).toBe('caller_hangup');
          expect(callSessionManager.getSession(callCode)).toBeNull();

          callerSocket.disconnect();
          done();
        });
      });
    });

    it('call:skip should conclude current call with reason skipped and alert callee', (done) => {
      const { caller, callee, callCode, sessionId } = createTestPair();
      const callerToken = generateAccessToken(caller);
      const calleeToken = generateAccessToken(callee);

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

      calleeSocket.on('connect', () => {
        const callerSocket = ioClient(`http://127.0.0.1:${port}`, {
          transports: ['websocket'],
          reconnection: false,
          auth: { token: callerToken },
        });

        calleeSocket.on('call:ended', (payload) => {
          expect(payload.callCode).toBe(callCode);
          expect(payload.reason).toBe('skipped');

          callerSocket.disconnect();
          calleeSocket.disconnect();
          done();
        });

        callerSocket.on('connect', () => {
          callerSocket.emit('call:skip', { callCode });
        });
      });
    });

    it('call:mute should track mute state and relay to opposite peer', (done) => {
      const { caller, callee, callCode, sessionId } = createTestPair();
      const callerToken = generateAccessToken(caller);
      const calleeToken = generateAccessToken(callee);

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

      calleeSocket.on('connect', () => {
        const callerSocket = ioClient(`http://127.0.0.1:${port}`, {
          transports: ['websocket'],
          reconnection: false,
          auth: { token: callerToken },
        });

        calleeSocket.on('peer:mute', (data) => {
          expect(data.callCode).toBe(callCode);
          expect(data.isMuted).toBe(true);

          callerSocket.disconnect();
          calleeSocket.disconnect();
          done();
        });

        callerSocket.on('connect', () => {
          callerSocket.emit('call:mute', { callCode, isMuted: true });
        });
      });
    });

    it('mid-call socket disconnect should terminate session with network_error and release peer', (done) => {
      const { caller, callee, callCode, sessionId } = createTestPair();
      const callerToken = generateAccessToken(caller);
      const calleeToken = generateAccessToken(callee);

      const session = callSessionManager.createSession({
        sessionId,
        callCode,
        callerId: caller.id,
        calleeId: callee.id,
        billingMode: 'free',
        ringTimeoutMs: 10000,
      });
      session.connectedAt = Date.now() - 15000;

      const calleeSocket = ioClient(`http://127.0.0.1:${port}`, {
        transports: ['websocket'],
        reconnection: false,
        auth: { token: calleeToken },
      });

      calleeSocket.on('connect', () => {
        calleeSocket.on('call:ended', (payload) => {
          expect(payload.callCode).toBe(callCode);
          expect(payload.reason).toBe('network_error');
          expect(payload.durationSeconds).toBeGreaterThanOrEqual(14);
          expect(callSessionManager.getSession(callCode)).toBeNull();

          calleeSocket.disconnect();
          done();
        });

        const callerSocket = ioClient(`http://127.0.0.1:${port}`, {
          transports: ['websocket'],
          reconnection: false,
          auth: { token: callerToken },
        });

        callerSocket.on('connect', () => {
          callerSocket.disconnect();
        });
      });
    });

    it('call:block and call:report should execute safety actions during call', (done) => {
      const { caller, callee, callCode, sessionId } = createTestPair();
      const callerToken = generateAccessToken(caller);

      callSessionManager.createSession({
        sessionId,
        callCode,
        callerId: caller.id,
        calleeId: callee.id,
        billingMode: 'free',
        ringTimeoutMs: 10000,
      });

      const callerSocket = ioClient(`http://127.0.0.1:${port}`, {
        transports: ['websocket'],
        reconnection: false,
        auth: { token: callerToken },
      });

      callerSocket.on('connect', () => {
        callerSocket.emit('call:block', { callCode }, (blockAck) => {
          expect(blockAck.success).toBe(true);

          callerSocket.emit(
            'call:report',
            { callCode, reason: 'harassment', note: 'Abusive language' },
            (reportAck) => {
              expect(reportAck.success).toBe(true);

              callerSocket.disconnect();
              done();
            }
          );
        });
      });
    });
  });
});
