import { pool } from '../db/index.js';
import { callSessionManager } from '../socket/callSessionManager.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { stopCallBillingTimer } from './billing.service.js';

/**
 * Service handling WebRTC call signaling state transitions,
 * session termination, billing recording, and in-call safety actions.
 */

/**
 * Callee accepts incoming call
 */
export async function acceptCall({ callCode, calleeId }) {
  const session = callSessionManager.getSession(callCode);

  if (!session) {
    // If not found in memory, check DB
    const { rows } = await pool.query(
      `SELECT id, caller_id, callee_id, status FROM call_sessions WHERE call_code = $1;`,
      [callCode]
    );

    if (rows.length === 0 || rows[0].callee_id !== calleeId || rows[0].status !== 'ringing') {
      return { success: false, error: 'invalid_session', message: 'Call session not found or not in ringing state' };
    }

    await pool.query(
      `UPDATE call_sessions SET status = 'connected', connected_at = CURRENT_TIMESTAMP WHERE call_code = $1;`,
      [callCode]
    );

    return {
      success: true,
      sessionId: rows[0].id,
      callerId: rows[0].caller_id,
      calleeId: rows[0].callee_id,
      iceServers: config.webrtc.getIceServers({ callCode, userId: calleeId }),
    };
  }

  if (session.calleeId !== calleeId) {
    return { success: false, error: 'unauthorized', message: 'Only the callee can accept this call' };
  }

  if (session.status !== 'ringing') {
    return { success: false, error: 'invalid_status', message: `Call is already in status '${session.status}'` };
  }

  // Update in-memory state
  callSessionManager.markConnected(callCode);

  // Update DB state by call_code
  try {
    await pool.query(
      `UPDATE call_sessions SET status = 'connected', connected_at = CURRENT_TIMESTAMP WHERE call_code = $1;`,
      [callCode]
    );
  } catch (err) {
    logger.warn('Failed to update call_session status to connected in DB:', err.message);
  }

  logger.debug(`Call accepted and connected: [callCode: ${callCode}, sessionId: ${session.sessionId}]`);

  return {
    success: true,
    sessionId: session.sessionId,
    callerId: session.callerId,
    calleeId: session.calleeId,
    iceServers: config.webrtc.getIceServers({ callCode, userId: calleeId }),
  };
}

/**
 * Callee declines / rejects incoming call
 */
export async function declineCall({ callCode, calleeId, reason = 'declined' }) {
  const session = callSessionManager.getSession(callCode);

  if (!session) {
    const { rows } = await pool.query(
      `SELECT id, caller_id, callee_id, status FROM call_sessions WHERE call_code = $1;`,
      [callCode]
    );

    if (rows.length === 0 || rows[0].callee_id !== calleeId) {
      return { success: false, error: 'invalid_session', message: 'Call session not found' };
    }

    await pool.query(
      `UPDATE call_sessions 
       SET status = 'declined', end_reason = 'declined', ended_at = CURRENT_TIMESTAMP 
       WHERE call_code = $1;`,
      [callCode]
    );

    return {
      success: true,
      sessionId: rows[0].id,
      callerId: rows[0].caller_id,
      calleeId: rows[0].callee_id,
    };
  }

  if (session.calleeId !== calleeId) {
    return { success: false, error: 'unauthorized', message: 'Only the callee can decline this call' };
  }

  stopCallBillingTimer(callCode);
  callSessionManager.endSession(callCode);

  try {
    await pool.query(
      `UPDATE call_sessions 
       SET status = 'declined', end_reason = 'declined', ended_at = CURRENT_TIMESTAMP 
       WHERE call_code = $1;`,
      [callCode]
    );
  } catch (err) {
    logger.warn('Failed to update call_session to declined in DB:', err.message);
  }

  logger.debug(`Call declined: [callCode: ${callCode}, sessionId: ${session.sessionId}]`);

  return {
    success: true,
    sessionId: session.sessionId,
    callerId: session.callerId,
    calleeId: session.calleeId,
  };
}

/**
 * Ringing timeout reached (30s elapsed without callee answer)
 */
export async function handleRingingTimeout({ callCode }) {
  stopCallBillingTimer(callCode);
  const session = callSessionManager.endSession(callCode);

  if (!session) {
    return { success: false };
  }

  try {
    await pool.query(
      `UPDATE call_sessions 
       SET status = 'missed', end_reason = 'ring_timeout', ended_at = CURRENT_TIMESTAMP 
       WHERE call_code = $1;`,
      [callCode]
    );
  } catch (err) {
    logger.warn('Failed to update call_session to missed in DB:', err.message);
  }

  logger.debug(`Call marked missed due to ringing timeout: [callCode: ${callCode}, sessionId: ${session.sessionId}]`);

  return {
    success: true,
    sessionId: session.sessionId,
    callerId: session.callerId,
    calleeId: session.calleeId,
  };
}

/**
 * Ends call (caller hangup, callee hangup, skip, or network disconnect)
 */
export async function endCall({ callCode, userId, reason = null }) {
  stopCallBillingTimer(callCode);
  let session = callSessionManager.endSession(callCode);
  let sessionId, callerId, calleeId, connectedAt;

  if (session) {
    sessionId = session.sessionId;
    callerId = session.callerId;
    calleeId = session.calleeId;
    connectedAt = session.connectedAt;
  } else {
    // If not found in memory, load from DB
    try {
      const { rows } = await pool.query(
        `SELECT id, caller_id, callee_id, status, connected_at FROM call_sessions WHERE call_code = $1;`,
        [callCode]
      );

      if (rows.length === 0) {
        return { success: false, error: 'session_not_found', message: 'Call session not found' };
      }

      sessionId = rows[0].id;
      callerId = rows[0].caller_id;
      calleeId = rows[0].callee_id;
      connectedAt = rows[0].connected_at ? new Date(rows[0].connected_at).getTime() : null;
    } catch (err) {
      return { success: false, error: 'db_error', message: err.message };
    }
  }

  // Calculate duration in seconds
  const durationSeconds = connectedAt ? Math.max(0, Math.round((Date.now() - connectedAt) / 1000)) : 0;

  // Determine valid end reason
  let finalReason = reason;
  if (!finalReason) {
    if (session?.status === 'ringing' && !session?.connectedAt && userId === callerId) {
      finalReason = 'caller_left';
    } else {
      finalReason = userId === callerId ? 'caller_hangup' : 'callee_hangup';
    }
  }

  // Update DB with duration and end reason by call_code
  try {
    await pool.query(
      `UPDATE call_sessions 
       SET status = 'ended', end_reason = $1, duration_seconds = $2, ended_at = CURRENT_TIMESTAMP 
       WHERE call_code = $3;`,
      [finalReason, durationSeconds, callCode]
    );
  } catch (err) {
    logger.warn('Failed to update call_session to ended in DB:', err.message);
  }

  logger.debug(`Call ended: [callCode: ${callCode}, sessionId: ${sessionId}, duration: ${durationSeconds}s, reason: ${finalReason}]`);

  return {
    success: true,
    sessionId,
    callerId,
    calleeId,
    durationSeconds,
    reason: finalReason,
  };
}

/**
 * Block user during or immediately after call
 */
export async function blockPeerDuringCall({ callCode, blockerId }) {
  let blockedId = callSessionManager.getPeerUserId(callCode, blockerId);

  if (!blockedId) {
    const { rows } = await pool.query(
      `SELECT caller_id, callee_id FROM call_sessions WHERE call_code = $1;`,
      [callCode]
    );

    if (rows.length === 0) {
      return { success: false, error: 'session_not_found', message: 'Call session not found' };
    }

    blockedId = rows[0].caller_id === blockerId ? rows[0].callee_id : rows[0].caller_id;
  }

  await pool.query(
    `INSERT INTO blocks (blocker_id, blocked_id) 
     VALUES ($1, $2) 
     ON CONFLICT DO NOTHING;`,
    [blockerId, blockedId]
  );

  logger.info(`Block applied during call: [blockerId: ${blockerId}, blockedId: ${blockedId}, callCode: ${callCode}]`);

  return { success: true, message: 'User blocked successfully' };
}

/**
 * Report user during or immediately after call
 */
export async function reportPeerDuringCall({ callCode, reporterId, reason, note }) {
  let reportedId = callSessionManager.getPeerUserId(callCode, reporterId);
  let sessionId;

  const session = callSessionManager.getSession(callCode);
  if (session) {
    sessionId = session.sessionId;
    reportedId = session.callerId === reporterId ? session.calleeId : session.callerId;
  } else {
    const { rows } = await pool.query(
      `SELECT id, caller_id, callee_id FROM call_sessions WHERE call_code = $1;`,
      [callCode]
    );

    if (rows.length === 0) {
      return { success: false, error: 'session_not_found', message: 'Call session not found' };
    }

    sessionId = rows[0].id;
    reportedId = rows[0].caller_id === reporterId ? rows[0].callee_id : rows[0].caller_id;
  }

  await pool.query(
    `INSERT INTO reports (call_session_id, reporter_id, reported_id, reason, note) 
     VALUES ($1, $2, $3, $4, $5);`,
    [sessionId, reporterId, reportedId, reason, note || null]
  );

  // Check auto-suspension threshold (default 3 reports in 24 hours)
  const reportCountRes = await pool.query(
    `SELECT COUNT(*) as count 
     FROM reports 
     WHERE reported_id = $1 AND created_at >= (NOW() - INTERVAL '24 hours');`,
    [reportedId]
  );

  const reportCount = parseInt(reportCountRes.rows[0]?.count || 0, 10);
  if (reportCount >= 3) {
    await pool.query(
      `UPDATE users SET status = 'suspended', updated_at = CURRENT_TIMESTAMP WHERE id = $1;`,
      [reportedId]
    );
    logger.warn(`User ${reportedId} automatically suspended: reached ${reportCount} reports in 24 hours.`);
  }

  logger.info(`Report submitted: [callCode: ${callCode}, reporterId: ${reporterId}, reportedId: ${reportedId}, reason: ${reason}]`);

  return { success: true, message: 'Report submitted successfully' };
}
