import { Server } from 'socket.io';
import { socketAuthMiddleware } from './socketAuth.middleware.js';
import { userSocketMap } from './userSocketMap.js';
import { SOCKET_EVENTS } from './events.js';
import { matchCaller } from '../services/matching.service.js';
import { logger } from '../utils/logger.js';

let ioInstance = null;

/**
 * Initialize Socket.io on the provided HTTP server
 */
export function initSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
    pingTimeout: 20000,
    pingInterval: 25000,
  });

  // Authenticate every socket connection with user's JWT access token
  io.use(socketAuthMiddleware);

  io.on('connection', (socket) => {
    const userId = socket.userId;

    // Track user socket in memory map
    userSocketMap.set(userId, socket.id);
    // Join personal room for targeted emits by userId
    socket.join(`user:${userId}`);

    logger.info(`Socket connected: [socketId: ${socket.id}, userId: ${userId}, totalOnline: ${userSocketMap.getOnlineCount()}]`);

    // 7.1 Presence & Setup
    socket.on(SOCKET_EVENTS.PRESENCE_HELLO, () => {
      logger.info(`Presence confirmed: [userId: ${userId}, socketId: ${socket.id}]`);
    });

    // 7.2 Call Matching Logic (event "call:find" and alias "call:request")
    const handleCallFind = async (payload, callback) => {
      // Support invocation with just a callback: socket.emit('call:find', callback)
      const ack = typeof payload === 'function' ? payload : typeof callback === 'function' ? callback : null;

      try {
        const liveSocketUserIds = userSocketMap.getOnlineUserIds();
        const matchResult = await matchCaller(userId, liveSocketUserIds);

        if (!matchResult.success) {
          if (matchResult.error === 'no_users_available') {
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

          // Billing check failure or already in call
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
        socket.emit(SOCKET_EVENTS.CALL_MATCHED, callerPayload);

        // Notify callee if online via live socket
        const calleeSocketId = userSocketMap.getSocketId(callee.id);
        if (calleeSocketId) {
          const calleeSocket = io.sockets.sockets.get(calleeSocketId);
          if (calleeSocket) {
            calleeSocket.join(`call:${session.callCode}`);
          }

          // Callee receives anonymous incoming alert (strictly no caller personal details)
          io.to(calleeSocketId).emit(SOCKET_EVENTS.CALL_INCOMING, {
            sessionId: session.id,
            callCode: session.callCode,
            ringSeconds: 30,
            role: 'callee',
          });
        } else if (callee.pushToken) {
          logger.info(`[FCM Push Wake-up] Dispatched wake-up notification for callee in session: ${session.callCode}`);
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

    socket.on(SOCKET_EVENTS.CALL_ACCEPT, (payload) => {
      logger.info(`[Socket] Event ${SOCKET_EVENTS.CALL_ACCEPT} from user ${userId}`);
    });

    socket.on(SOCKET_EVENTS.CALL_DECLINE, (payload) => {
      logger.info(`[Socket] Event ${SOCKET_EVENTS.CALL_DECLINE} from user ${userId}`);
    });

    // WebRTC Signaling Relays
    socket.on(SOCKET_EVENTS.SIGNAL_OFFER, (payload) => {
      logger.info(`[Socket] Event ${SOCKET_EVENTS.SIGNAL_OFFER} from user ${userId}`);
    });

    socket.on(SOCKET_EVENTS.SIGNAL_ANSWER, (payload) => {
      logger.info(`[Socket] Event ${SOCKET_EVENTS.SIGNAL_ANSWER} from user ${userId}`);
    });

    socket.on(SOCKET_EVENTS.SIGNAL_ICE, (payload) => {
      logger.info(`[Socket] Event ${SOCKET_EVENTS.SIGNAL_ICE} from user ${userId}`);
    });

    // In-Call Lifecycle & Billing
    socket.on(SOCKET_EVENTS.CALL_CONNECTED, (payload) => {
      logger.info(`[Socket] Event ${SOCKET_EVENTS.CALL_CONNECTED} from user ${userId}`);
    });

    socket.on(SOCKET_EVENTS.CALL_END, (payload) => {
      logger.info(`[Socket] Event ${SOCKET_EVENTS.CALL_END} from user ${userId}`);
    });

    // Clean disconnect handling
    socket.on('disconnect', (reason) => {
      userSocketMap.removeBySocketId(socket.id);
      logger.info(`Socket disconnected: [socketId: ${socket.id}, userId: ${userId}, reason: ${reason}, remainingOnline: ${userSocketMap.getOnlineCount()}]`);
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

export { userSocketMap, SOCKET_EVENTS };
