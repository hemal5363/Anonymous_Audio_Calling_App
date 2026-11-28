import { logger } from '../utils/logger.js';

/**
 * Manages in-memory active call sessions for ultra-fast WebRTC signaling relay,
 * participant authorization checks, and ringing timeouts.
 */
class CallSessionManager {
  constructor() {
    // Map of callCode -> session object
    this.sessionsByCode = new Map();
    // Map of userId -> session object (for quick disconnect & busy lookups)
    this.sessionsByUser = new Map();
    // Map of sessionId -> session object (for quick push notification state lookups)
    this.sessionsById = new Map();
    // Map of `${callCode}:${userId}` -> disconnect grace timer
    this.disconnectTimers = new Map();
  }

  /**
   * Register a new ringing call session
   */
  createSession({
    sessionId,
    callCode,
    callerId,
    calleeId,
    billingMode,
    ringTimeoutMs = 30000,
    snapshotMaxDuration = 3600,
    onRingTimeout,
    onMaxDuration,
  }) {
    const session = {
      sessionId,
      callCode,
      callerId,
      calleeId,
      status: 'ringing',
      billingMode,
      requestedAt: Date.now(),
      connectedAt: null,
      mutedUsers: new Set(),
      ringingTimer: null,
      maxDurationTimer: null,
      snapshotMaxDuration: Number(snapshotMaxDuration || 3600),
      onMaxDuration,
    };

    if (typeof onRingTimeout === 'function') {
      session.ringingTimer = setTimeout(() => {
        logger.info(`[CallSessionManager] Ringing timeout reached for session: ${callCode}`);
        onRingTimeout(session);
      }, ringTimeoutMs);
    }

    this.sessionsByCode.set(callCode, session);
    this.sessionsByUser.set(callerId, session);
    this.sessionsByUser.set(calleeId, session);
    if (sessionId) {
      this.sessionsById.set(sessionId, session);
    }

    return session;
  }

  /**
   * Get session by callCode
   */
  getSession(callCode) {
    return this.sessionsByCode.get(callCode) || null;
  }

  /**
   * Get session by sessionId
   */
  getSessionById(sessionId) {
    return this.sessionsById.get(sessionId) || null;
  }

  /**
   * Get active session by user ID
   */
  getSessionByUserId(userId) {
    return this.sessionsByUser.get(userId) || null;
  }

  /**
   * Clear ringing timer
   */
  clearRingingTimer(session) {
    if (session && session.ringingTimer) {
      clearTimeout(session.ringingTimer);
      session.ringingTimer = null;
    }
  }

  /**
   * Clear max duration timer
   */
  clearMaxDurationTimer(session) {
    if (session && session.maxDurationTimer) {
      clearTimeout(session.maxDurationTimer);
      session.maxDurationTimer = null;
    }
  }

  /**
   * Start disconnect grace timer for a user in a call
   */
  startDisconnectTimer(callCode, userId, graceMs, onExpire) {
    const key = `${callCode}:${userId}`;
    this.clearDisconnectTimer(callCode, userId);

    const timer = setTimeout(() => {
      this.disconnectTimers.delete(key);
      if (typeof onExpire === 'function') {
        onExpire();
      }
    }, graceMs);

    if (timer && typeof timer.unref === 'function') {
      timer.unref();
    }

    this.disconnectTimers.set(key, timer);
    return timer;
  }

  /**
   * Clear disconnect grace timer if user reconnects
   */
  clearDisconnectTimer(callCode, userId) {
    const key = `${callCode}:${userId}`;
    const timer = this.disconnectTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.disconnectTimers.delete(key);
      return true;
    }
    return false;
  }

  /**
   * Mark session as connected
   */
  markConnected(callCode) {
    const session = this.sessionsByCode.get(callCode);
    if (!session) return null;

    this.clearRingingTimer(session);
    session.status = 'connected';
    session.connectedAt = Date.now();

    // Start max duration timer if configured and not already running
    if (session.snapshotMaxDuration > 0 && !session.maxDurationTimer) {
      session.maxDurationTimer = setTimeout(() => {
        logger.info(`[CallSessionManager] Hard max duration reached for session: ${callCode}`);
        if (typeof session.onMaxDuration === 'function') {
          session.onMaxDuration(session);
        }
      }, session.snapshotMaxDuration * 1000);

      if (session.maxDurationTimer && typeof session.maxDurationTimer.unref === 'function') {
        session.maxDurationTimer.unref();
      }
    }

    return session;
  }

  /**
   * Verify whether a user is an authorized participant in the call session
   */
  isParticipant(callCode, userId) {
    const session = this.sessionsByCode.get(callCode);
    if (!session) return false;
    return session.callerId === userId || session.calleeId === userId;
  }

  /**
   * Get the opposite peer user ID
   */
  getPeerUserId(callCode, userId) {
    const session = this.sessionsByCode.get(callCode);
    if (!session) return null;

    if (session.callerId === userId) return session.calleeId;
    if (session.calleeId === userId) return session.callerId;
    return null;
  }

  /**
   * Toggle or set mute state for a participant
   */
  setMuteState(callCode, userId, isMuted) {
    const session = this.sessionsByCode.get(callCode);
    if (!session) return false;

    if (isMuted) {
      session.mutedUsers.add(userId);
    } else {
      session.mutedUsers.delete(userId);
    }
    return true;
  }

  /**
   * Check if participant is muted
   */
  isUserMuted(callCode, userId) {
    const session = this.sessionsByCode.get(callCode);
    return session ? session.mutedUsers.has(userId) : false;
  }

  /**
   * Conclude and delete session from in-memory tracking
   */
  endSession(callCode) {
    const session = this.sessionsByCode.get(callCode);
    if (!session) return null;

    this.clearRingingTimer(session);
    this.clearMaxDurationTimer(session);
    this.clearDisconnectTimer(callCode, session.callerId);
    this.clearDisconnectTimer(callCode, session.calleeId);

    this.sessionsByCode.delete(callCode);
    this.sessionsByUser.delete(session.callerId);
    this.sessionsByUser.delete(session.calleeId);
    if (session.sessionId) {
      this.sessionsById.delete(session.sessionId);
    }

    return session;
  }

  /**
   * Clear all active sessions (for testing)
   */
  clear() {
    for (const session of this.sessionsByCode.values()) {
      this.clearRingingTimer(session);
      this.clearMaxDurationTimer(session);
    }
    for (const timer of this.disconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.disconnectTimers.clear();
    this.sessionsByCode.clear();
    this.sessionsByUser.clear();
    this.sessionsById.clear();
  }
}

export const callSessionManager = new CallSessionManager();
