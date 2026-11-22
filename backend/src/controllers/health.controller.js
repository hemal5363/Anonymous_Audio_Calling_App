import { pool } from '../db/index.js';
import { logger } from '../utils/logger.js';

/**
 * Health Check Endpoint
 * Checks HTTP availability and verifies active database connectivity.
 * Returns 200 if healthy, or 503 (Service Unavailable) if database connection fails.
 */
export async function getHealth(req, res) {
  let dbStatus = 'disconnected';
  let dbLatencyMs = null;

  try {
    const start = Date.now();
    await pool.query('SELECT 1');
    dbLatencyMs = Date.now() - start;
    dbStatus = 'connected';
  } catch (error) {
    logger.error('Health check failed: database ping failed', {
      error: error.message,
      code: error.code,
    });
    dbStatus = 'disconnected';
  }

  const isHealthy = dbStatus === 'connected';
  const statusCode = isHealthy ? 200 : 503;

  return res.status(statusCode).json({
    status: isHealthy ? 'healthy' : 'unhealthy',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    database: {
      status: dbStatus,
      ...(dbLatencyMs !== null ? { latencyMs: dbLatencyMs } : {}),
      ...(isHealthy ? {} : { error: 'Database unavailable' }),
    },
  });
}
