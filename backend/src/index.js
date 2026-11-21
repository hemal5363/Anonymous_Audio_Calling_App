import app from './app.js';
import { config } from './config/index.js';
import { checkDbConnection, pool } from './db/index.js';
import { logger } from './utils/logger.js';

async function bootstrap() {
  logger.info(`Starting Anonymous Audio Calling Backend in [${config.env}] mode...`);

  // Check database connection at startup
  try {
    await checkDbConnection();
  } catch (error) {
    const errorDetail = error.message || error.code || error;
    logger.error(`Database connection check failed at startup: ${errorDetail}`);
    logger.warn('Verify that PostgreSQL is running and DATABASE_URL in your .env file is correct.');
  }

  // Start HTTP server on 0.0.0.0
  const server = app.listen(config.port, '0.0.0.0', () => {
    logger.info(`Server is listening on port ${config.port} (http://127.0.0.1:${config.port})`);
    logger.info(`Health check endpoint: http://127.0.0.1:${config.port}/health`);
  });

  // Graceful shutdown handling
  async function gracefulShutdown(signal) {
    logger.info(`Received ${signal}. Gracefully shutting down HTTP server and database pool...`);
    server.close(async () => {
      logger.info('HTTP server closed.');
      try {
        await pool.end();
        logger.info('PostgreSQL pool drained and closed.');
      } catch (err) {
        logger.error('Error closing database pool:', err.message);
      }
      process.exit(0);
    });

    // Force shutdown after 10s timeout
    setTimeout(() => {
      logger.error('Forced shutdown after timeout.');
      process.exit(1);
    }, 10000).unref();
  }

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

bootstrap().catch((err) => {
  logger.error('Fatal bootstrap error:', err);
  process.exit(1);
});
