import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

/**
 * SocketAbuseGuard
 * 
 * Enforces per-user rate limiting on socket events, tracks malformed/invalid payloads,
 * applies cooldowns after repeated skips/cancels, and manages payload size limits.
 */
class SocketAbuseGuard {
  constructor() {
    // Map of userId -> { callFind: [timestamps], signal: [timestamps], accept: [timestamps] }
    this.rateLimits = new Map();
    // Map of socketId -> count of malformed events
    this.malformedCounters = new Map();
    // Map of userId -> [skip/cancel timestamps]
    this.skipCancelTimestamps = new Map();
    // Map of userId -> timestamp until which user is on cooldown
    this.cooldowns = new Map();
  }

  /**
   * Helper to clean up timestamps outside the sliding window
   */
  _pruneTimestamps(timestamps, windowMs) {
    const cutoff = Date.now() - windowMs;
    return timestamps.filter((t) => t > cutoff);
  }

  /**
   * Check and consume rate limit quota for a user and action
   * @param {string} userId 
   * @param {'callFind' | 'signal' | 'accept'} action 
   * @returns {{ allowed: boolean, remaining: number }}
   */
  checkRateLimit(userId, action) {
    if (!userId) return { allowed: true, remaining: 999 };

    let userLimits = this.rateLimits.get(userId);
    if (!userLimits) {
      userLimits = { callFind: [], signal: [], accept: [] };
      this.rateLimits.set(userId, userLimits);
    }

    const windowMs = 60 * 1000; // 1 minute sliding window
    let maxAllowed = 60;
    if (action === 'callFind') maxAllowed = config.socketAbuse.callFindMax;
    else if (action === 'signal') maxAllowed = config.socketAbuse.signalMax;
    else if (action === 'accept') maxAllowed = config.socketAbuse.acceptMax;

    userLimits[action] = this._pruneTimestamps(userLimits[action], windowMs);

    if (userLimits[action].length >= maxAllowed) {
      return { allowed: false, remaining: 0 };
    }

    userLimits[action].push(Date.now());
    return { allowed: true, remaining: maxAllowed - userLimits[action].length };
  }

  /**
   * Check if user is currently in a skip/cancel cooldown
   * @param {string} userId 
   * @returns {{ inCooldown: boolean, retryAfterSeconds: number }}
   */
  checkCooldown(userId) {
    if (!userId) return { inCooldown: false, retryAfterSeconds: 0 };

    const cooldownUntil = this.cooldowns.get(userId);
    if (cooldownUntil && cooldownUntil > Date.now()) {
      const remainingSeconds = Math.ceil((cooldownUntil - Date.now()) / 1000);
      return { inCooldown: true, retryAfterSeconds: remainingSeconds };
    }

    if (cooldownUntil) {
      this.cooldowns.delete(userId);
    }

    return { inCooldown: false, retryAfterSeconds: 0 };
  }

  /**
   * Record a skip or cancel action for a user, potentially triggering a cooldown
   * @param {string} userId 
   * @returns {{ triggered: boolean, cooldownSeconds: number }}
   */
  recordSkipOrCancel(userId) {
    if (!userId) return { triggered: false, cooldownSeconds: 0 };

    const windowMs = config.socketAbuse.skipCancelWindowMs;
    const threshold = config.socketAbuse.skipCancelThreshold;
    const cooldownMs = config.socketAbuse.skipCancelCooldownMs;

    let timestamps = this.skipCancelTimestamps.get(userId) || [];
    timestamps = this._pruneTimestamps(timestamps, windowMs);
    timestamps.push(Date.now());
    this.skipCancelTimestamps.set(userId, timestamps);

    if (timestamps.length >= threshold) {
      const cooldownUntil = Date.now() + cooldownMs;
      this.cooldowns.set(userId, cooldownUntil);
      this.skipCancelTimestamps.delete(userId); // reset counter once triggered
      const cooldownSeconds = Math.ceil(cooldownMs / 1000);
      logger.warn(`User ${userId} placed on skip/cancel cooldown for ${cooldownSeconds}s after ${threshold} rapid skips/cancels.`);
      return { triggered: true, cooldownSeconds };
    }

    return { triggered: false, cooldownSeconds: 0 };
  }

  /**
   * Record a malformed/invalid event for a socket. If threshold is exceeded, instruct connection drop.
   * @param {string} socketId 
   * @returns {{ shouldDisconnect: boolean, count: number }}
   */
  recordMalformedEvent(socketId) {
    if (!socketId) return { shouldDisconnect: false, count: 0 };

    const maxMalformed = config.socketAbuse.maxMalformedEvents;
    const current = (this.malformedCounters.get(socketId) || 0) + 1;
    this.malformedCounters.set(socketId, current);

    if (current >= maxMalformed) {
      logger.warn(`Socket ${socketId} exceeded malformed event threshold (${current}/${maxMalformed}). Flagged for disconnect.`);
      return { shouldDisconnect: true, count: current };
    }

    return { shouldDisconnect: false, count: current };
  }

  /**
   * Validate maximum payload size
   * @param {any} payload 
   * @returns {boolean}
   */
  isPayloadSizeValid(payload) {
    if (payload === undefined || payload === null) return true;
    const maxBytes = config.socketAbuse.maxPayloadBytes;
    try {
      const str = typeof payload === 'string' ? payload : JSON.stringify(payload);
      return Buffer.byteLength(str, 'utf8') <= maxBytes;
    } catch {
      return false;
    }
  }

  /**
   * Clean up data on socket disconnect
   * @param {string} socketId 
   */
  cleanSocket(socketId) {
    this.malformedCounters.delete(socketId);
  }

  /**
   * Clear all stored metrics (for test isolation)
   */
  clear() {
    this.rateLimits.clear();
    this.malformedCounters.clear();
    this.skipCancelTimestamps.clear();
    this.cooldowns.clear();
  }
}

export const socketAbuseGuard = new SocketAbuseGuard();
