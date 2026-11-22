const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

function getActiveLogLevel() {
  const envLevel = (
    process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'error' : 'info')
  ).toLowerCase();
  return LOG_LEVELS[envLevel] !== undefined ? LOG_LEVELS[envLevel] : LOG_LEVELS.info;
}

const SENSITIVE_KEYS = /password|token|secret|authorization|otp|push_token|credential/i;

function sanitizeMeta(meta, depth = 0) {
  if (depth > 4 || meta === null || meta === undefined) return meta;
  if (meta instanceof Error) {
    return {
      message: meta.message,
      name: meta.name,
      code: meta.code,
      stack: meta.stack,
    };
  }
  if (Array.isArray(meta)) {
    return meta.map((item) => sanitizeMeta(item, depth + 1));
  }
  if (typeof meta === 'object') {
    const sanitized = {};
    for (const [key, val] of Object.entries(meta)) {
      if (SENSITIVE_KEYS.test(key)) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = sanitizeMeta(val, depth + 1);
      }
    }
    return sanitized;
  }
  return meta;
}

function formatOutput(level, args) {
  const timestamp = new Date().toISOString();
  const isJsonFormat = process.env.LOG_FORMAT === 'json' || process.env.NODE_ENV === 'production';

  let message = '';
  let meta = [];

  if (typeof args[0] === 'string') {
    message = args[0];
    meta = args.slice(1).map((arg) => sanitizeMeta(arg));
  } else {
    meta = args.map((arg) => sanitizeMeta(arg));
    message = meta.length === 1 && meta[0]?.message ? meta[0].message : '';
  }

  if (isJsonFormat) {
    const logObj = {
      timestamp,
      level,
      message,
    };
    if (meta.length === 1 && typeof meta[0] === 'object' && meta[0] !== null) {
      Object.assign(logObj, meta[0]);
    } else if (meta.length > 0) {
      logObj.data = meta;
    }
    return JSON.stringify(logObj);
  }

  // Clean structured human-readable text format
  const metaStr =
    meta.length > 0
      ? ' ' +
        meta
          .map((m) =>
            typeof m === 'object' ? JSON.stringify(m) : m
          )
          .join(' ')
      : '';
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
}

export const logger = {
  error: (...args) => {
    if (getActiveLogLevel() >= LOG_LEVELS.error) {
      console.error(formatOutput('error', args));
    }
  },
  warn: (...args) => {
    if (getActiveLogLevel() >= LOG_LEVELS.warn) {
      console.warn(formatOutput('warn', args));
    }
  },
  info: (...args) => {
    if (getActiveLogLevel() >= LOG_LEVELS.info) {
      console.log(formatOutput('info', args));
    }
  },
  debug: (...args) => {
    if (getActiveLogLevel() >= LOG_LEVELS.debug) {
      console.log(formatOutput('debug', args));
    }
  },
};
