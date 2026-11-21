import { jest, describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from '@jest/globals';
import http from 'node:http';
import crypto from 'node:crypto';
import { io as ioClient } from 'socket.io-client';
import app from '../src/app.js';
import { pool } from '../src/db/index.js';
import { initSocketServer, userSocketMap, callSessionManager, SOCKET_EVENTS } from '../src/socket/index.js';
import { generateAccessToken } from '../src/utils/token.js';

describe('Caller Cancel and Disconnect During Ringing State', () => {
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
    querySpy.mockRestore();
  });

  it('caller sending cancel (call:end) during ringing ends session with caller_left and clears timer', (done) => {
    const { caller, callee, callCode, sessionId } = createTestPair();
    const callerToken = generateAccessToken(caller);
    const calleeToken = generateAccessToken(callee);

    const session = callSessionManager.createSession({
      sessionId,
      callCode,
      callerId: caller.id,
      calleeId: callee.id,
      billingMode: 'free',
      ringTimeoutMs: 15000,
    });

    const calleeSocket = ioClient(`http://127.0.0.1:${port}`, {
      transports: ['websocket'],
      reconnection: false,
      auth: { token: calleeToken },
    });

    calleeSocket.on('connect', () => {
      calleeSocket.on('call:ended', (payload) => {
        expect(payload.callCode).toBe(callCode);
        expect(payload.reason).toBe('caller_left');
        expect(payload.durationSeconds).toBe(0);
        expect(callSessionManager.getSession(callCode)).toBeNull();
        expect(session.ringingTimer).toBeNull();

        calleeSocket.disconnect();
        done();
      });

      const callerSocket = ioClient(`http://127.0.0.1:${port}`, {
        transports: ['websocket'],
        reconnection: false,
        auth: { token: callerToken },
      });

      callerSocket.on('connect', () => {
        callerSocket.emit('call:end', { callCode, reason: 'caller_left' }, (ack) => {
          expect(ack.success).toBe(true);
          expect(ack.reason).toBe('caller_left');
          expect(ack.durationSeconds).toBe(0);
          callerSocket.disconnect();
        });
      });
    });
  });

  it('caller socket disconnect during ringing ends session with caller_left, clears timer, and notifies callee', (done) => {
    const { caller, callee, callCode, sessionId } = createTestPair();
    const callerToken = generateAccessToken(caller);
    const calleeToken = generateAccessToken(callee);

    const session = callSessionManager.createSession({
      sessionId,
      callCode,
      callerId: caller.id,
      calleeId: callee.id,
      billingMode: 'free',
      ringTimeoutMs: 15000,
    });

    const calleeSocket = ioClient(`http://127.0.0.1:${port}`, {
      transports: ['websocket'],
      reconnection: false,
      auth: { token: calleeToken },
    });

    calleeSocket.on('connect', () => {
      calleeSocket.on('call:ended', (payload) => {
        expect(payload.callCode).toBe(callCode);
        expect(payload.reason).toBe('caller_left');
        expect(payload.durationSeconds).toBe(0);
        expect(callSessionManager.getSession(callCode)).toBeNull();
        expect(session.ringingTimer).toBeNull();

        calleeSocket.disconnect();
        done();
      });

      const callerSocket = ioClient(`http://127.0.0.1:${port}`, {
        transports: ['websocket'],
        reconnection: false,
        auth: { token: callerToken },
      });

      callerSocket.on('connect', () => {
        // Disconnect caller socket while call is in ringing state
        callerSocket.disconnect();
      });
    });
  });
});
