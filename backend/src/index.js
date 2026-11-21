import http from 'node:http';
import app from './app.js';
import { config } from './config/index.js';
import { checkDbConnection, pool } from './db/index.js';
import { initSocketServer } from './socket/index.js';
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

  // Create unified HTTP + WebSocket Server on the same Express server
  const httpServer = http.createServer(app);
  const io = initSocketServer(httpServer);

  // Start server listening on 0.0.0.0
  httpServer.listen(config.port, '0.0.0.0', () => {
    logger.info(`Server is listening on port ${config.port} (http://127.0.0.1:${config.port})`);
    logger.info(`Socket.io initialized on same server (ws://127.0.0.1:${config.port}/socket.io/)`);
    logger.info(`Health check endpoint: http://127.0.0.1:${config.port}/health`);
  });

  // Graceful shutdown handling
  async function gracefulShutdown(signal) {
    logger.info(`Received ${signal}. Gracefully shutting down HTTP/WebSocket server and database pool...`);
    
    // Close active socket connections
    if (io) {
      io.close(() => {
        logger.info('Socket.IO engine closed.');
      });
    }

    httpServer.close(async () => {
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
