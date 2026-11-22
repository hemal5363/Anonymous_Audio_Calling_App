import { Server } from 'socket.io';
import { pool } from '../db/index.js';
import { socketAuthMiddleware } from './socketAuth.middleware.js';
import { userSocketMap } from './userSocketMap.js';
import { callSessionManager } from './callSessionManager.js';
import { SOCKET_EVENTS } from './events.js';
import { matchCaller } from '../services/matching.service.js';
import {
  acceptCall,
  declineCall,
  handleRingingTimeout,
  endCall,
  blockPeerDuringCall,
  reportPeerDuringCall,
} from '../services/call.service.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { pushService, sendIncomingCallPush } from '../services/push.js';
import {
  startCallBillingTimer,
  stopCallBillingTimer,
  isCallBillingTimerActive,
} from '../services/billing.service.js';
import { socketAbuseGuard } from './socketAbuseGuard.js';

let ioInstance = null;

/**
 * Initialize Socket.io on the provided HTTP server
 */
export function initSocketServer(httpServer) {
  const allowedOrigins = config.cors.getAllowedOrigins();

  const io = new Server(httpServer, {
    path: '/socket.io',
    transports: ['polling', 'websocket'], // Allow both polling and websocket, polling first
    maxHttpBufferSize: config.socketAbuse.maxPayloadBytes,
    allowRequest: (req, callback) => {
      const origin = req.headers.origin;
      // Allow non-browser requests with no origin (curl, React Native, mobile apps)
      if (!origin) return callback(null, true);
      const cleanOrigin = origin.replace(/\/$/, '');
      const allowed = config.cors.getAllowedOrigins();
      if (allowed.includes('*') || allowed.includes(cleanOrigin) || allowed.includes(origin)) {
        return callback(null, true);
      }
      logger.warn(`[Engine.IO allowRequest REJECTED] Origin "${origin}" rejected. Allowed origins: ${allowed.join(', ')}`);
      return callback(403, false);
    },
    cors: {
      origin: (origin, callback) => {
        // Non-browser or mobile clients (curl, React Native, Expo) may send no origin
        if (!origin) return callback(null, true);
        const cleanOrigin = origin.replace(/\/$/, '');
        const allowed = config.cors.getAllowedOrigins();
        if (allowed.includes('*') || allowed.includes(cleanOrigin) || allowed.includes(origin)) {
          return callback(null, true);
        }
        logger.warn(`[Socket CORS] Origin rejected: "${origin}". Allowed origins: ${allowed.join(', ')}`);
        return callback(new Error(`Not allowed by CORS: ${origin}`));
      },
      methods: ['GET', 'POST'],
      credentials: true,
    },
    pingTimeout: 20000,
    pingInterval: 25000,
  });

  // Log every engine-level connection error at debug level
  io.engine.on('connection_error', (err) => {
    logger.debug(`[Engine.IO Connection Error] Code: ${err.code}, Message: "${err.message}"`);
  });

  // Authenticate every socket connection with user's JWT access token
  io.use(socketAuthMiddleware);

  io.on('connection', (socket) => {
    const userId = socket.userId;

    // Single active socket session enforcement: latest connection takes over
    const existingSocketId = userSocketMap.getSocketId(userId);
    if (existingSocketId && existingSocketId !== socket.id) {
      const existingSocket = io.sockets.sockets.get(existingSocketId);
      if (existingSocket) {
        logger.info(`User ${userId} signed in on new socket [${socket.id}]. Superseding existing socket [${existingSocketId}].`);
        existingSocket.emit('auth:superseded', {
          message: 'Signed in from another device. This session has been disconnected.',
        });
        const activeSession = callSessionManager.getSessionByUserId(userId);
        if (activeSession) {
          endCall({ callCode: activeSession.callCode, userId, reason: 'superseded' }).catch(() => {});
          const endPayload = {
            callCode: activeSession.callCode,
            sessionId: activeSession.sessionId,
            reason: 'superseded',
          };
          io.to(`call:${activeSession.callCode}`).emit(SOCKET_EVENTS.CALL_ENDED, endPayload);
          const peerUserId = activeSession.callerId === userId ? activeSession.calleeId : activeSession.callerId;
          const peerSocketId = userSocketMap.getSocketId(peerUserId);
          if (peerSocketId) {
            io.to(peerSocketId).emit(SOCKET_EVENTS.CALL_ENDED, endPayload);
          }
        }
        existingSocket.disconnect(true);
      }
    }

    // Track user socket in memory map
    userSocketMap.set(userId, socket.id);
    // Join personal room for targeted emits by userId
    socket.join(`user:${userId}`);

    logger.debug(`Socket connected [socketId: ${socket.id}]`);

    // Helper to check for a ringing call where this user is the callee
    const checkAndEmitPendingCall = (ack = null) => {
      const pendingSession = callSessionManager.getSessionByUserId(userId);
      if (
        pendingSession &&
        pendingSession.calleeId === userId &&
        pendingSession.status === 'ringing'
      ) {
        socket.join(`call:${pendingSession.callCode}`);
        const elapsedSeconds = Math.floor((Date.now() - pendingSession.requestedAt) / 1000);
        const remainingSeconds = Math.max(1, 30 - elapsedSeconds);

        const incomingPayload = {
          sessionId: pendingSession.sessionId,
          callCode: pendingSession.callCode,
          ringSeconds: remainingSeconds,
          role: 'callee',
        };

        socket.emit(SOCKET_EVENTS.CALL_INCOMING, incomingPayload);
        logger.debug(`Pending incoming call emitted to callee [callCode: ${pendingSession.callCode}]`);

        if (ack) {
          ack({
            success: true,
            hasPendingCall: true,
            session: incomingPayload,
          });
        }
        return true;
      }

      if (ack) {
        ack({
          success: true,
          hasPendingCall: false,
        });
      }
      return false;
    };

    // Auto-check pending calls on socket connection
    checkAndEmitPendingCall();

    // Explicit request for pending call: socket.emit('call:pending')
    socket.on('call:pending', (payload, callback) => {
      const ack = typeof payload === 'function' ? payload : typeof callback === 'function' ? callback : null;
      checkAndEmitPendingCall(ack);
    });

    // Socket event to fetch session state by id: socket.emit('call:session:state', { sessionId })
    socket.on('call:session:state', async (payload, callback) => {
      const ack = typeof payload === 'function' ? payload : typeof callback === 'function' ? callback : null;
      if (!ack) return;

      if (!payload || typeof payload !== 'object') {
        return ack({ error: 'invalid_payload' });
      }

      const sessionId = payload.sessionId;
      if (!sessionId || typeof sessionId !== 'string' || sessionId.length > 100) {
        return ack({ error: 'sessionId_required' });
      }

      // Check in-memory session first
      const memSession = callSessionManager.getSessionById(sessionId);
      if (memSession) {
        if (memSession.callerId !== userId && memSession.calleeId !== userId) {
          return ack({ error: 'Forbidden' });
        }
        const elapsed = (Date.now() - memSession.requestedAt) / 1000;
        const status = memSession.status === 'ringing' && elapsed > 30 ? 'missed' : memSession.status;
        return ack({ status });
      }

      // Fallback to database
      try {
        const { rows } = await pool.query(
          `SELECT id, caller_id, callee_id, status, end_reason, requested_at
           FROM call_sessions
           WHERE id = $1`,
          [sessionId]
        );

        if (rows.length === 0) {
          return ack({ error: 'Session not found' });
        }

        const dbSession = rows[0];
        if (dbSession.caller_id !== userId && dbSession.callee_id !== userId) {
          return ack({ error: 'Forbidden' });
        }

        let status = dbSession.status;
        if (status === 'ringing') {
          const elapsed = (Date.now() - new Date(dbSession.requested_at).getTime()) / 1000;
          status = elapsed > 30 ? 'missed' : 'ringing';
        } else if (status === 'missed' || dbSession.end_reason === 'ring_timeout') {
          status = 'missed';
        } else {
          status = 'ended';
        }

        return ack({ status });
      } catch (err) {
        logger.error('Error fetching session state via socket:', err.message);
        return ack({ error: 'server_error' });
      }
    });

    // -----------------------------------------------------------------------
    // 1. Presence & Setup
    // -----------------------------------------------------------------------
    socket.on(SOCKET_EVENTS.PRESENCE_HELLO, () => {
      logger.debug(`Presence confirmed [socketId: ${socket.id}]`);
      socket.emit('presence:ack', {
        userId,
        socketId: socket.id,
        connectedAt: new Date().toISOString(),
      });
    });

    // -----------------------------------------------------------------------
    // 2. Call Matching Logic (event "call:find" & alias "call:request")
    // -----------------------------------------------------------------------
    const handleCallFind = async (payload, callback) => {
      const ack = typeof payload === 'function' ? payload : typeof callback === 'function' ? callback : null;

      // 0. Check if user already has an active session in-memory
      const existingSession = callSessionManager.getSessionByUserId(userId);
      if (existingSession) {
        socket.emit(SOCKET_EVENTS.CALL_ERROR, {
          error: 'already_in_call',
          message: 'You are already in an active call.',
        });
        if (ack) {
          return ack({
            success: false,
            error: 'already_in_call',
            message: 'You are already in an active call.',
          });
        }
        return;
      }

      // 1. Check skip/cancel cooldown
      const cooldownCheck = socketAbuseGuard.checkCooldown(userId);
      if (cooldownCheck.inCooldown) {
        socket.emit(SOCKET_EVENTS.CALL_ERROR, {
          error: 'cooldown_active',
          message: `Too many skips or cancels in a short period. Please wait ${cooldownCheck.retryAfterSeconds} second(s) before searching again.`,
          retryAfterSeconds: cooldownCheck.retryAfterSeconds,
        });
        if (ack) {
          return ack({
            success: false,
            error: 'cooldown_active',
            message: `Too many skips or cancels. Please wait ${cooldownCheck.retryAfterSeconds}s.`,
            retryAfterSeconds: cooldownCheck.retryAfterSeconds,
          });
        }
        return;
      }

      // 2. Check per-user call:find rate limit
      const rateLimitCheck = socketAbuseGuard.checkRateLimit(userId, 'callFind');
      if (!rateLimitCheck.allowed) {
        socket.emit(SOCKET_EVENTS.CALL_ERROR, {
          error: 'rate_limit_exceeded',
          message: 'Too many call search requests. Please wait a moment before searching again.',
        });
        if (ack) {
          return ack({
            success: false,
            error: 'rate_limit_exceeded',
            message: 'Too many call search requests. Please slow down.',
          });
        }
        return;
      }

      try {
        const liveSocketUserIds = userSocketMap.getOnlineUserIds();
        const busyUserIds = Array.from(callSessionManager.sessionsByUser.keys());
        logger.debug(`Call find requested [socketId: ${socket.id}]`);
        const matchResult = await matchCaller(userId, liveSocketUserIds, busyUserIds);

        if (!matchResult.success) {
          if (matchResult.error === 'no_users_available') {
            logger.debug('No available match for caller');
            socket.emit('no_users_available', {
              error: 'no_users_available',
              message: 'No available users at this moment.',
            });
            socket.emit(SOCKET_EVENTS.CALL_NONE_AVAILABLE, {
              error: 'no_users_available',
              message: 'No available users at this moment. Please try again shortly.',
            });

            if (ack) {
              return ack({
                success: false,
                error: 'no_users_available',
                message: 'No available users at this moment.',
              });
            }
            return;
          }

          logger.debug(`Call match error: ${matchResult.error}`);
          socket.emit(SOCKET_EVENTS.CALL_ERROR, {
            error: matchResult.error,
            message: matchResult.message,
          });

          if (ack) {
            return ack({
              success: false,
              error: matchResult.error,
              message: matchResult.message,
            });
          }
          return;
        }

        const { session, callee } = matchResult;
        logger.debug(`Call matched [callCode: ${session.callCode}]`);

        // Register session in in-memory CallSessionManager with a 30s ringing timeout
        callSessionManager.createSession({
          sessionId: session.id,
          callCode: session.callCode,
          callerId: userId,
          calleeId: callee.id,
          billingMode: session.billingMode,
          ringTimeoutMs: 30000,
          onRingTimeout: async (s) => {
            try {
              logger.debug(`Ring timeout reached [callCode: ${s.callCode}]`);
              await handleRingingTimeout({ callCode: s.callCode });
              const endPayload = {
                callCode: s.callCode,
                durationSeconds: 0,
                reason: 'ring_timeout',
              };

              io.to(`call:${s.callCode}`).emit(SOCKET_EVENTS.CALL_ENDED, endPayload);

              const callerSockId = userSocketMap.getSocketId(s.callerId);
              if (callerSockId) {
                io.to(callerSockId).emit(SOCKET_EVENTS.CALL_ENDED, endPayload);
                io.to(callerSockId).emit(SOCKET_EVENTS.CALL_NONE_AVAILABLE, {
                  error: 'no_users_available',
                  message: 'Call timed out with no answer.',
                });
              }

              const calleeSockId = userSocketMap.getSocketId(s.calleeId);
              if (calleeSockId) {
                io.to(calleeSockId).emit(SOCKET_EVENTS.CALL_ENDED, endPayload);
              }
            } catch (err) {
              logger.error('Error handling ringing timeout:', err.message);
            }
          },
        });

        // Join caller to isolated session room
        socket.join(`call:${session.callCode}`);

        // Notify caller (strictly anonymous - anonymous session id & call_code only)
        const callerPayload = {
          sessionId: session.id,
          callCode: session.callCode,
          status: session.status,
          role: 'caller',
        };

        socket.emit(SOCKET_EVENTS.CALL_RINGING, callerPayload);
        logger.debug(`Ringing emitted [callCode: ${session.callCode}]`);

        // Notify callee if online via live socket
        const calleeSocketId = userSocketMap.getSocketId(callee.id);
        if (calleeSocketId) {
          const calleeSocket = io.sockets.sockets.get(calleeSocketId);
          if (calleeSocket) {
            calleeSocket.join(`call:${session.callCode}`);
          }

          io.to(calleeSocketId).emit(SOCKET_EVENTS.CALL_INCOMING, {
            sessionId: session.id,
            callCode: session.callCode,
            ringSeconds: 30,
            role: 'callee',
          });
          logger.debug(`Incoming emitted [callCode: ${session.callCode}]`);
        } else {
          // Callee has no active socket connection -> wake up via push notification
          logger.debug(`Push dispatched for offline callee [sessionId: ${session.id}]`);
          try {
            await pushService.sendIncomingCallPush(callee.pushToken, session.id);
          } catch (pushErr) {
            logger.error(`[Push Service] Error dispatching push for session ${session.id}:`, pushErr.message);
          }
        }

        if (ack) {
          ack({
            success: true,
            sessionId: session.id,
            callCode: session.callCode,
            status: session.status,
          });
        }
      } catch (err) {
        logger.error('Error handling call:find matching:', err.message);
        socket.emit(SOCKET_EVENTS.CALL_ERROR, {
          error: 'server_error',
          message: 'An internal error occurred during matching.',
        });

        if (ack) {
          ack({
            success: false,
            error: 'server_error',
            message: 'An internal error occurred during matching.',
          });
        }
      }
    };

    socket.on('call:find', handleCallFind);
    socket.on(SOCKET_EVENTS.CALL_REQUEST, handleCallFind);

    // -----------------------------------------------------------------------
    // 3. Callee Accept & Reject (Decline)
    // -----------------------------------------------------------------------
    socket.on(SOCKET_EVENTS.CALL_ACCEPT, async (payload, callback) => {
      const ack = typeof callback === 'function' ? callback : null;

      const rateCheck = socketAbuseGuard.checkRateLimit(userId, 'accept');
      if (!rateCheck.allowed) {
        socket.emit(SOCKET_EVENTS.CALL_ERROR, {
          error: 'rate_limit_exceeded',
          message: 'Too many call response actions. Please slow down.',
        });
        if (ack) ack({ success: false, error: 'rate_limit_exceeded' });
        return;
      }

      if (!payload || typeof payload !== 'object') {
        const malformed = socketAbuseGuard.recordMalformedEvent(socket.id);
        if (ack) ack({ success: false, error: 'invalid_payload' });
        if (malformed.shouldDisconnect) socket.disconnect(true);
        return;
      }

      const callCode = payload.callCode;

      if (!callCode || typeof callCode !== 'string' || callCode.length > 100) {
        const malformed = socketAbuseGuard.recordMalformedEvent(socket.id);
        if (ack) ack({ success: false, error: 'missing_call_code' });
        if (malformed.shouldDisconnect) socket.disconnect(true);
        return;
      }

      logger.debug(`Call accept received [callCode: ${callCode}]`);
      const res = await acceptCall({ callCode, calleeId: userId });
      if (!res.success) {
        socket.emit(SOCKET_EVENTS.CALL_ERROR, res);
        if (ack) ack(res);
        return;
      }

      // Both clients receive call:matched with ephemeral STUN/TURN ICE config
      const callerPayload = {
        callCode,
        sessionId: res.sessionId,
        role: 'caller',
        iceServers: res.iceServers,
      };

      const calleePayload = {
        callCode,
        sessionId: res.sessionId,
        role: 'callee',
        iceServers: res.iceServers,
      };

      const callerSocketId = userSocketMap.getSocketId(res.callerId);
      if (callerSocketId) {
        io.to(callerSocketId).emit(SOCKET_EVENTS.CALL_MATCHED, callerPayload);
      }
      socket.emit(SOCKET_EVENTS.CALL_MATCHED, calleePayload);
      logger.debug(`Call matched emitted [callCode: ${callCode}]`);

      if (ack) ack({ success: true, callCode, sessionId: res.sessionId });
    });

    const handleDecline = async (payload, callback) => {
      const ack = typeof callback === 'function' ? callback : null;

      const rateCheck = socketAbuseGuard.checkRateLimit(userId, 'accept');
      if (!rateCheck.allowed) {
        socket.emit(SOCKET_EVENTS.CALL_ERROR, {
          error: 'rate_limit_exceeded',
          message: 'Too many call response actions. Please slow down.',
        });
        if (ack) ack({ success: false, error: 'rate_limit_exceeded' });
        return;
      }

      if (!payload || typeof payload !== 'object') {
        const malformed = socketAbuseGuard.recordMalformedEvent(socket.id);
        if (ack) ack({ success: false, error: 'invalid_payload' });
        if (malformed.shouldDisconnect) socket.disconnect(true);
        return;
      }

      const callCode = payload.callCode;
      const reason = payload?.reason || 'declined';

      if (!callCode || typeof callCode !== 'string' || callCode.length > 100) {
        const malformed = socketAbuseGuard.recordMalformedEvent(socket.id);
        if (ack) ack({ success: false, error: 'missing_call_code' });
        if (malformed.shouldDisconnect) socket.disconnect(true);
        return;
      }

      logger.debug(`Call decline received [callCode: ${callCode}, reason: ${reason}]`);
      const res = await declineCall({ callCode, calleeId: userId, reason });
      if (!res.success) {
        if (ack) ack(res);
        return;
      }

      io.to(`call:${callCode}`).emit(SOCKET_EVENTS.CALL_ENDED, {
        callCode,
        durationSeconds: 0,
        reason: 'declined',
      });

      const callerSocketId = userSocketMap.getSocketId(res.callerId);
      if (callerSocketId) {
        io.to(callerSocketId).emit(SOCKET_EVENTS.CALL_ENDED, {
          callCode,
          durationSeconds: 0,
          reason: 'declined',
        });
      }
      socket.emit(SOCKET_EVENTS.CALL_ENDED, {
        callCode,
        durationSeconds: 0,
        reason: 'declined',
      });

      if (ack) ack({ success: true });
    };

    socket.on(SOCKET_EVENTS.CALL_DECLINE, handleDecline);
    socket.on(SOCKET_EVENTS.CALL_REJECT, handleDecline);

    // -----------------------------------------------------------------------
    // 4. WebRTC Signaling Relays (between matched users ONLY)
    // -----------------------------------------------------------------------
    const handleRelay = (eventName) => (payload) => {
      if (!payload || typeof payload !== 'object') {
        const malformed = socketAbuseGuard.recordMalformedEvent(socket.id);
        socket.emit(SOCKET_EVENTS.CALL_ERROR, {
          error: 'invalid_payload',
          message: 'Signaling payload must be an object',
        });
        if (malformed.shouldDisconnect) socket.disconnect(true);
        return;
      }

      if (!socketAbuseGuard.isPayloadSizeValid(payload)) {
        const malformed = socketAbuseGuard.recordMalformedEvent(socket.id);
        socket.emit(SOCKET_EVENTS.CALL_ERROR, {
          error: 'payload_too_large',
          message: 'Signaling payload exceeds maximum allowed size.',
        });
        if (malformed.shouldDisconnect) socket.disconnect(true);
        return;
      }

      const rateCheck = socketAbuseGuard.checkRateLimit(userId, 'signal');
      if (!rateCheck.allowed) {
        socket.emit(SOCKET_EVENTS.CALL_ERROR, {
          error: 'rate_limit_exceeded',
          message: 'Signaling rate limit exceeded. Please slow down.',
        });
        return;
      }

      const callCode = payload.callCode;
      if (!callCode || typeof callCode !== 'string' || callCode.length > 100) {
        const malformed = socketAbuseGuard.recordMalformedEvent(socket.id);
        socket.emit(SOCKET_EVENTS.CALL_ERROR, {
          error: 'missing_call_code',
          message: 'callCode is required and must be a valid string',
        });
        if (malformed.shouldDisconnect) socket.disconnect(true);
        return;
      }

      // Enforce strict security: reject relays from anyone not part of that session
      if (!callSessionManager.isParticipant(callCode, userId)) {
        logger.debug(`Unauthorized relay attempt rejected [callCode: ${callCode}, event: ${eventName}]`);
        socket.emit(SOCKET_EVENTS.CALL_ERROR, {
          error: 'unauthorized_relay',
          message: 'You are not an authorized participant of this call session.',
        });
        return;
      }

      const peerUserId = callSessionManager.getPeerUserId(callCode, userId);
      if (!peerUserId) return;

      const peerSocketId = userSocketMap.getSocketId(peerUserId);
      if (peerSocketId) {
        io.to(peerSocketId).emit(eventName, payload);
      }
    };

    socket.on(SOCKET_EVENTS.SIGNAL_OFFER, handleRelay(SOCKET_EVENTS.SIGNAL_OFFER));
    socket.on(SOCKET_EVENTS.SIGNAL_ANSWER, handleRelay(SOCKET_EVENTS.SIGNAL_ANSWER));
    socket.on(SOCKET_EVENTS.SIGNAL_ICE, handleRelay(SOCKET_EVENTS.SIGNAL_ICE));

    // -----------------------------------------------------------------------
    // 5. In-Call Lifecycle, Skip, Mute, Report, Block, & End / Cancel
    // -----------------------------------------------------------------------
    socket.on(SOCKET_EVENTS.CALL_CONNECTED, async (payload) => {
      const callCode = payload?.callCode;
      if (callCode && callSessionManager.isParticipant(callCode, userId)) {
        callSessionManager.markConnected(callCode);
        logger.debug(`WebRTC connected event received [callCode: ${callCode}]`);

        const session = callSessionManager.getSession(callCode);
        if (session && !isCallBillingTimerActive(callCode)) {
          startCallBillingTimer({
            io,
            callCode,
            callerId: session.callerId,
            sessionId: session.sessionId,
          });
        }
      }
    });

    // Call End or Cancel (including ringing cancellations)
    const handleCallEndOrCancel = async (payload, callback) => {
      const ack = typeof callback === 'function' ? callback : null;
      if (!payload || typeof payload !== 'object') {
        if (ack) ack({ success: false, error: 'invalid_payload' });
        return;
      }

      const callCode = payload.callCode;
      const reason = typeof payload.reason === 'string' && payload.reason.length <= 50 ? payload.reason : null;

      if (!callCode || typeof callCode !== 'string' || callCode.length > 100) {
        if (ack) ack({ success: false, error: 'missing_call_code' });
        return;
      }

      if (!callSessionManager.isParticipant(callCode, userId)) {
        try {
          const { rows } = await pool.query(
            `SELECT caller_id, callee_id, status FROM call_sessions WHERE call_code = $1;`,
            [callCode]
          );
          if (rows.length > 0 && (rows[0].caller_id === userId || rows[0].callee_id === userId)) {
            if (['ended', 'declined', 'missed', 'failed'].includes(rows[0].status)) {
              // Authorized participant of a call that has already concluded
              if (ack) ack({ success: true, alreadyEnded: true });
              return;
            }
            // Active session still in DB: end it properly
            const res = await endCall({ callCode, userId, reason });
            if (res.success) {
              io.to(`call:${callCode}`).emit(SOCKET_EVENTS.CALL_ENDED, {
                callCode,
                durationSeconds: res.durationSeconds,
                reason: res.reason,
              });
              const peerUserId = userId === res.callerId ? res.calleeId : res.callerId;
              const peerSocketId = userSocketMap.getSocketId(peerUserId);
              if (peerSocketId) {
                io.to(peerSocketId).emit(SOCKET_EVENTS.CALL_ENDED, {
                  callCode,
                  durationSeconds: res.durationSeconds,
                  reason: res.reason,
                });
              }
              if (ack) ack({ success: true, durationSeconds: res.durationSeconds, reason: res.reason });
            }
            return;
          }
        } catch (dbErr) {
          logger.warn('Error verifying past participant in DB:', dbErr.message);
        }

        socket.emit(SOCKET_EVENTS.CALL_ERROR, {
          error: 'unauthorized',
          message: 'You are not an authorized participant in this call session.',
        });
        if (ack) ack({ success: false, error: 'unauthorized' });
        return;
      }

      const session = callSessionManager.getSession(callCode);

      // Handle cancel while call is ringing: end session immediately with caller_left, clear ring timeout, release both users
      if (session && session.status === 'ringing' && !session.connectedAt) {
        const isCaller = session.callerId === userId;
        let endReason = isCaller ? 'caller_left' : (reason || 'callee_hangup');
        const allowedReasons = ['caller_hangup', 'callee_hangup', 'declined', 'ring_timeout', 'skipped', 'balance_exhausted', 'network_error', 'system_shutdown', 'caller_left', 'cancelled'];
        if (!allowedReasons.includes(endReason)) {
          endReason = isCaller ? 'caller_left' : 'callee_hangup';
        }
        logger.debug(`Ringing call cancelled [callCode: ${callCode}, reason: ${endReason}]`);

        // Record cancel for abuse tracking / cooldown
        socketAbuseGuard.recordSkipOrCancel(userId);

        callSessionManager.clearRingingTimer(session);
        callSessionManager.endSession(callCode);

        try {
          await pool.query(
            `UPDATE call_sessions 
             SET status = 'ended', end_reason = $1, duration_seconds = 0, ended_at = CURRENT_TIMESTAMP 
             WHERE call_code = $2;`,
            [endReason, callCode]
          );
          await pool.query(`UPDATE users SET active_call_code = NULL WHERE active_call_code = $1;`, [callCode]);

          io.to(`call:${callCode}`).emit(SOCKET_EVENTS.CALL_ENDED, {
            callCode,
            durationSeconds: 0,
            reason: endReason,
          });

          const peerUserId = isCaller ? session.calleeId : session.callerId;
          const peerSocketId = userSocketMap.getSocketId(peerUserId);
          if (peerSocketId) {
            io.to(peerSocketId).emit(SOCKET_EVENTS.CALL_ENDED, {
              callCode,
              durationSeconds: 0,
              reason: endReason,
            });
          }
        } catch (err) {
          logger.error('Error ending ringing session upon cancel:', err.message);
        }

        if (ack) ack({ success: true, durationSeconds: 0, reason: endReason });
        return;
      }

      logger.debug(`Call end requested [callCode: ${callCode}, reason: ${reason}]`);
      const res = await endCall({ callCode, userId, reason });
      if (res.success) {
        io.to(`call:${callCode}`).emit(SOCKET_EVENTS.CALL_ENDED, {
          callCode,
          durationSeconds: res.durationSeconds,
          reason: res.reason,
        });

        const peerUserId = userId === res.callerId ? res.calleeId : res.callerId;
        const peerSocketId = userSocketMap.getSocketId(peerUserId);
        if (peerSocketId) {
          io.to(peerSocketId).emit(SOCKET_EVENTS.CALL_ENDED, {
            callCode,
            durationSeconds: res.durationSeconds,
            reason: res.reason,
          });
        }

        if (ack) ack({ success: true, durationSeconds: res.durationSeconds, reason: res.reason });
      }
    };

    socket.on(SOCKET_EVENTS.CALL_END, handleCallEndOrCancel);
    socket.on('call:cancel', handleCallEndOrCancel);

    // Skip Action: end call and immediately search for a new match
    const handleSkip = async (payload, callback) => {
      const ack = typeof callback === 'function' ? callback : null;
      const callCode = payload?.callCode;

      if (!callCode) {
        if (ack) ack({ success: false, error: 'missing_call_code' });
        return;
      }

      const session = callSessionManager.getSession(callCode);
      if (!session || session.callerId !== userId) {
        socket.emit(SOCKET_EVENTS.CALL_ERROR, {
          error: 'unauthorized',
          message: 'Only the caller can skip the call.',
        });
        if (ack) ack({ success: false, error: 'unauthorized' });
        return;
      }

      // End current call with reason 'skipped'
      socketAbuseGuard.recordSkipOrCancel(userId);
      const res = await endCall({ callCode, userId, reason: 'skipped' });

      // Notify callee
      const calleeSocketId = userSocketMap.getSocketId(session.calleeId);
      if (calleeSocketId) {
        io.to(calleeSocketId).emit(SOCKET_EVENTS.CALL_ENDED, {
          callCode,
          durationSeconds: res.durationSeconds,
          reason: 'skipped',
        });
      }

      if (ack) ack({ success: true, skipped: true });

      // Immediately search for next candidate
      logger.debug(`Call skipped [callCode: ${callCode}]. Searching next candidate...`);
      await handleCallFind({}, null);
    };

    socket.on(SOCKET_EVENTS.CALL_SKIP, handleSkip);

    // Mute State Relay
    socket.on(SOCKET_EVENTS.CALL_MUTE, (payload) => {
      if (!payload || typeof payload !== 'object') return;
      const callCode = payload.callCode;
      const isMuted = Boolean(payload.isMuted);

      if (!callCode || typeof callCode !== 'string' || callCode.length > 100 || !callSessionManager.isParticipant(callCode, userId)) {
        return;
      }

      callSessionManager.setMuteState(callCode, userId, isMuted);
      const peerUserId = callSessionManager.getPeerUserId(callCode, userId);
      const peerSocketId = userSocketMap.getSocketId(peerUserId);

      if (peerSocketId) {
        io.to(peerSocketId).emit(SOCKET_EVENTS.PEER_MUTE, { callCode, isMuted });
        io.to(peerSocketId).emit(SOCKET_EVENTS.CALL_MUTE, { callCode, isMuted });
      }
    });

    // In-Call Block
    socket.on(SOCKET_EVENTS.CALL_BLOCK, async (payload, callback) => {
      const ack = typeof callback === 'function' ? callback : null;
      const callCode = payload?.callCode;

      if (!callCode) {
        if (ack) ack({ success: false, error: 'missing_call_code' });
        return;
      }

      try {
        const res = await blockPeerDuringCall({ callCode, blockerId: userId });
        if (ack) ack(res);
      } catch (err) {
        if (ack) ack({ success: false, error: 'server_error', message: err.message });
      }
    });

    // In-Call Report
    socket.on(SOCKET_EVENTS.CALL_REPORT, async (payload, callback) => {
      const ack = typeof callback === 'function' ? callback : null;
      const callCode = payload?.callCode;
      const reason = payload?.reason || 'other';
      const note = payload?.note;

      if (!callCode) {
        if (ack) ack({ success: false, error: 'missing_call_code' });
        return;
      }

      try {
        const res = await reportPeerDuringCall({ callCode, reporterId: userId, reason, note });
        if (ack) ack(res);
      } catch (err) {
        if (ack) ack({ success: false, error: 'server_error', message: err.message });
      }
    });

    // -----------------------------------------------------------------------
    // 6. Clean Disconnect Handling (release users & record network_error mid-call)
    // -----------------------------------------------------------------------
    socket.on('disconnect', async (reason) => {
      userSocketMap.removeBySocketId(socket.id);
      socketAbuseGuard.cleanSocket(socket.id);
      logger.debug(`Socket disconnected [socketId: ${socket.id}, reason: ${reason}]`);

      // Check if user is in an active session
      const activeSession = callSessionManager.getSessionByUserId(userId);
      if (activeSession) {
        if (activeSession.status === 'ringing' && !activeSession.connectedAt) {
          // If caller disconnected while call is ringing:
          if (activeSession.callerId === userId) {
            logger.debug(`Caller disconnected during ringing [callCode: ${activeSession.callCode}]`);
            callSessionManager.clearRingingTimer(activeSession);
            callSessionManager.endSession(activeSession.callCode);

            try {
              await pool.query(
                `UPDATE call_sessions 
                 SET status = 'ended', end_reason = 'caller_left', duration_seconds = 0, ended_at = CURRENT_TIMESTAMP 
                 WHERE call_code = $1;`,
                [activeSession.callCode]
              );
              await pool.query(`UPDATE users SET active_call_code = NULL WHERE active_call_code = $1;`, [activeSession.callCode]);

              const calleeSocketId = userSocketMap.getSocketId(activeSession.calleeId);
              if (calleeSocketId) {
                io.to(calleeSocketId).emit(SOCKET_EVENTS.CALL_ENDED, {
                  callCode: activeSession.callCode,
                  durationSeconds: 0,
                  reason: 'caller_left',
                });
              }
            } catch (err) {
              logger.error('Error handling caller disconnect during ringing:', err.message);
            }
          } else {
            // Callee disconnected while call is ringing:
            logger.debug(`Callee disconnected during ringing [callCode: ${activeSession.callCode}]`);
            callSessionManager.clearRingingTimer(activeSession);
            callSessionManager.endSession(activeSession.callCode);

            try {
              await pool.query(
                `UPDATE call_sessions 
                 SET status = 'missed', end_reason = 'network_error', duration_seconds = 0, ended_at = CURRENT_TIMESTAMP 
                 WHERE call_code = $1;`,
                [activeSession.callCode]
              );
              await pool.query(`UPDATE users SET active_call_code = NULL WHERE active_call_code = $1;`, [activeSession.callCode]);

              const callerSocketId = userSocketMap.getSocketId(activeSession.callerId);
              if (callerSocketId) {
                io.to(callerSocketId).emit(SOCKET_EVENTS.CALL_ENDED, {
                  callCode: activeSession.callCode,
                  durationSeconds: 0,
                  reason: 'network_error',
                });
                io.to(callerSocketId).emit(SOCKET_EVENTS.CALL_NONE_AVAILABLE, {
                  error: 'no_users_available',
                  message: 'Partner disconnected before answering.',
                });
              }
            } catch (err) {
              logger.error('Error handling callee disconnect during ringing:', err.message);
            }
          }
        } else {
          // Connected session:
          logger.debug(`User disconnected during connected call [callCode: ${activeSession.callCode}]`);

          try {
            const res = await endCall({
              callCode: activeSession.callCode,
              userId,
              reason: 'network_error',
            });

            const peerUserId = activeSession.callerId === userId ? activeSession.calleeId : activeSession.callerId;
            const peerSocketId = userSocketMap.getSocketId(peerUserId);

            if (peerSocketId) {
              io.to(peerSocketId).emit(SOCKET_EVENTS.CALL_ENDED, {
                callCode: activeSession.callCode,
                durationSeconds: res.durationSeconds,
                reason: 'network_error',
              });
            }
          } catch (err) {
            logger.error('Error handling disconnect mid-call:', err.message);
          }
        }
      }
    });
  });

  ioInstance = io;
  return io;
}

/**
 * Access the active Socket.IO server instance
 */
export function getIO() {
  if (!ioInstance) {
    throw new Error('Socket.io has not been initialized yet');
  }
  return ioInstance;
}

export { userSocketMap, callSessionManager, socketAbuseGuard, SOCKET_EVENTS };
