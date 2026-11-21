import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './index.js';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, 'migrations');

async function runMigrations() {
  logger.info('Starting database migrations...');
  const client = await pool.connect();

  try {
    // 1. Create migrations tracking table if not exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Read already applied migrations
    const { rows: appliedRows } = await client.query('SELECT name FROM _migrations ORDER BY id ASC');
    const appliedSet = new Set(appliedRows.map((r) => r.name));

    // 3. Read migration files from migrations folder
    if (!fs.existsSync(migrationsDir)) {
      logger.warn(`Migrations directory not found at ${migrationsDir}`);
      return;
    }

    const migrationFiles = fs
      .readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    const pendingFiles = migrationFiles.filter((file) => !appliedSet.has(file));

    if (pendingFiles.length === 0) {
      logger.info('Database schema is up to date. No pending migrations.');
      return;
    }

    logger.info(`Found ${pendingFiles.length} pending migration(s) to apply.`);

    // 4. Apply each pending migration inside a transaction
    for (const file of pendingFiles) {
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');

      logger.info(`Applying migration: ${file}...`);

      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        logger.info(`Successfully applied migration: ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        logger.error(`Failed to apply migration ${file}:`, err.message);
        throw err;
      }
    }

    logger.info('All migrations applied successfully.');
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    logger.error('Migration failed:', err);
    process.exit(1);
  });
