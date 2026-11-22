import http from 'node:http';
import app from './app.js';
import { config } from './config/index.js';
import { checkDbConnection, pool } from './db/index.js';
import { initSocketServer } from './socket/index.js';
import { callSessionManager } from './socket/callSessionManager.js';
import { logger } from './utils/logger.js';
import { startCleanupJob, stopCleanupJob, runStartupRecovery } from './services/cleanup.service.js';

// Top-level handlers for unexpected runtime exceptions and promise rejections
// Log structured error and cleanly exit so a process manager (PM2, Docker, systemd, Kubernetes) restarts it
process.on('uncaughtException', (error) => {
  logger.error('[FATAL] Uncaught Exception:', {
    message: error?.message,
    name: error?.name,
    stack: error?.stack,
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('[FATAL] Unhandled Promise Rejection:', {
    reason: reason instanceof Error ? { message: reason.message, stack: reason.stack } : reason,
  });
  process.exit(1);
});

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

  // Run database startup recovery for stuck call sessions from earlier crashes
  try {
    await runStartupRecovery();
  } catch (err) {
    logger.error('Startup recovery error:', err.message);
  }

  // Create unified HTTP + WebSocket Server on the same Express server
  const httpServer = http.createServer(app);
  const io = initSocketServer(httpServer);

  // Start periodic background database cleanup job
  startCleanupJob();

  // Start server listening on host configured in environment (default 0.0.0.0)
  httpServer.listen(config.port, config.host, () => {
    logger.info(`Server is listening on ${config.host}:${config.port} (http://${config.host === '0.0.0.0' ? '127.0.0.1' : config.host}:${config.port})`);
    logger.info(`Socket.io initialized on same server (ws://${config.host === '0.0.0.0' ? '127.0.0.1' : config.host}:${config.port}/socket.io/)`);
    logger.info(`Health check endpoint: http://${config.host === '0.0.0.0' ? '127.0.0.1' : config.host}:${config.port}/health`);
  });

  // Graceful shutdown handling
  let isShuttingDown = false;

  async function gracefulShutdown(signal) {
    if (isShuttingDown) {
      logger.warn(`Shutdown already in progress, ignoring repeated ${signal}`);
      return;
    }
    isShuttingDown = true;
    logger.info(`Received ${signal}. Gracefully shutting down HTTP/WebSocket server, ending active calls, and closing database pool...`);

    // 1. Stop periodic background database cleanup job
    stopCleanupJob();

    // 2. Stop accepting new socket connections and cleanly conclude active calls
    if (io) {
      try {
        // Conclude all in-memory active call sessions
        const activeSessions = Array.from(callSessionManager.sessionsByCode.values());
        for (const session of activeSessions) {
          try {
            callSessionManager.clearRingingTimer(session);
            const duration = session.connectedAt
              ? Math.max(0, Math.floor((Date.now() - session.connectedAt) / 1000))
              : 0;
            io.to(`call:${session.callCode}`).emit('call:ended', {
              callCode: session.callCode,
              sessionId: session.sessionId,
              reason: 'system_shutdown',
              durationSeconds: duration,
            });
          } catch (err) {
            logger.error('Error concluding active session during shutdown:', err.message);
          }
        }

        // Close Socket.io server engine to stop accepting sockets
        io.close(() => {
          logger.info('Socket.IO engine closed.');
        });
      } catch (err) {
        logger.error('Error closing Socket.IO during shutdown:', err.message);
      }
    }

    // 3. Update database records for active call sessions
    try {
      await pool.query(
        `UPDATE call_sessions
         SET status = 'ended',
             end_reason = 'system_shutdown',
             ended_at = CURRENT_TIMESTAMP,
             duration_seconds = GREATEST(0, EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - COALESCE(connected_at, requested_at)))::int)
         WHERE status IN ('requested', 'ringing', 'connected');`
      );
      logger.info('All active database call sessions marked ended with system_shutdown.');
    } catch (err) {
      logger.error('Error marking call sessions ended in database:', err.message);
    }

    // 4. Close HTTP server
    httpServer.close(async () => {
      logger.info('HTTP server closed.');

      // 5. Close PostgreSQL connection pool
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
