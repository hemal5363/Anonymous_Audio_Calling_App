import { verifyAccessToken } from '../utils/token.js';
import { pool } from '../db/index.js';

/**
 * Middleware ensuring request is made with a valid Admin token.
 * Normal user tokens are strictly rejected with 403 Forbidden.
 */
export async function authenticateAdmin(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Admin authorization token is missing or malformed',
      timestamp: new Date().toISOString(),
      path: req.originalUrl,
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = verifyAccessToken(token);

    // CRITICAL: Reject normal user tokens!
    if (decoded.type !== 'admin' || !decoded.adminId) {
      return res.status(403).json({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Admin access required. User tokens are not allowed on admin routes.',
        timestamp: new Date().toISOString(),
        path: req.originalUrl,
      });
    }

    // Verify admin exists in database and is active
    const { rows } = await pool.query(
      'SELECT id, email, role, is_active FROM admin_users WHERE id = $1',
      [decoded.adminId]
    );

    if (rows.length === 0 || !rows[0].is_active) {
      return res.status(403).json({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Admin account has been deactivated or not found',
        timestamp: new Date().toISOString(),
        path: req.originalUrl,
      });
    }

    req.admin = rows[0];
    next();
  } catch (err) {
    return res.status(401).json({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Invalid or expired admin token',
      timestamp: new Date().toISOString(),
      path: req.originalUrl,
    });
  }
}
