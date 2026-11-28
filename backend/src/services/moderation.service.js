import { pool } from '../db/index.js';
import { logger } from '../utils/logger.js';
import { settingsRegistry } from './settings.service.js';
import { userSocketMap } from '../socket/userSocketMap.js';

let ioGetter = null;

export function registerModerationIO(getIOFn) {
  ioGetter = getIOFn;
}

/**
 * Checks and clears expired user suspensions dynamically.
 * If user is suspended and suspended_until has elapsed, resets status to 'active'.
 *
 * @param {object} user - User record containing id, status, suspended_until
 * @param {object} clientOrPool - Database client or pool
 * @returns {Promise<boolean>} True if active/un-suspended, false if currently suspended
 */
export async function checkAndClearSuspension(user, clientOrPool = pool) {
  if (!user || user.status !== 'suspended') {
    return true;
  }

  if (user.suspended_until && new Date(user.suspended_until) <= new Date()) {
    try {
      await clientOrPool.query(
        `UPDATE users
         SET status = 'active', suspended_until = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1;`,
        [user.id]
      );
      user.status = 'active';
      user.suspended_until = null;
      logger.info(`[AutoModeration] Suspension expired for user ${user.id}. Account reactivated to active.`);
      return true;
    } catch (err) {
      logger.error(`[AutoModeration] Failed to clear expired suspension for user ${user.id}:`, err.message);
      return false;
    }
  }

  return false;
}

/**
 * Unified auto-moderation pipeline for abuse reports.
 * Used by both user.controller.js and call.service.js.
 *
 * Evaluates reports against:
 * 1. auto_suspend_report_threshold within auto_suspend_window_hours -> auto-suspend for auto_suspension_duration_hours
 * 2. auto_flag_report_threshold -> mark as flagged for moderator audit
 *
 * @param {string} reportedId - UUID of reported user
 * @param {object} clientOrPool - DB pool or client
 * @returns {Promise<{ status: 'none' | 'flagged' | 'suspended', distinctReports: number }>}
 */
export async function processReportAutoModeration(reportedId, clientOrPool = pool) {
  if (!reportedId) {
    return { status: 'none', distinctReports: 0 };
  }

  const autoFlagThreshold = Number(settingsRegistry.get('auto_flag_report_threshold') ?? 3);
  const autoSuspendThreshold = Number(settingsRegistry.get('auto_suspend_report_threshold') ?? 5);
  const autoSuspendWindowHours = Number(settingsRegistry.get('auto_suspend_window_hours') ?? 24);
  const autoSuspensionDurationHours = Number(settingsRegistry.get('auto_suspension_duration_hours') ?? 48);

  try {
    const { rows } = await clientOrPool.query(
      `SELECT COUNT(DISTINCT reporter_id) as count
       FROM reports
       WHERE reported_id = $1 
         AND status != 'dismissed'
         AND created_at >= (CURRENT_TIMESTAMP - ($2 * INTERVAL '1 hour'));`,
      [reportedId, autoSuspendWindowHours]
    );

    const distinctReports = parseInt(rows[0]?.count || 0, 10);

    if (distinctReports >= autoSuspendThreshold) {
      // 1. Auto-suspend user in DB
      await clientOrPool.query(
        `UPDATE users
         SET status = 'suspended',
             suspended_until = CURRENT_TIMESTAMP + ($1 * INTERVAL '1 hour'),
             is_flagged = TRUE,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2;`,
        [autoSuspensionDurationHours, reportedId]
      );

      // 2. Record action in settings_audit
      try {
        await clientOrPool.query(
          `INSERT INTO settings_audit (admin_email, key, old_value, new_value, ip_address, user_agent)
           VALUES ('system:moderation', 'auto_suspend_user', to_jsonb($1::text), jsonb_build_object('user_id', $1::text, 'reason', 'auto_suspend_report_threshold_exceeded', 'duration_hours', $2::int), '127.0.0.1', 'AutoModeration');`,
          [reportedId, autoSuspensionDurationHours]
        );
      } catch (auditErr) {
        logger.warn('[AutoModeration] Failed to record audit entry:', auditErr.message);
      }

      // 3. Force disconnect active socket if connected
      try {
        if (typeof ioGetter === 'function') {
          const io = ioGetter();
          const socketId = userSocketMap.getSocketId(reportedId);
          if (socketId && io) {
            const userSocket = io.sockets.sockets.get(socketId);
            if (userSocket) {
              userSocket.emit('auth:revoked', { message: 'Your account has been suspended due to abuse reports.' });
              userSocket.disconnect(true);
            }
          }
        }
      } catch (sockErr) {
        logger.debug('[AutoModeration] Error notifying socket:', sockErr.message);
      }

      logger.warn(
        `[AutoModeration] User ${reportedId} auto-suspended for ${autoSuspensionDurationHours}h after reaching ${distinctReports} distinct reports in ${autoSuspendWindowHours}h window.`
      );

      return { status: 'suspended', distinctReports };
    } else if (distinctReports >= autoFlagThreshold) {
      await clientOrPool.query(
        `UPDATE users SET is_flagged = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = $1;`,
        [reportedId]
      );

      logger.warn(
        `[AutoModeration] User ${reportedId} marked as flagged for review: reached ${distinctReports} reports (flag threshold: ${autoFlagThreshold}).`
      );

      return { status: 'flagged', distinctReports };
    }

    return { status: 'none', distinctReports };
  } catch (err) {
    logger.error('[AutoModeration] Error during report auto-moderation pipeline:', err.message);
    return { status: 'none', distinctReports: 0, error: err.message };
  }
}
