import { logger } from '../utils/logger.js';

export function errorHandler(err, req, res, next) {
  logger.error('Unhandled request error:', err);

  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  res.status(statusCode).json({
    statusCode,
    error: err.name || 'InternalError',
    message,
    timestamp: new Date().toISOString(),
    path: req.originalUrl,
  });
}
