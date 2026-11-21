import pg from 'pg';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.db.url,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  logger.error('Unexpected error on idle PostgreSQL client:', err.message);
});

/**
 * Execute a query with parameters
 */
export async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  logger.debug('Executed query', { text, duration, rows: res.rowCount });
  return res;
}

/**
 * Checks database connection at startup or health check
 */
export async function checkDbConnection() {
  const client = await pool.connect();
  try {
    const res = await client.query('SELECT NOW() as current_time, current_database() as db_name');
    logger.info(`PostgreSQL connected successfully [DB: ${res.rows[0].db_name}, Server Time: ${res.rows[0].current_time}]`);
    return {
      connected: true,
      database: res.rows[0].db_name,
      timestamp: res.rows[0].current_time,
    };
  } finally {
    client.release();
  }
}
