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
import { pushService, sendIncomingCallPush } from '../services/push.service.js';
import {
  startCallBillingTimer,
  stopCallBillingTimer,
  isCallBillingTimerActive,
} from '../services/billing.service.js';

let ioInstance = null;

/**
 * Initialize Socket.io on the provided HTTP server
 */
export function initSocketServer(httpServer) {
  const allowedOrigins = config.cors.getAllowedOrigins();

  const io = new Server(httpServer, {
    path: '/socket.io',
    transports: ['polling', 'websocket'], // Allow both polling and websocket, polling first
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

    // Track user socket in memory map
    userSocketMap.set(userId, socket.id);
    // Join personal room for targeted emits by userId
    socket.join(`user:${userId}`);

    logger.debug(`Socket connected [socketId: ${socket.id}]`);

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

      try {
        const liveSocketUserIds = userSocketMap.getOnlineUserIds();
        logger.debug(`Call find requested [socketId: ${socket.id}]`);
        const matchResult = await matchCaller(userId, liveSocketUserIds);

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
                io.to(callerSockId).emit(SOCKET_EVENTS.CALL_NONE_AVAILABLE, {
                  error: 'no_users_available',
                  message: 'Call timed out with no answer.',
                });
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
          iceServers: config.webrtc.getIceServers(),
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
            iceServers: config.webrtc.getIceServers(),
          });
          logger.debug(`Incoming emitted [callCode: ${session.callCode}]`);
        } else {
          // Callee has no active socket connection -> wake up via push notification
          logger.debug(`Push dispatched for offline callee [sessionId: ${session.id}]`);
          await pushService.sendIncomingCallPush(callee.pushToken, session.id);
        }

        if (ack) {
          ack({
            success: true,
            sessionId: session.id,
            callCode: session.callCode,
            status: session.status,
            iceServers: config.webrtc.getIceServers(),
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
      const callCode = payload?.callCode;

      if (!callCode) {
        if (ack) ack({ success: false, error: 'missing_call_code' });
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
      const callCode = payload?.callCode;
      const reason = payload?.reason || 'declined';

      if (!callCode) {
        if (ack) ack({ success: false, error: 'missing_call_code' });
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

      if (ack) ack({ success: true });
    };

    socket.on(SOCKET_EVENTS.CALL_DECLINE, handleDecline);
    socket.on(SOCKET_EVENTS.CALL_REJECT, handleDecline);

    // -----------------------------------------------------------------------
    // 4. WebRTC Signaling Relays (between matched users ONLY)
    // -----------------------------------------------------------------------
    const handleRelay = (eventName) => (payload) => {
      const callCode = payload?.callCode;
      if (!callCode) {
        socket.emit(SOCKET_EVENTS.CALL_ERROR, {
          error: 'missing_call_code',
          message: 'callCode is required for signaling',
        });
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
      const callCode = payload?.callCode;
      const reason = payload?.reason;

      if (!callCode) {
        if (ack) ack({ success: false, error: 'missing_call_code' });
        return;
      }

      if (!callSessionManager.isParticipant(callCode, userId)) {
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
        const endReason = isCaller ? 'caller_left' : (reason || 'callee_hangup');
        logger.debug(`Ringing call cancelled [callCode: ${callCode}, reason: ${endReason}]`);

        callSessionManager.clearRingingTimer(session);
        callSessionManager.endSession(callCode);

        try {
          await pool.query(
            `UPDATE call_sessions 
             SET status = 'ended', end_reason = $1, duration_seconds = 0, ended_at = CURRENT_TIMESTAMP 
             WHERE call_code = $2;`,
            [endReason, callCode]
          );

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
      const callCode = payload?.callCode;
      const isMuted = Boolean(payload?.isMuted);

      if (!callCode || !callSessionManager.isParticipant(callCode, userId)) {
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

export { userSocketMap, callSessionManager, SOCKET_EVENTS };
