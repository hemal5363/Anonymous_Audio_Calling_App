import { z } from 'zod';
import { pool } from '../db/index.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';
import { callSessionManager } from '../socket/callSessionManager.js';
import { userSocketMap } from '../socket/userSocketMap.js';

// Validation Schemas
const availabilitySchema = z.object({
  is_available: z.boolean({
    required_error: 'is_available is required',
    invalid_type_error: 'is_available must be a boolean',
  }),
});

const pushTokenSchema = z.object({
  push_token: z.string().min(1, 'push_token cannot be empty').trim(),
});

const blockSchema = z.object({
  call_code: z.string().min(1, 'call_code is required').trim(),
});

const reportSchema = z.object({
  call_code: z.string().min(1, 'call_code is required').trim(),
  reason: z.enum(
    ['harassment', 'abusive_language', 'sexual_content', 'scam', 'underage', 'spam', 'other'],
    {
      errorMap: () => ({
        message:
          "Reason must be one of: 'harassment', 'abusive_language', 'sexual_content', 'scam', 'underage', 'spam', 'other'",
      }),
    }
  ),
  note: z.string().max(1000, 'Note must not exceed 1000 characters').optional().nullable(),
});

/**
 * 3.0 Get Current User Profile
 * GET /user/me
 */
export async function getMe(req, res) {
  return res.status(200).json({
    user: req.user,
  });
}

/**
 * 3.1 Toggle Availability Switch
 * PUT /user/availability
 */
export async function toggleAvailability(req, res, next) {
  try {
    const validated = availabilitySchema.safeParse(req.body);
    if (!validated.success) {
      return res.status(400).json({
        statusCode: 400,
        error: 'BadRequest',
        message: validated.error.errors.map((e) => e.message).join(', '),
      });
    }

    const { is_available } = validated.data;
    const userId = req.user.id;

    const { rows } = await pool.query(
      `
      UPDATE users
      SET is_available = $1, available_changed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING is_available, available_changed_at;
      `,
      [is_available, userId]
    );

    logger.info(`User availability updated: [ID: ${userId}, Available: ${is_available}]`);

    // Edge Case (docs/CALL_FLOW.md 9.3): Callee switches is_available to FALSE mid-match while ringing
    if (!is_available) {
      const pendingSession = callSessionManager.getSessionByUserId(userId);
      if (
        pendingSession &&
        pendingSession.calleeId === userId &&
        pendingSession.status === 'ringing'
      ) {
        logger.info(
          `Callee turned off availability during ringing [CallCode: ${pendingSession.callCode}]. Cancelling ringing session...`
        );
        callSessionManager.clearRingingTimer(pendingSession);
        callSessionManager.endSession(pendingSession.callCode);

        try {
          await pool.query(
            `UPDATE call_sessions
             SET status = 'ended', end_reason = 'callee_hangup', ended_at = CURRENT_TIMESTAMP
             WHERE call_code = $1;`,
            [pendingSession.callCode]
          );

          const { getIO } = await import('../socket/index.js');
          const io = getIO();
          io.to(`call:${pendingSession.callCode}`).emit('call:ended', {
            callCode: pendingSession.callCode,
            sessionId: pendingSession.sessionId,
            durationSeconds: 0,
            reason: 'callee_hangup',
          });

          const callerSocketId = userSocketMap.getSocketId(pendingSession.callerId);
          if (callerSocketId) {
            io.to(callerSocketId).emit('call:none-available', {
              error: 'no_users_available',
              message: 'Partner became unavailable.',
            });
          }
        } catch {
          // Socket.IO may not be active in standalone tests
        }
      }
    }

    return res.status(200).json({
      is_available: rows[0].is_available,
      available_changed_at: rows[0].available_changed_at,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 3.2 Register / Update Push Token
 * POST /user/push-token
 */
export async function savePushToken(req, res, next) {
  try {
    const validated = pushTokenSchema.safeParse(req.body);
    if (!validated.success) {
      return res.status(400).json({
        statusCode: 400,
        error: 'BadRequest',
        message: validated.error.errors.map((e) => e.message).join(', '),
      });
    }

    const { push_token } = validated.data;
    const userId = req.user.id;

    await pool.query(
      `
      UPDATE users
      SET push_token = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2;
      `,
      [push_token, userId]
    );

    logger.info(`Push token registered for user: [ID: ${userId}]`);

    return res.status(200).json({
      message: 'Push token registered successfully',
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 3.2b Remove Push Token (on logout)
 * DELETE /user/push-token
 */
export async function removePushToken(req, res, next) {
  try {
    const userId = req.user.id;

    await pool.query(
      `
      UPDATE users
      SET push_token = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1;
      `,
      [userId]
    );

    logger.info(`Push token removed for user: [ID: ${userId}]`);

    return res.status(200).json({
      success: true,
      message: 'Push token removed successfully',
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 3.3 Block User (by Call Code)
 * POST /user/blocks
 * Never returns the other user's identity.
 */
export async function blockUser(req, res, next) {
  try {
    const validated = blockSchema.safeParse(req.body);
    if (!validated.success) {
      return res.status(400).json({
        statusCode: 400,
        error: 'BadRequest',
        message: validated.error.errors.map((e) => e.message).join(', '),
      });
    }

    const { call_code } = validated.data;
    const userId = req.user.id;

    // 1. Find call session
    const { rows: callRows } = await pool.query(
      `
      SELECT id, caller_id, callee_id
      FROM call_sessions
      WHERE call_code = $1;
      `,
      [call_code]
    );

    if (callRows.length === 0) {
      return res.status(404).json({
        statusCode: 404,
        error: 'NotFound',
        message: 'Call session not found',
      });
    }

    const call = callRows[0];
    const isCaller = call.caller_id === userId;
    const isCallee = call.callee_id === userId;

    if (!isCaller && !isCallee) {
      return res.status(404).json({
        statusCode: 404,
        error: 'NotFound',
        message: 'Call session not found or you were not a participant',
      });
    }

    // Identify opposite user to block
    const blockedId = isCaller ? call.callee_id : call.caller_id;

    // 2. Check if already blocked
    const { rows: existingBlock } = await pool.query(
      `
      SELECT id FROM blocks
      WHERE blocker_id = $1 AND blocked_id = $2;
      `,
      [userId, blockedId]
    );

    if (existingBlock.length > 0) {
      return res.status(409).json({
        statusCode: 409,
        error: 'Conflict',
        message: 'User is already blocked',
      });
    }

    // 3. Insert block relationship
    await pool.query(
      `
      INSERT INTO blocks (blocker_id, blocked_id)
      VALUES ($1, $2);
      `,
      [userId, blockedId]
    );

    logger.info(`Block applied via call_code: [Blocker: ${userId}, Call: ${call_code}]`);

    return res.status(201).json({
      message: 'User blocked successfully',
    });
  } catch (error) {
    next(error);
  }
}

/**
 * List own blocked entries (anonymized)
 * GET /user/blocks
 */
export async function getBlockedUsers(req, res, next) {
  try {
    const userId = req.user.id;

    const { rows } = await pool.query(
      `
      SELECT id, created_at
      FROM blocks
      WHERE blocker_id = $1
      ORDER BY created_at DESC;
      `,
      [userId]
    );

    // Strictly returns block record id and timestamp - NO user identity
    const blocks = rows.map((r, index) => ({
      id: r.id,
      label: `Blocked User #${index + 1}`,
      blocked_at: r.created_at,
    }));

    return res.status(200).json({ blocks });
  } catch (error) {
    next(error);
  }
}

/**
 * Unblock user
 * DELETE /user/blocks/:id
 */
export async function unblockUser(req, res, next) {
  try {
    const blockId = req.params.id;
    const userId = req.user.id;

    const result = await pool.query(
      `
      DELETE FROM blocks
      WHERE id = $1 AND blocker_id = $2;
      `,
      [blockId, userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        statusCode: 404,
        error: 'NotFound',
        message: 'Blocked connection not found',
      });
    }

    return res.status(200).json({
      message: 'User unblocked successfully',
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 3.4 Report Call / User
 * POST /user/reports
 * Never returns the reported user's identity.
 */
export async function reportUser(req, res, next) {
  try {
    const validated = reportSchema.safeParse(req.body);
    if (!validated.success) {
      return res.status(400).json({
        statusCode: 400,
        error: 'BadRequest',
        message: validated.error.errors.map((e) => e.message).join(', '),
      });
    }

    const { call_code, reason, note } = validated.data;
    const userId = req.user.id;

    // 1. Locate call session
    const { rows: callRows } = await pool.query(
      `
      SELECT id, caller_id, callee_id
      FROM call_sessions
      WHERE call_code = $1;
      `,
      [call_code]
    );

    if (callRows.length === 0) {
      return res.status(404).json({
        statusCode: 404,
        error: 'NotFound',
        message: 'Call session not found',
      });
    }

    const call = callRows[0];
    const isCaller = call.caller_id === userId;
    const isCallee = call.callee_id === userId;

    if (!isCaller && !isCallee) {
      return res.status(404).json({
        statusCode: 404,
        error: 'NotFound',
        message: 'Call session not found or you were not a participant',
      });
    }

    const reportedId = isCaller ? call.callee_id : call.caller_id;

    // 2. Prevent duplicate report from same user for same call
    const { rows: existingReport } = await pool.query(
      `
      SELECT id FROM reports
      WHERE call_session_id = $1 AND reporter_id = $2;
      `,
      [call.id, userId]
    );

    if (existingReport.length > 0) {
      return res.status(409).json({
        statusCode: 409,
        error: 'Conflict',
        message: 'A report for this call has already been filed by this user',
      });
    }

    // 3. Insert report
    const { rows: reportRows } = await pool.query(
      `
      INSERT INTO reports (call_session_id, reporter_id, reported_id, reason, note, status)
      VALUES ($1, $2, $3, $4, $5, 'pending')
      RETURNING id, status;
      `,
      [call.id, userId, reportedId, reason, note || null]
    );

    const report = reportRows[0];
    logger.info(`Abuse report filed for call ${call_code} by user ${userId} [Reason: ${reason}]`);

    // 4. Auto-Moderation: Check if reported user received reports from several different users
    try {
      let threshold = 3;
      const settingsRes = await pool.query("SELECT value_json FROM app_settings WHERE key = 'moderation';");
      if (settingsRes.rows.length > 0 && settingsRes.rows[0].value_json?.flag_report_threshold) {
        threshold = Number(settingsRes.rows[0].value_json.flag_report_threshold);
      }

      const { rows: reportCountRows } = await pool.query(
        `
        SELECT COUNT(DISTINCT reporter_id) as count
        FROM reports
        WHERE reported_id = $1 AND status != 'dismissed';
        `,
        [reportedId]
      );

      const distinctReports = parseInt(reportCountRows[0].count, 10);
      if (distinctReports >= threshold) {
        // Mark as flagged for admin review without auto-banning
        await pool.query(
          `UPDATE users SET is_flagged = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [reportedId]
        );
        logger.warn(`User ${reportedId} marked as flagged for admin review: received reports from ${distinctReports} distinct users (threshold: ${threshold}).`);
      }
    } catch (err) {
      logger.error('Error checking automated moderation threshold:', err.message);
    }

    return res.status(201).json({
      report_id: report.id,
      status: report.status,
      message: 'Report submitted successfully',
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 4.1 Get Call History
 * GET /calls/history or GET /user/calls
 * Never reveals peer names, numbers, or UUIDs.
 */
export async function getCallHistory(req, res, next) {
  try {
    const userId = req.user.id;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    // 1. Fetch paginated calls (only anonymous call_code and user role)
    const { rows: calls } = await pool.query(
      `
      SELECT 
        call_code,
        CASE WHEN caller_id = $1 THEN 'caller' ELSE 'callee' END as role,
        status,
        duration_seconds,
        requested_at,
        ended_at,
        end_reason,
        amount_charged::text,
        billing_mode
      FROM call_sessions
      WHERE caller_id = $1 OR callee_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3;
      `,
      [userId, limit, offset]
    );

    // 2. Count total
    const { rows: countRows } = await pool.query(
      `
      SELECT COUNT(*) as total
      FROM call_sessions
      WHERE caller_id = $1 OR callee_id = $1;
      `,
      [userId]
    );

    const total = parseInt(countRows[0].total, 10);

    return res.status(200).json({
      calls,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 4.2 Query Call Session State (for Incoming Push Notification Wake-Up & State Checks)
 * GET /calls/session/:sessionId
 * Returns only if the requester is the caller or callee of the session,
 * and returns only the status field ('ringing', 'ended', 'missed').
 */
export async function getSessionById(req, res, next) {
  try {
    const { sessionId } = req.params;
    const userId = req.user.id;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const { rows } = await pool.query(
      `
      SELECT id, call_code, caller_id, callee_id, status, end_reason, requested_at, created_at
      FROM call_sessions
      WHERE id = $1;
      `,
      [sessionId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const session = rows[0];

    // Strictly ensure requester is caller or callee
    if (session.caller_id !== userId && session.callee_id !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Determine normalized status: ringing, ended, or missed
    const memSession =
      callSessionManager.getSession(session.call_code) ||
      callSessionManager.getSessionById(session.id);
    const activeStatus = memSession ? memSession.status : session.status;

    let normalizedStatus;
    if (activeStatus === 'ringing') {
      const requestedTime = memSession?.requestedAt || new Date(session.requested_at).getTime();
      const elapsedSeconds = (Date.now() - requestedTime) / 1000;
      if (elapsedSeconds > 30) {
        normalizedStatus = 'missed';
      } else {
        normalizedStatus = 'ringing';
      }
    } else if (activeStatus === 'missed' || session.end_reason === 'ring_timeout') {
      normalizedStatus = 'missed';
    } else {
      normalizedStatus = 'ended';
    }

    // Return only the status field
    return res.status(200).json({
      status: normalizedStatus,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 4.3 Get Ephemeral TURN / ICE Credentials
 * GET /calls/turn-credentials
 * Generates short-lived HMAC time-limited coturn server credentials for WebRTC peer connection relay.
 */
export function getTurnCredentials(req, res) {
  const iceServers = config.webrtc.getIceServers();
  return res.status(200).json({
    iceServers,
    ttl: config.webrtc.turnTtl,
  });
}

/**
 * 3.5 Delete Account (Google Play Compliance)
 * DELETE /user/account or DELETE /user/me
 * Permanently removes user credentials and personal identifiers (email, phone, password_hash, push_token),
 * revokes all tokens, removes blocks, locks wallet, and anonymizes associated call sessions and reports.
 */
export async function deleteAccount(req, res, next) {
  try {
    const userId = req.user.id;

    // 1. Terminate any active call session for this user in memory
    const activeSession = callSessionManager.getSessionByUserId(userId);
    if (activeSession) {
      try {
        callSessionManager.clearRingingTimer(activeSession);
        callSessionManager.endSession(activeSession.callCode);
        await pool.query(
          `UPDATE call_sessions
           SET status = 'ended', end_reason = 'cancelled', ended_at = CURRENT_TIMESTAMP
           WHERE call_code = $1;`,
          [activeSession.callCode]
        );

        try {
          const { getIO } = await import('../socket/index.js');
          const io = getIO();
          io.to(`call:${activeSession.callCode}`).emit('call:ended', {
            callCode: activeSession.callCode,
            durationSeconds: 0,
            reason: 'account_deleted',
          });
          const peerUserId =
            activeSession.callerId === userId ? activeSession.calleeId : activeSession.callerId;
          const peerSocketId = userSocketMap.getSocketId(peerUserId);
          if (peerSocketId) {
            io.to(peerSocketId).emit('call:ended', {
              callCode: activeSession.callCode,
              durationSeconds: 0,
              reason: 'account_deleted',
            });
          }
        } catch {
          // Socket.IO may not be active during standalone test calls
        }
      } catch (err) {
        logger.error('Error ending active call on account deletion:', err.message);
      }
    }

    // 2. Disconnect user's active socket session
    const socketId = userSocketMap.getSocketId(userId);
    if (socketId) {
      try {
        const { getIO } = await import('../socket/index.js');
        const io = getIO();
        const sock = io.sockets.sockets.get(socketId);
        if (sock) {
          sock.emit('auth:deleted', {
            message: 'Your account has been deleted.',
          });
          sock.disconnect(true);
        }
      } catch {
        // Socket.IO may not be active
      }
      userSocketMap.removeByUserId(userId);
    }

    // 3. Database transaction for complete data erasure & anonymization
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Erase all personal information and credentials
      await client.query(
        `UPDATE users
         SET email = NULL,
             phone = NULL,
             password_hash = NULL,
             push_token = NULL,
             is_available = FALSE,
             status = 'deleted',
             deleted_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1;`,
        [userId]
      );

      // Revoke all refresh tokens
      await client.query(`DELETE FROM refresh_tokens WHERE user_id = $1;`, [userId]);

      // Remove bidirectional block relationships
      await client.query(
        `DELETE FROM blocks WHERE blocker_id = $1 OR blocked_id = $1;`,
        [userId]
      );

      // Anonymize call sessions by nullifying foreign keys
      await client.query(
        `UPDATE call_sessions SET caller_id = NULL WHERE caller_id = $1;`,
        [userId]
      );
      await client.query(
        `UPDATE call_sessions SET callee_id = NULL WHERE callee_id = $1;`,
        [userId]
      );

      // Anonymize reports by nullifying reporter and reported foreign keys
      await client.query(
        `UPDATE reports SET reporter_id = NULL WHERE reporter_id = $1;`,
        [userId]
      );
      await client.query(
        `UPDATE reports SET reported_id = NULL WHERE reported_id = $1;`,
        [userId]
      );

      // Lock wallet if present
      await client.query(
        `UPDATE wallets SET is_locked = TRUE, updated_at = CURRENT_TIMESTAMP WHERE user_id = $1;`,
        [userId]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    logger.info(`User account deleted and personal data completely sanitized [ID: ${userId}]`);

    return res.status(200).json({
      success: true,
      message: 'Your account and personal data have been permanently deleted.',
    });
  } catch (error) {
    next(error);
  }
}
