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
import { pushService, sendIncomingCallPush } from '../src/services/push.service.js';
import { generateAccessToken } from '../src/utils/token.js';

describe('Push Notification Service & Socket Integration', () => {
  const testSessionId = crypto.randomUUID();
  const testPushToken = 'fcm-device-token-sample-12345';

  describe('sendIncomingCallPush Unit Tests', () => {
    it('should return failure if pushToken is missing or null', async () => {
      const resNull = await sendIncomingCallPush(null, testSessionId);
      expect(resNull.success).toBe(false);
      expect(resNull.reason).toBe('missing_push_token');

      const resEmpty = await sendIncomingCallPush('', testSessionId);
      expect(resEmpty.success).toBe(false);
      expect(resEmpty.reason).toBe('missing_push_token');
    });

    it('should log and return structured high-priority data payload when pushToken is provided', async () => {
      const res = await sendIncomingCallPush(testPushToken, testSessionId);
      expect(res.success).toBe(true);
      expect(res.pushToken).toBe(testPushToken);
      expect(res.sessionId).toBe(testSessionId);
      expect(res.payload).toBeDefined();

      const { message } = res.payload;
      expect(message.token).toBe(testPushToken);
      expect(message.android.priority).toBe('high');
      expect(message.android.ttl).toBe('30s');
      expect(message.data.type).toBe('incoming_call');
      expect(message.data.sessionId).toBe(testSessionId);
      expect(message.data.ringSeconds).toBe('30');
    });
  });

  describe('Socket Call Find with Offline Callee (Push Trigger)', () => {
    let server;
    let ioServer;
    let callerSocket;
    let port;
    let mockClient;
    const callerId = crypto.randomUUID();
    const offlineCalleeId = crypto.randomUUID();
    const calleePushToken = 'callee-offline-push-token-999';
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
          return { rows: [{ id: callerId, email: 'caller@example.com', status: 'active' }] };
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

    it('should invoke sendIncomingCallPush when matched callee has no active socket', (done) => {
      // Callee is NOT connected to socket, but has push_token
      expect(userSocketMap.getSocketId(offlineCalleeId)).toBeNull();

      // Spy on push service
      const pushSpy = jest.spyOn(pushService, 'sendIncomingCallPush');

      // Setup matching mock queries
      mockClient.query
        // 1. BEGIN
        .mockResolvedValueOnce({ rowCount: 1 })
        // 2. Lock caller
        .mockResolvedValueOnce({
          rows: [{ id: callerId, status: 'active', is_available: true }],
        })
        // 3. Active call check
        .mockResolvedValueOnce({ rows: [] })
        // 4. Pre-call billing check
        .mockResolvedValueOnce({
          rows: [{ value_json: { mode: 'free' } }],
        })
        // 5. Candidate selection -> returns offline candidate with push_token
        .mockResolvedValueOnce({
          rows: [{ id: offlineCalleeId, push_token: calleePushToken }],
        })
        // 6. Insert call_sessions
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
        // 7. COMMIT
        .mockResolvedValueOnce({ rowCount: 1 });

      callerSocket.emit(SOCKET_EVENTS.CALL_FIND, {}, (res) => {
        expect(res.success).toBe(true);
        expect(res.callCode).toBe(mockCallCode);
        expect(res.status).toBe('ringing');

        // Verify push was dispatched for offline callee
        expect(pushSpy).toHaveBeenCalledWith(calleePushToken, mockSessionUUID);
        done();
      });
    });
  });
});
