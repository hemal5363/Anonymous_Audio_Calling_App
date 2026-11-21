import { Server } from 'socket.io';
import { socketAuthMiddleware } from './socketAuth.middleware.js';
import { userSocketMap } from './userSocketMap.js';
import { SOCKET_EVENTS } from './events.js';
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

    // 7.2 Call Negotiation & Signaling Stubs (matching not implemented yet)
    socket.on(SOCKET_EVENTS.CALL_REQUEST, (payload) => {
      logger.info(`[Socket] Event ${SOCKET_EVENTS.CALL_REQUEST} from user ${userId}`);
    });

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
