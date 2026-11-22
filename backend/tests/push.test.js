import { jest } from '@jest/globals';
import http from 'http';
import request from 'supertest';
import { io as Client } from 'socket.io-client';
import crypto from 'crypto';
import { Expo } from 'expo-server-sdk';
import app from '../src/app.js';
import { pool } from '../src/db/index.js';
import { initSocketServer } from '../src/socket/index.js';
import { userSocketMap } from '../src/socket/userSocketMap.js';
import { callSessionManager } from '../src/socket/callSessionManager.js';
import { SOCKET_EVENTS } from '../src/socket/events.js';
import {
  expo,
  pushService,
  sendIncomingCallPush,
  clearPushToken,
  checkReceipt,
} from '../src/services/push.js';
import { generateAccessToken } from '../src/utils/token.js';

describe('Real Expo Push Notification Service & Socket Integration', () => {
  const testSessionId = crypto.randomUUID();
  const validExpoPushToken = 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]';
  const invalidPushToken = 'invalid-device-token-12345';

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('1. sendIncomingCallPush Unit Tests & Ticket/Receipt Handling', () => {
    it('should return failure if pushToken is missing or null', async () => {
      const resNull = await sendIncomingCallPush(null, testSessionId);
      expect(resNull.success).toBe(false);
      expect(resNull.reason).toBe('missing_push_token');

      const resEmpty = await sendIncomingCallPush('', testSessionId);
      expect(resEmpty.success).toBe(false);
      expect(resEmpty.reason).toBe('missing_push_token');
    });

    it('should remove invalid push tokens from database via Expo.isExpoPushToken check', async () => {
      const querySpy = jest.spyOn(pool, 'query').mockResolvedValue({ rowCount: 1 });

      const res = await sendIncomingCallPush(invalidPushToken, testSessionId);
      expect(res.success).toBe(false);
      expect(res.reason).toBe('invalid_push_token');

      // Verify the invalid token was removed from database
      expect(querySpy).toHaveBeenCalledWith(
        expect.stringContaining('SET push_token = NULL'),
        [invalidPushToken]
      );
    });

    it('should send structured message with title, body, priority high, channelId, ttl 30, and data', async () => {
      const sendSpy = jest.spyOn(expo, 'sendPushNotificationsAsync').mockResolvedValue([
        { status: 'ok', id: 'receipt-uuid-123' },
      ]);

      const res = await sendIncomingCallPush(validExpoPushToken, testSessionId);
      expect(res.success).toBe(true);
      expect(res.sessionId).toBe(testSessionId);
      expect(sendSpy).toHaveBeenCalledWith([
        {
          to: validExpoPushToken,
          sound: 'default',
          title: 'Incoming call',
          body: 'Someone wants to talk',
          priority: 'high',
          channelId: 'incoming_calls',
          ttl: 30,
          data: {
            type: 'incoming_call',
            sessionId: testSessionId,
          },
        },
      ]);
    });

    it('should handle ticket error DeviceNotRegistered by clearing push token in DB', async () => {
      const querySpy = jest.spyOn(pool, 'query').mockResolvedValue({ rowCount: 1 });
      jest.spyOn(expo, 'sendPushNotificationsAsync').mockResolvedValue([
        {
          status: 'error',
          message: 'Device not registered',
          details: { error: 'DeviceNotRegistered' },
        },
      ]);

      const res = await sendIncomingCallPush(validExpoPushToken, testSessionId);
      expect(res.success).toBe(true);
      expect(querySpy).toHaveBeenCalledWith(
        expect.stringContaining('SET push_token = NULL'),
        [validExpoPushToken]
      );
    });

    it('should handle receipt error DeviceNotRegistered by clearing push token in DB', async () => {
      const querySpy = jest.spyOn(pool, 'query').mockResolvedValue({ rowCount: 1 });
      jest.spyOn(expo, 'getPushNotificationReceiptsAsync').mockResolvedValue({
        'receipt-xyz': {
          status: 'error',
          message: 'The recipient device is no longer registered',
          details: { error: 'DeviceNotRegistered' },
        },
      });

      await checkReceipt('receipt-xyz', validExpoPushToken);

      expect(querySpy).toHaveBeenCalledWith(
        expect.stringContaining('SET push_token = NULL'),
        [validExpoPushToken]
      );
    });

    it('should catch send failure and return failure without throwing', async () => {
      jest.spyOn(expo, 'sendPushNotificationsAsync').mockRejectedValue(new Error('Network error'));

      const res = await sendIncomingCallPush(validExpoPushToken, testSessionId);
      expect(res.success).toBe(false);
      expect(res.error).toBe('Network error');
    });
  });

  describe('2. Socket Call Matching: Offline Callee Push & Push Failure Isolation', () => {
    let server;
    let ioServer;
    let callerSocket;
    let port;
    let mockClient;
    const callerId = crypto.randomUUID();
    const calleeId = crypto.randomUUID();
    const calleePushToken = 'ExponentPushToken[callee-test-token-777]';
    const mockSessionUUID = crypto.randomUUID();
    const mockCallCode = crypto.randomUUID();

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

      mockClient = {
        query: jest.fn(),
        release: jest.fn(),
      };

      jest.spyOn(pool, 'query').mockImplementation(async (sql, params) => {
        if (typeof sql === 'string' && sql.includes('FROM users WHERE id = $1')) {
          return { rows: [{ id: callerId, email: 'caller@example.com', status: 'active', is_available: true }] };
        }
        return { rows: [] };
      });

      jest.spyOn(pool, 'connect').mockResolvedValue(mockClient);

      const callerToken = generateAccessToken({ id: callerId, email: 'caller@example.com' });
      callerSocket = Client(`http://127.0.0.1:${port}`, {
        auth: { token: callerToken },
        transports: ['websocket'],
      });

      callerSocket.on('connect', () => {
        done();
      });
    });

    afterEach((done) => {
      callSessionManager.clear();
      userSocketMap.clear();
      jest.restoreAllMocks();

      if (callerSocket && callerSocket.connected) {
        callerSocket.disconnect();
      }
      setTimeout(done, 50);
    });

    it('should NOT send push when matched callee has an active socket connection', (done) => {
      // Simulate callee connected to socket
      userSocketMap.set(calleeId, 'mock-callee-socket-id');

      const pushSpy = jest.spyOn(pushService, 'sendIncomingCallPush');

      // Setup DB mocks for call matching
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: callerId, status: 'active', is_available: true }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ value_json: { mode: 'free' } }] })
        .mockResolvedValueOnce({ rows: [{ id: calleeId, push_token: calleePushToken }] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: mockSessionUUID,
              call_code: mockCallCode,
              status: 'ringing',
              billing_mode: 'free',
              requested_at: new Date().toISOString(),
            },
          ],
        })
        .mockResolvedValueOnce({ rowCount: 1 }); // COMMIT

      callerSocket.emit(SOCKET_EVENTS.CALL_FIND, {}, (res) => {
        expect(res.success).toBe(true);
        expect(pushSpy).not.toHaveBeenCalled();
        done();
      });
    });

    it('should invoke sendIncomingCallPush when matched callee has NO active socket', (done) => {
      // Callee is NOT in userSocketMap
      expect(userSocketMap.getSocketId(calleeId)).toBeNull();

      const pushSpy = jest.spyOn(pushService, 'sendIncomingCallPush').mockResolvedValue({ success: true });

      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: callerId, status: 'active', is_available: true }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ value_json: { mode: 'free' } }] })
        .mockResolvedValueOnce({ rows: [{ id: calleeId, push_token: calleePushToken }] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: mockSessionUUID,
              call_code: mockCallCode,
              status: 'ringing',
              billing_mode: 'free',
              requested_at: new Date().toISOString(),
            },
          ],
        })
        .mockResolvedValueOnce({ rowCount: 1 }); // COMMIT

      callerSocket.emit(SOCKET_EVENTS.CALL_FIND, {}, (res) => {
        expect(res.success).toBe(true);
        expect(pushSpy).toHaveBeenCalledWith(calleePushToken, mockSessionUUID);
        done();
      });
    });

    it('should ensure push failure does NOT break call matching', (done) => {
      // Simulate pushService throwing an error
      jest.spyOn(pushService, 'sendIncomingCallPush').mockRejectedValue(new Error('Expo servers down'));

      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ id: callerId, status: 'active', is_available: true }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ value_json: { mode: 'free' } }] })
        .mockResolvedValueOnce({ rows: [{ id: calleeId, push_token: calleePushToken }] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: mockSessionUUID,
              call_code: mockCallCode,
              status: 'ringing',
              billing_mode: 'free',
              requested_at: new Date().toISOString(),
            },
          ],
        })
        .mockResolvedValueOnce({ rowCount: 1 });

      callerSocket.emit(SOCKET_EVENTS.CALL_FIND, {}, (res) => {
        // Matching succeeds despite push failure
        expect(res.success).toBe(true);
        expect(res.callCode).toBe(mockCallCode);
        expect(res.status).toBe('ringing');
        done();
      });
    });
  });

  describe('3. Pending-Call Support on Socket Connect & Accept', () => {
    let server;
    let ioServer;
    let port;

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
      callSessionManager.clear();
      userSocketMap.clear();

      jest.spyOn(pool, 'query').mockImplementation(async (sql, params) => {
        if (typeof sql === 'string' && sql.includes('FROM users WHERE id = $1')) {
          const uId = params[0];
          return { rows: [{ id: uId, email: `${uId}@example.com`, status: 'active', is_available: true }] };
        }
        return { rows: [] };
      });
    });

    afterEach(() => {
      callSessionManager.clear();
      userSocketMap.clear();
      jest.restoreAllMocks();
    });

    it('should emit call:incoming to callee socket when callee connects during ringing state', (done) => {
      const connectCalleeId = crypto.randomUUID();
      const connectCallerId = crypto.randomUUID();
      const connectCallCode = crypto.randomUUID();
      const connectSessionId = crypto.randomUUID();

      // 1. Create a ringing call session in memory (as when caller matched an offline callee)
      callSessionManager.createSession({
        sessionId: connectSessionId,
        callCode: connectCallCode,
        callerId: connectCallerId,
        calleeId: connectCalleeId,
        billingMode: 'free',
        ringTimeoutMs: 30000,
      });

      // 2. Connect callee socket
      const calleeToken = generateAccessToken({ id: connectCalleeId, email: 'connect@example.com' });
      const calleeSocket = Client(`http://127.0.0.1:${port}`, {
        auth: { token: calleeToken },
        transports: ['websocket'],
      });

      calleeSocket.on(SOCKET_EVENTS.CALL_INCOMING, (payload) => {
        expect(payload.sessionId).toBe(connectSessionId);
        expect(payload.callCode).toBe(connectCallCode);
        expect(payload.role).toBe('callee');
        expect(payload.ringSeconds).toBeGreaterThan(0);
        calleeSocket.disconnect();
        done();
      });
    });

    it('should return pending call payload via socket event call:pending', (done) => {
      const pendingCalleeId = crypto.randomUUID();
      const pendingCallerId = crypto.randomUUID();
      const pendingCallCode = crypto.randomUUID();
      const pendingSessionId = crypto.randomUUID();

      callSessionManager.createSession({
        sessionId: pendingSessionId,
        callCode: pendingCallCode,
        callerId: pendingCallerId,
        calleeId: pendingCalleeId,
        billingMode: 'free',
        ringTimeoutMs: 30000,
      });

      const calleeToken = generateAccessToken({ id: pendingCalleeId, email: 'callee2@example.com' });
      const calleeSocket = Client(`http://127.0.0.1:${port}`, {
        auth: { token: calleeToken },
        transports: ['websocket'],
      });

      calleeSocket.on('connect', () => {
        calleeSocket.emit('call:pending', (res) => {
          expect(res.success).toBe(true);
          expect(res.hasPendingCall).toBe(true);
          expect(res.session.callCode).toBe(pendingCallCode);
          expect(res.session.sessionId).toBe(pendingSessionId);
          calleeSocket.disconnect();
          done();
        });
      });
    });

    it('should allow accepting call after connecting and cancel ring timer cleanly without doubling', (done) => {
      let timeoutFired = false;
      const acceptCalleeId = crypto.randomUUID();
      const acceptCallerId = crypto.randomUUID();
      const acceptCallCode = crypto.randomUUID();
      const acceptSessionId = crypto.randomUUID();

      const session = callSessionManager.createSession({
        sessionId: acceptSessionId,
        callCode: acceptCallCode,
        callerId: acceptCallerId,
        calleeId: acceptCalleeId,
        billingMode: 'free',
        ringTimeoutMs: 500,
        onRingTimeout: () => {
          timeoutFired = true;
        },
      });

      expect(session.ringingTimer).not.toBeNull();

      const calleeToken = generateAccessToken({ id: acceptCalleeId, email: 'accept@example.com' });
      const calleeSocket = Client(`http://127.0.0.1:${port}`, {
        auth: { token: calleeToken },
        transports: ['websocket'],
      });

      calleeSocket.on('connect', () => {
        calleeSocket.emit(SOCKET_EVENTS.CALL_ACCEPT, { callCode: acceptCallCode }, (ack) => {
          expect(ack.success).toBe(true);
          expect(session.status).toBe('connected');
          // Timer should be cleared
          expect(session.ringingTimer).toBeNull();

          // Wait past the original 500ms to verify onRingTimeout is never called
          setTimeout(() => {
            expect(timeoutFired).toBe(false);
            calleeSocket.disconnect();
            done();
          }, 600);
        });
      });
    });
  });

  describe('4. Session State Endpoint & Participant Authorization', () => {
    const callerId = crypto.randomUUID();
    const calleeId = crypto.randomUUID();
    const thirdPartyId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const callCode = crypto.randomUUID();

    const callerToken = generateAccessToken({ id: callerId, email: 'caller@example.com' });
    const calleeToken = generateAccessToken({ id: calleeId, email: 'callee@example.com' });
    const thirdPartyToken = generateAccessToken({ id: thirdPartyId, email: 'third@example.com' });

    beforeEach(() => {
      callSessionManager.clear();
      jest.spyOn(pool, 'query').mockImplementation(async (sql, params) => {
        if (typeof sql === 'string' && sql.includes('FROM users WHERE id = $1')) {
          const uId = params[0];
          return { rows: [{ id: uId, email: `${uId}@example.com`, status: 'active', is_available: true }] };
        }
        return { rows: [] };
      });
    });

    afterEach(() => {
      callSessionManager.clear();
      jest.restoreAllMocks();
    });

    it('should return 401 if request is unauthenticated', async () => {
      const res = await request(app).get(`/calls/session/${sessionId}`);
      expect(res.status).toBe(401);
    });

    it('should return 404 if session does not exist in DB', async () => {
      jest.spyOn(pool, 'query').mockImplementation(async (sql, params) => {
        if (typeof sql === 'string' && sql.includes('FROM users WHERE id = $1')) {
          return { rows: [{ id: callerId, email: 'caller@example.com', status: 'active', is_available: true }] };
        }
        if (typeof sql === 'string' && sql.includes('FROM call_sessions')) {
          return { rows: [] };
        }
        return { rows: [] };
      });

      const res = await request(app)
        .get(`/calls/session/${sessionId}`)
        .set('Authorization', `Bearer ${callerToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Session not found');
    });

    it('should return 403 Forbidden when requester is NOT a participant', async () => {
      jest.spyOn(pool, 'query').mockImplementation(async (sql, params) => {
        if (typeof sql === 'string' && sql.includes('FROM users WHERE id = $1')) {
          return { rows: [{ id: thirdPartyId, email: 'third@example.com', status: 'active', is_available: true }] };
        }
        if (typeof sql === 'string' && sql.includes('FROM call_sessions')) {
          return {
            rows: [
              {
                id: sessionId,
                call_code: callCode,
                caller_id: callerId,
                callee_id: calleeId,
                status: 'ringing',
                requested_at: new Date().toISOString(),
              },
            ],
          };
        }
        return { rows: [] };
      });

      const res = await request(app)
        .get(`/calls/session/${sessionId}`)
        .set('Authorization', `Bearer ${thirdPartyToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Forbidden');
    });

    it('should return ONLY the status field: "ringing" when active', async () => {
      callSessionManager.createSession({
        sessionId,
        callCode,
        callerId,
        calleeId,
        billingMode: 'free',
        ringTimeoutMs: 30000,
      });

      jest.spyOn(pool, 'query').mockImplementation(async (sql, params) => {
        if (typeof sql === 'string' && sql.includes('FROM users WHERE id = $1')) {
          return { rows: [{ id: calleeId, email: 'callee@example.com', status: 'active', is_available: true }] };
        }
        if (typeof sql === 'string' && sql.includes('FROM call_sessions')) {
          return {
            rows: [
              {
                id: sessionId,
                call_code: callCode,
                caller_id: callerId,
                callee_id: calleeId,
                status: 'ringing',
                requested_at: new Date().toISOString(),
              },
            ],
          };
        }
        return { rows: [] };
      });

      const res = await request(app)
        .get(`/calls/session/${sessionId}`)
        .set('Authorization', `Bearer ${calleeToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ringing' });
      expect(Object.keys(res.body)).toEqual(['status']);
    });

    it('should return status: "missed" when ringing call timed out past 30s', async () => {
      const pastTime = new Date(Date.now() - 35000).toISOString();

      jest.spyOn(pool, 'query').mockImplementation(async (sql, params) => {
        if (typeof sql === 'string' && sql.includes('FROM users WHERE id = $1')) {
          return { rows: [{ id: callerId, email: 'caller@example.com', status: 'active', is_available: true }] };
        }
        if (typeof sql === 'string' && sql.includes('FROM call_sessions')) {
          return {
            rows: [
              {
                id: sessionId,
                call_code: callCode,
                caller_id: callerId,
                callee_id: calleeId,
                status: 'ringing',
                requested_at: pastTime,
              },
            ],
          };
        }
        return { rows: [] };
      });

      const res = await request(app)
        .get(`/calls/session/${sessionId}`)
        .set('Authorization', `Bearer ${callerToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'missed' });
    });

    it('should return status: "ended" when session concluded', async () => {
      jest.spyOn(pool, 'query').mockImplementation(async (sql, params) => {
        if (typeof sql === 'string' && sql.includes('FROM users WHERE id = $1')) {
          return { rows: [{ id: callerId, email: 'caller@example.com', status: 'active', is_available: true }] };
        }
        if (typeof sql === 'string' && sql.includes('FROM call_sessions')) {
          return {
            rows: [
              {
                id: sessionId,
                call_code: callCode,
                caller_id: callerId,
                callee_id: calleeId,
                status: 'ended',
                end_reason: 'caller_hangup',
                requested_at: new Date().toISOString(),
              },
            ],
          };
        }
        return { rows: [] };
      });

      const res = await request(app)
        .get(`/calls/session/${sessionId}`)
        .set('Authorization', `Bearer ${callerToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ended' });
    });
  });
});
