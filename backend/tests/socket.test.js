import { jest, describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from '@jest/globals';
import http from 'node:http';
import { io as ioClient } from 'socket.io-client';
import app from '../src/app.js';
import { pool } from '../src/db/index.js';
import { initSocketServer, userSocketMap, SOCKET_EVENTS } from '../src/socket/index.js';
import { generateAccessToken } from '../src/utils/token.js';

describe('Socket.IO Gateway & Authentication', () => {
  let server;
  let ioServer;
  let port;
  let querySpy;

  const mockActiveUser = {
    id: 'user-uuid-101',
    email: 'caller@example.com',
    status: 'active',
    is_available: true,
  };

  const mockBannedUser = {
    id: 'user-uuid-banned',
    email: 'banned@example.com',
    status: 'banned',
    is_available: false,
  };

  const mockSuspendedUser = {
    id: 'user-uuid-suspended',
    email: 'suspended@example.com',
    status: 'suspended',
    is_available: false,
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
    querySpy = jest.spyOn(pool, 'query');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Socket Event Names Definition', () => {
    it('should define exact event names matching docs/API_SPEC.md and docs/CALL_FLOW.md', () => {
      expect(SOCKET_EVENTS.PRESENCE_HELLO).toBe('presence:hello');
      expect(SOCKET_EVENTS.CALL_FIND).toBe('call:find');
      expect(SOCKET_EVENTS.CALL_REQUEST).toBe('call:request');
      expect(SOCKET_EVENTS.CALL_RINGING).toBe('call:ringing');
      expect(SOCKET_EVENTS.CALL_INCOMING).toBe('call:incoming');
      expect(SOCKET_EVENTS.CALL_ACCEPT).toBe('call:accept');
      expect(SOCKET_EVENTS.CALL_DECLINE).toBe('call:decline');
      expect(SOCKET_EVENTS.CALL_NONE_AVAILABLE).toBe('call:none-available');
      expect(SOCKET_EVENTS.NO_USERS_AVAILABLE).toBe('no_users_available');
      expect(SOCKET_EVENTS.CALL_MATCHED).toBe('call:matched');
      expect(SOCKET_EVENTS.SIGNAL_OFFER).toBe('signal:offer');
      expect(SOCKET_EVENTS.SIGNAL_ANSWER).toBe('signal:answer');
      expect(SOCKET_EVENTS.SIGNAL_ICE).toBe('signal:ice');
      expect(SOCKET_EVENTS.CALL_CONNECTED).toBe('call:connected');
      expect(SOCKET_EVENTS.BILLING_WARNING).toBe('billing:warning');
      expect(SOCKET_EVENTS.BILLING_BALANCE).toBe('billing:balance');
      expect(SOCKET_EVENTS.CALL_END).toBe('call:end');
      expect(SOCKET_EVENTS.CALL_ENDED).toBe('call:ended');
    });
  });

  describe('Socket Authentication Middleware', () => {
    it('should reject connection when no token is provided', (done) => {
      const client = ioClient(`http://127.0.0.1:${port}`, {
        transports: ['websocket'],
        reconnection: false,
      });

      client.on('connect_error', (err) => {
        expect(err.message).toBe('Authentication error: Token is required');
        client.disconnect();
        done();
      });

      client.on('connect', () => {
        client.disconnect();
        done(new Error('Should not have connected without token'));
      });
    });

    it('should reject connection with invalid or malformed token', (done) => {
      const client = ioClient(`http://127.0.0.1:${port}`, {
        transports: ['websocket'],
        reconnection: false,
        auth: {
          token: 'invalid.jwt.token.string',
        },
      });

      client.on('connect_error', (err) => {
        expect(err.message).toBe('Authentication error: Invalid or expired token');
        client.disconnect();
        done();
      });

      client.on('connect', () => {
        client.disconnect();
        done(new Error('Should not have connected with invalid token'));
      });
    });

    it('should reject connection when user does not exist in database', (done) => {
      const token = generateAccessToken({ id: 'non-existent-user-id' });
      querySpy.mockResolvedValueOnce({ rows: [] });

      const client = ioClient(`http://127.0.0.1:${port}`, {
        transports: ['websocket'],
        reconnection: false,
        auth: { token },
      });

      client.on('connect_error', (err) => {
        expect(err.message).toBe('Authentication error: User not found');
        client.disconnect();
        done();
      });

      client.on('connect', () => {
        client.disconnect();
        done(new Error('Should not have connected for non-existent user'));
      });
    });

    it('should reject connection when user status is banned', (done) => {
      const token = generateAccessToken(mockBannedUser);
      querySpy.mockResolvedValueOnce({ rows: [mockBannedUser] });

      const client = ioClient(`http://127.0.0.1:${port}`, {
        transports: ['websocket'],
        reconnection: false,
        auth: { token },
      });

      client.on('connect_error', (err) => {
        expect(err.message).toBe('Authentication error: User account is banned');
        client.disconnect();
        done();
      });

      client.on('connect', () => {
        client.disconnect();
        done(new Error('Should not have connected for banned user'));
      });
    });

    it('should reject connection when user status is suspended', (done) => {
      const token = generateAccessToken(mockSuspendedUser);
      querySpy.mockResolvedValueOnce({ rows: [mockSuspendedUser] });

      const client = ioClient(`http://127.0.0.1:${port}`, {
        transports: ['websocket'],
        reconnection: false,
        auth: { token },
      });

      client.on('connect_error', (err) => {
        expect(err.message).toBe('Authentication error: User account is suspended');
        client.disconnect();
        done();
      });

      client.on('connect', () => {
        client.disconnect();
        done(new Error('Should not have connected for suspended user'));
      });
    });

    it('should accept connection with valid JWT via auth.token and query.token', (done) => {
      const token = generateAccessToken(mockActiveUser);
      querySpy.mockResolvedValue({ rows: [mockActiveUser] });

      const client = ioClient(`http://127.0.0.1:${port}`, {
        transports: ['websocket'],
        reconnection: false,
        query: { token },
      });

      client.on('connect', () => {
        expect(client.connected).toBe(true);
        client.disconnect();
        done();
      });

      client.on('connect_error', (err) => {
        done(err);
      });
    });
  });

  describe('User-to-Socket Mapping and Clean Disconnect', () => {
    it('should track connected userId in userSocketMap and cleanly remove on disconnect', (done) => {
      const token = generateAccessToken(mockActiveUser);
      querySpy.mockResolvedValue({ rows: [mockActiveUser] });

      expect(userSocketMap.hasUser(mockActiveUser.id)).toBe(false);
      expect(userSocketMap.getOnlineCount()).toBe(0);

      const client = ioClient(`http://127.0.0.1:${port}`, {
        transports: ['websocket'],
        reconnection: false,
        auth: { token },
      });

      client.on('connect', () => {
        expect(client.connected).toBe(true);

        // Verification of in-memory mapping
        const socketId = userSocketMap.getSocketId(mockActiveUser.id);
        expect(socketId).toBe(client.id);
        expect(userSocketMap.getUserId(socketId)).toBe(mockActiveUser.id);
        expect(userSocketMap.hasUser(mockActiveUser.id)).toBe(true);
        expect(userSocketMap.getOnlineCount()).toBe(1);
        expect(userSocketMap.getOnlineUserIds()).toContain(mockActiveUser.id);

        // Emit presence:hello without error
        client.emit(SOCKET_EVENTS.PRESENCE_HELLO);

        // Disconnect and verify clean removal
        client.disconnect();
      });

      client.on('disconnect', () => {
        // Allow small tick for server to process disconnect event
        setTimeout(() => {
          expect(userSocketMap.hasUser(mockActiveUser.id)).toBe(false);
          expect(userSocketMap.getSocketId(mockActiveUser.id)).toBeNull();
          expect(userSocketMap.getOnlineCount()).toBe(0);
          done();
        }, 50);
      });

      client.on('connect_error', (err) => {
        done(err);
      });
    });
  });

  describe('SEC-10: Socket Event Payload Validation', () => {
    let client;
    const token = generateAccessToken(mockActiveUser);

    beforeEach((done) => {
      querySpy.mockResolvedValue({ rows: [mockActiveUser] });
      client = ioClient(`http://127.0.0.1:${port}`, {
        transports: ['websocket'],
        reconnection: false,
        auth: { token },
      });
      client.on('connect', done);
      client.on('connect_error', done);
    });

    afterEach(() => {
      if (client && client.connected) {
        client.disconnect();
      }
    });

    it('should reject signal:offer when payload is not an object or callCode is missing', (done) => {
      client.on(SOCKET_EVENTS.CALL_ERROR, (err) => {
        expect(['invalid_payload', 'missing_call_code']).toContain(err.error);
        done();
      });

      // Send invalid non-object payload
      client.emit(SOCKET_EVENTS.SIGNAL_OFFER, 'not-an-object');
    });

    it('should reject call:session:state with invalid_payload if payload is not an object', (done) => {
      client.emit('call:session:state', 'invalid_payload_string', (res) => {
        expect(res.error).toBe('invalid_payload');
        done();
      });
    });

    it('should reject call:session:state with sessionId_required if sessionId is missing or invalid', (done) => {
      client.emit('call:session:state', { sessionId: '' }, (res) => {
        expect(res.error).toBe('sessionId_required');
        done();
      });
    });

    it('should reject call:accept with missing_call_code if callCode is missing or invalid', (done) => {
      client.emit(SOCKET_EVENTS.CALL_ACCEPT, { callCode: '' }, (res) => {
        expect(res.error).toBe('missing_call_code');
        done();
      });
    });

    it('should reject call:end with missing_call_code if callCode is missing or invalid', (done) => {
      client.emit(SOCKET_EVENTS.CALL_END, { callCode: '' }, (res) => {
        expect(res.error).toBe('missing_call_code');
        done();
      });
    });
  });
});
