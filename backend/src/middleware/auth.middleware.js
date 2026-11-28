import { verifyAccessToken } from '../utils/token.js';
import { pool } from '../db/index.js';
import { checkAndClearSuspension } from '../services/moderation.service.js';

export async function authenticateUser(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Authentication token is missing or malformed',
      timestamp: new Date().toISOString(),
      path: req.originalUrl,
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = verifyAccessToken(token);

    // Verify user still exists and is not suspended or banned
    const { rows } = await pool.query(
      'SELECT id, email, phone, status, is_available, suspended_until, terms_version, privacy_version FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (rows.length === 0) {
      return res.status(401).json({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'User account no longer exists',
        timestamp: new Date().toISOString(),
        path: req.originalUrl,
      });
    }

    const user = rows[0];

    await checkAndClearSuspension(user, pool);
    if (user.status === 'suspended' || user.status === 'banned') {
      return res.status(403).json({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Your account has been suspended or banned',
        timestamp: new Date().toISOString(),
        path: req.originalUrl,
      });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Invalid or expired access token',
      timestamp: new Date().toISOString(),
      path: req.originalUrl,
    });
  }
}
