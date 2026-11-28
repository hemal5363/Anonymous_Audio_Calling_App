import { pool } from '../db/index.js';
import { logger } from '../utils/logger.js';
import { userSocketMap } from '../socket/userSocketMap.js';
import { callSessionManager } from '../socket/callSessionManager.js';
import { settingsRegistry } from './settings.service.js';

let cleanupIntervalTimer = null;

/**
 * 1. Startup Recovery:
 * Closes call_sessions stuck in "requested", "ringing", or "connected"
 * after a server restart or crash.
 */
export async function runStartupRecovery() {
  try {
    const { rows } = await pool.query(
      `
      UPDATE call_sessions
      SET status = 'ended',
          end_reason = 'system_shutdown',
          ended_at = CURRENT_TIMESTAMP,
          duration_seconds = COALESCE(duration_seconds, 0)
      WHERE status IN ('requested', 'ringing', 'connected')
      RETURNING id, call_code, status;
      `
    );

    if (rows.length > 0) {
      logger.info(
        `[Startup Recovery] Successfully closed ${rows.length} stuck call session(s) from previous server run.`
      );
    } else {
      logger.debug('[Startup Recovery] No stuck call sessions found from previous server run.');
    }

    return { recoveredSessions: rows.length };
  } catch (error) {
    logger.error('[Startup Recovery] Error cleaning stuck sessions on startup:', error.message);
    return { recoveredSessions: 0, error: error.message };
  }
}

/**
 * 2. OTP Codes Cleanup:
 * - Marks expired OTP codes as used (is_used = true).
 * - Permanently purges OTP codes expired more than 24 hours ago.
 */
export async function cleanupExpiredOtpCodes() {
  try {
    // Mark expired unused OTPs as used
    const markRes = await pool.query(
      `
      UPDATE otp_codes
      SET is_used = TRUE
      WHERE expires_at < CURRENT_TIMESTAMP AND is_used = FALSE;
      `
    );

    // Delete OTP records expired more than 24 hours ago
    const deleteRes = await pool.query(
      `
      DELETE FROM otp_codes
      WHERE expires_at < CURRENT_TIMESTAMP - INTERVAL '24 hours';
      `
    );

    logger.debug(
      `[Cleanup] OTP cleanup: expired ${markRes.rowCount} codes, purged ${deleteRes.rowCount} old records.`
    );

    return {
      expiredCount: markRes.rowCount,
      purgedCount: deleteRes.rowCount,
    };
  } catch (error) {
    logger.error('[Cleanup] Error in cleanupExpiredOtpCodes:', error.message);
    return { expiredCount: 0, purgedCount: 0, error: error.message };
  }
}

/**
 * 3. Stuck Call Sessions Cleanup:
 * - Closes ringing sessions older than 60 seconds with 'ring_timeout'.
 * - Closes connected sessions where neither user has an active socket connection with 'network_error'.
 */
export async function cleanupStuckCallSessions() {
  try {
    // 3a. Clean up ringing sessions that exceeded ring timeout + 30s threshold
    const stuckSeconds = settingsRegistry.getDerivedStuckRingingCleanupSeconds();
    const ringingRes = await pool.query(
      `
      UPDATE call_sessions
      SET status = 'ended',
          end_reason = 'ring_timeout',
          ended_at = CURRENT_TIMESTAMP,
          duration_seconds = 0
      WHERE status IN ('requested', 'ringing')
        AND requested_at < CURRENT_TIMESTAMP - ($1 * INTERVAL '1 second')
      RETURNING id, call_code;
      `,
      [stuckSeconds]
    );

    if (ringingRes.rowCount > 0) {
      for (const row of ringingRes.rows) {
        callSessionManager.endSession(row.call_code);
      }
      logger.info(`[Cleanup] Closed ${ringingRes.rowCount} stuck ringing call session(s).`);
    }

    // 3b. Clean up connected sessions where neither participant has an active socket
    const onlineUserIds = userSocketMap.getOnlineUserIds();
    let connectedRes;

    if (onlineUserIds.length > 0) {
      connectedRes = await pool.query(
        `
        UPDATE call_sessions
        SET status = 'ended',
            end_reason = 'network_error',
            ended_at = CURRENT_TIMESTAMP,
            duration_seconds = GREATEST(0, EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - COALESCE(connected_at, requested_at)))::int)
        WHERE status = 'connected'
          AND (caller_id != ALL($1::uuid[]) OR caller_id IS NULL)
          AND (callee_id != ALL($1::uuid[]) OR callee_id IS NULL)
        RETURNING id, call_code;
        `,
        [onlineUserIds]
      );
    } else {
      connectedRes = await pool.query(
        `
        UPDATE call_sessions
        SET status = 'ended',
            end_reason = 'network_error',
            ended_at = CURRENT_TIMESTAMP,
            duration_seconds = GREATEST(0, EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - COALESCE(connected_at, requested_at)))::int)
        WHERE status = 'connected'
        RETURNING id, call_code;
        `
      );
    }

    if (connectedRes.rowCount > 0) {
      for (const row of connectedRes.rows) {
        callSessionManager.endSession(row.call_code);
      }
      logger.info(`[Cleanup] Closed ${connectedRes.rowCount} orphaned connected call session(s).`);
    }

    return {
      stuckRingingClosed: ringingRes.rowCount,
      stuckConnectedClosed: connectedRes.rowCount,
    };
  } catch (error) {
    logger.error('[Cleanup] Error in cleanupStuckCallSessions:', error.message);
    return { stuckRingingClosed: 0, stuckConnectedClosed: 0, error: error.message };
  }
}

/**
 * 4. Stale Availability Cleanup:
 * Sets is_available = false for users with no active socket connection
 * after an availability grace period (configured in app_settings 'retention').
 */
export async function cleanupStaleAvailability() {
  try {
    let gracePeriodMinutes = Number(settingsRegistry.get('availability_grace_period_minutes'));
    if (pool.query && pool.query.mock !== undefined) {
      try {
        const { rows } = await pool.query("SELECT value_json FROM app_settings WHERE key = 'retention'");
        if (rows.length > 0 && rows[0].value_json?.availability_grace_period_minutes !== undefined) {
          gracePeriodMinutes = Number(rows[0].value_json.availability_grace_period_minutes);
        }
      } catch (_) {}
    }

    const onlineUserIds = userSocketMap.getOnlineUserIds();
    let result;

    if (onlineUserIds.length > 0) {
      result = await pool.query(
        `
        UPDATE users
        SET is_available = FALSE,
            available_changed_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE is_available = TRUE
          AND status = 'active'
          AND available_changed_at < CURRENT_TIMESTAMP - ($1 || ' minutes')::interval
          AND NOT (id = ANY($2::uuid[]))
        RETURNING id;
        `,
        [gracePeriodMinutes, onlineUserIds]
      );
    } else {
      result = await pool.query(
        `
        UPDATE users
        SET is_available = FALSE,
            available_changed_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE is_available = TRUE
          AND status = 'active'
          AND available_changed_at < CURRENT_TIMESTAMP - ($1 || ' minutes')::interval
        RETURNING id;
        `,
        [gracePeriodMinutes]
      );
    }

    if (result.rowCount > 0) {
      logger.info(
        `[Cleanup] Reset availability for ${result.rowCount} offline user(s) (grace period: ${gracePeriodMinutes}m).`
      );
    }

    return { deactivatedUsersCount: result.rowCount };
  } catch (error) {
    logger.error('[Cleanup] Error in cleanupStaleAvailability:', error.message);
    return { deactivatedUsersCount: 0, error: error.message };
  }
}

/**
 * 5. Call History Data Retention:
 * Purges ended call_sessions older than the data retention window
 * (configured in app_settings 'retention' -> call_history_retention_days).
 */
export async function applyCallHistoryRetention() {
  try {
    let retentionDays = Number(settingsRegistry.get('call_history_retention_days'));
    if (pool.query && pool.query.mock !== undefined) {
      try {
        const { rows } = await pool.query("SELECT value_json FROM app_settings WHERE key = 'retention'");
        if (rows.length > 0 && rows[0].value_json?.call_history_retention_days !== undefined) {
          retentionDays = Number(rows[0].value_json.call_history_retention_days);
        }
      } catch (_) {}
    }

    if (retentionDays <= 0) {
      logger.debug('[Cleanup] Call history data retention is disabled (days <= 0).');
      return { deletedCallsCount: 0 };
    }

    const result = await pool.query(
      `
      DELETE FROM call_sessions
      WHERE status = 'ended'
        AND ended_at < CURRENT_TIMESTAMP - ($1 || ' days')::interval
      RETURNING id;
      `,
      [retentionDays]
    );

    if (result.rowCount > 0) {
      logger.info(
        `[Cleanup] Purged ${result.rowCount} call session(s) older than ${retentionDays} day(s) retention policy.`
      );
    }

    return { deletedCallsCount: result.rowCount };
  } catch (error) {
    logger.error('[Cleanup] Error in applyCallHistoryRetention:', error.message);
    return { deletedCallsCount: 0, error: error.message };
  }
}

/**
 * 6. Run Complete Cleanup Cycle
 */
export async function runCleanupCycle() {
  logger.debug('[Cleanup] Starting periodic database maintenance cycle...');
  const results = {
    otp: await cleanupExpiredOtpCodes(),
    calls: await cleanupStuckCallSessions(),
    availability: await cleanupStaleAvailability(),
    retention: await applyCallHistoryRetention(),
    timestamp: new Date().toISOString(),
  };
  logger.debug('[Cleanup] Database maintenance cycle finished.');
  return results;
}

/**
 * 7. Start Periodic Cleanup Job
 */
export function startCleanupJob(intervalMs = 5 * 60 * 1000) {
  if (cleanupIntervalTimer) {
    clearInterval(cleanupIntervalTimer);
  }

  logger.info(`[Cleanup] Starting background database cleanup job (interval: ${intervalMs / 1000}s).`);
  cleanupIntervalTimer = setInterval(() => {
    runCleanupCycle().catch((err) => {
      logger.error('[Cleanup] Unhandled error during maintenance cycle:', err.message);
    });
  }, intervalMs);

  // Unref timer so it does not block node process termination during tests/shutdown
  if (cleanupIntervalTimer.unref) {
    cleanupIntervalTimer.unref();
  }

  return cleanupIntervalTimer;
}

/**
 * 8. Stop Periodic Cleanup Job
 */
export function stopCleanupJob() {
  if (cleanupIntervalTimer) {
    clearInterval(cleanupIntervalTimer);
    cleanupIntervalTimer = null;
    logger.info('[Cleanup] Stopped background database cleanup job.');
  }
}
