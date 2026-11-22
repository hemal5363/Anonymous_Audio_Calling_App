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
    onRingTimeout,
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
   * Mark session as connected
   */
  markConnected(callCode) {
    const session = this.sessionsByCode.get(callCode);
    if (!session) return null;

    this.clearRingingTimer(session);
    session.status = 'connected';
    session.connectedAt = Date.now();
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
    }
    this.sessionsByCode.clear();
    this.sessionsByUser.clear();
    this.sessionsById.clear();
  }
}

export const callSessionManager = new CallSessionManager();
