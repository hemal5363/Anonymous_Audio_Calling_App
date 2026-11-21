import { verifyAccessToken } from '../utils/token.js';
import { pool } from '../db/index.js';
import { logger } from '../utils/logger.js';

/**
 * Socket.IO authentication middleware:
 * - Authenticates every socket connection with the user's JWT access token.
 * - Extracts token from handshake.auth, handshake.query, or handshake.headers.authorization.
 * - Rejects unauthenticated, nonexistent, suspended, or banned users.
 */
export async function socketAuthMiddleware(socket, next) {
  try {
    const handshake = socket.handshake;

    // Check auth object, query param (?token=...), or Authorization header
    const rawToken =
      handshake.auth?.token ||
      handshake.query?.token ||
      handshake.headers?.authorization;

    if (!rawToken || typeof rawToken !== 'string' || !rawToken.trim()) {
      logger.warn(`Socket connection rejected: Token is required [socketId: ${socket.id}]`);
      return next(new Error('Authentication error: Token is required'));
    }

    const token = rawToken.startsWith('Bearer ') ? rawToken.slice(7).trim() : rawToken.trim();

    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch (err) {
      logger.warn(`Socket connection rejected: Invalid or expired token [socketId: ${socket.id}, reason: ${err.message}]`);
      return next(new Error('Authentication error: Invalid or expired token'));
    }

    if (!decoded || !decoded.userId) {
      logger.warn(`Socket connection rejected: Malformed token payload [socketId: ${socket.id}]`);
      return next(new Error('Authentication error: Malformed token payload'));
    }

    // Verify user in PostgreSQL database
    const { rows } = await pool.query(
      'SELECT id, email, phone, status, is_available FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (rows.length === 0) {
      logger.warn(`Socket connection rejected: User ${decoded.userId} not found`);
      return next(new Error('Authentication error: User not found'));
    }

    const user = rows[0];

    // Reject banned or suspended users
    if (user.status === 'banned') {
      logger.warn(`Socket connection rejected: User ${user.id} is banned`);
      return next(new Error('Authentication error: User account is banned'));
    }

    if (user.status === 'suspended') {
      logger.warn(`Socket connection rejected: User ${user.id} is suspended`);
      return next(new Error('Authentication error: User account is suspended'));
    }

    if (user.status !== 'active') {
      logger.warn(`Socket connection rejected: User ${user.id} status is ${user.status}`);
      return next(new Error('Authentication error: User account is not active'));
    }

    // Attach validated user to socket instance
    socket.user = user;
    socket.userId = user.id;

    return next();
  } catch (error) {
    logger.error('Socket authentication internal error:', error.message);
    return next(new Error('Authentication error: Internal server error'));
  }
}
