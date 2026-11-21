import { pool } from '../db/index.js';

export async function getHealth(req, res) {
  let dbStatus = 'disconnected';
  let dbLatencyMs = null;

  try {
    const start = Date.now();
    await pool.query('SELECT 1');
    dbLatencyMs = Date.now() - start;
    dbStatus = 'connected';
  } catch (error) {
    dbStatus = `disconnected (${error.code || error.message || 'unreachable'})`;
  }

  const isHealthy = dbStatus === 'connected';

  return res.status(200).json({
    status: isHealthy ? 'ok' : 'degraded',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    database: {
      status: dbStatus,
      latencyMs: dbLatencyMs,
    },
  });
}
