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
    const transport = socket.conn?.transport?.name || 'unknown';

    logger.debug(`[Socket Auth] Incoming handshake attempt: [socketId: ${socket.id}, transport: ${transport}]`);

    // Detect and log token source
    let tokenSource = null;
    let rawToken = null;

    if (handshake.auth?.token && typeof handshake.auth.token === 'string' && handshake.auth.token.trim()) {
      tokenSource = 'auth.token';
      rawToken = handshake.auth.token;
    } else if (handshake.headers?.authorization && typeof handshake.headers.authorization === 'string' && handshake.headers.authorization.trim()) {
      tokenSource = 'headers.authorization';
      rawToken = handshake.headers.authorization;
    } else if (handshake.query?.token && typeof handshake.query.token === 'string' && handshake.query.token.trim()) {
      tokenSource = 'query.token';
      rawToken = handshake.query.token;
    }

    if (!rawToken) {
      logger.debug(`[Socket Auth REJECTED] Reason: Token is required [socketId: ${socket.id}]`);
      return next(new Error('Authentication error: Token is required'));
    }

    logger.debug(`[Socket Auth] Token detected from source: "${tokenSource}" [socketId: ${socket.id}]`);

    const token = rawToken.startsWith('Bearer ') ? rawToken.slice(7).trim() : rawToken.trim();

    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch (err) {
      logger.debug(`[Socket Auth REJECTED] Reason: Invalid or expired token [socketId: ${socket.id}, error: ${err.message}]`);
      return next(new Error('Authentication error: Invalid or expired token'));
    }

    if (!decoded || !decoded.userId) {
      logger.debug(`[Socket Auth REJECTED] Reason: Malformed token payload [socketId: ${socket.id}]`);
      return next(new Error('Authentication error: Malformed token payload'));
    }

    // Verify user in PostgreSQL database
    const { rows } = await pool.query(
      'SELECT id, email, phone, status, is_available FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (rows.length === 0) {
      logger.debug(`[Socket Auth REJECTED] Reason: User not found in DB [socketId: ${socket.id}]`);
      return next(new Error('Authentication error: User not found'));
    }

    const user = rows[0];

    // Reject banned or suspended users
    if (user.status === 'banned') {
      logger.debug(`[Socket Auth REJECTED] Reason: User is banned [socketId: ${socket.id}]`);
      return next(new Error('Authentication error: User account is banned'));
    }

    if (user.status === 'suspended') {
      logger.debug(`[Socket Auth REJECTED] Reason: User is suspended [socketId: ${socket.id}]`);
      return next(new Error('Authentication error: User account is suspended'));
    }

    if (user.status !== 'active') {
      logger.debug(`[Socket Auth REJECTED] Reason: User account is not active (${user.status}) [socketId: ${socket.id}]`);
      return next(new Error(`Authentication error: User account status is ${user.status}`));
    }

    // Attach validated user to socket instance
    socket.user = user;
    socket.userId = user.id;

    logger.debug(`[Socket Auth SUCCESS] User authenticated: [socketId: ${socket.id}, source: ${tokenSource}]`);
    return next();
  } catch (error) {
    logger.error('[Socket Auth REJECTED] Reason: Internal server error:', error.message);
    return next(new Error('Authentication error: Internal server error'));
  }
}
