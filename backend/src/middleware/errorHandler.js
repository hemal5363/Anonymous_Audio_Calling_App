import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';

/**
 * Identify database-specific errors (PostgreSQL, connection failures, query errors)
 */
function isDatabaseError(err) {
  if (!err) return false;

  // PostgreSQL driver properties
  if (err.routine || err.severity || err.table || err.constraint || err.column || err.schema) {
    return true;
  }

  // SQLSTATE codes (5 uppercase alphanumeric characters) or known network/db codes
  if (
    typeof err.code === 'string' &&
    (/^[0-9A-Z]{5}$/.test(err.code) ||
      err.code.startsWith('PG') ||
      err.code === 'ECONNREFUSED' ||
      err.code === 'ETIMEDOUT' ||
      err.code === 'ENOTFOUND')
  ) {
    return true;
  }

  const msg = (err.message || '').toLowerCase();
  if (
    msg.includes('syntax error') ||
    msg.includes('relation "') ||
    msg.includes('column "') ||
    msg.includes('table "') ||
    msg.includes('violates foreign key') ||
    msg.includes('violates unique constraint') ||
    msg.includes('violates not-null') ||
    msg.includes('violates check constraint') ||
    msg.includes('duplicate key value') ||
    msg.includes('database error') ||
    msg.includes('postgres') ||
    msg.includes('connection terminated') ||
    msg.includes('connection refused') ||
    msg.includes('select ') ||
    msg.includes('insert into') ||
    msg.includes('update ') ||
    msg.includes('delete from')
  ) {
    return true;
  }

  return false;
}

/**
 * Central Express error handler:
 * - Never leaks stack traces or SQL errors in production.
 * - Sanitizes database failures to generic user-facing messages.
 * - Logs structured error details via the logger utility.
 */
export function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  const isProd = config.env === 'production' || process.env.NODE_ENV === 'production';
  const isDbErr = isDatabaseError(err);
  const statusCode = isDbErr
    ? 500
    : err.statusCode || (typeof err.status === 'number' ? err.status : 500);

  // Structured logging of the error
  logger.error('Unhandled request error:', {
    message: err.message,
    statusCode,
    name: err.name,
    code: err.code,
    path: req.originalUrl,
    method: req.method,
    stack: isProd ? undefined : err.stack,
  });

  // Determine sanitized error code and message
  let errorType = err.name || 'InternalServerError';
  let message = err.message || 'Internal Server Error';

  if (isDbErr) {
    // Database errors must NEVER leak query text, table names, or constraints
    errorType = 'InternalServerError';
    message = 'A database error occurred. Please try again later.';
  } else if (statusCode >= 500 && isProd) {
    // Generic server errors in production
    errorType = 'InternalServerError';
    message = 'An unexpected internal server error occurred.';
  }

  const responsePayload = {
    statusCode,
    error: errorType,
    message,
    timestamp: new Date().toISOString(),
    path: req.originalUrl,
  };

  // Stack traces must NEVER be exposed in production
  if (!isProd && process.env.NODE_ENV === 'development' && err.stack && !isDbErr) {
    responsePayload.stack = err.stack;
  }

  return res.status(statusCode).json(responsePayload);
}
