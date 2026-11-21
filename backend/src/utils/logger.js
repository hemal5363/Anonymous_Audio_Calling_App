const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

function getActiveLogLevel() {
  const envLevel = (process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'error' : 'info')).toLowerCase();
  return LOG_LEVELS[envLevel] !== undefined ? LOG_LEVELS[envLevel] : LOG_LEVELS.info;
}

export const logger = {
  error: (...args) => {
    if (getActiveLogLevel() >= LOG_LEVELS.error) {
      console.error(`[${new Date().toISOString()}] [ERROR]`, ...args);
    }
  },
  warn: (...args) => {
    if (getActiveLogLevel() >= LOG_LEVELS.warn) {
      console.warn(`[${new Date().toISOString()}] [WARN]`, ...args);
    }
  },
  info: (...args) => {
    if (getActiveLogLevel() >= LOG_LEVELS.info) {
      console.log(`[${new Date().toISOString()}] [INFO]`, ...args);
    }
  },
  debug: (...args) => {
    if (getActiveLogLevel() >= LOG_LEVELS.debug) {
      console.log(`[${new Date().toISOString()}] [DEBUG]`, ...args);
    }
  },
};
