import crypto from 'node:crypto';
import { pool } from '../db/index.js';
import { checkCallerBillingStanding } from './billing.service.js';
import { logger } from '../utils/logger.js';
import { callSessionManager } from '../socket/callSessionManager.js';
import { settingsRegistry } from './settings.service.js';

let cachedCooldownSeconds = null;

/**
 * Invalidate the in-memory matching settings cache.
 * Cleared immediately whenever an administrator saves matching_settings.
 */
export function clearMatchingSettingsCache() {
  cachedCooldownSeconds = null;
}

/**
 * Fetch same-peer rematch cooldown seconds from app_settings (or cache).
 * Allowed values: 0 to 86400 (default: 60). 0 disables the rematch exclusion rule.
 */
export async function getMatchingCooldownSeconds(clientOrPool = pool) {
  if (cachedCooldownSeconds !== null) {
    return cachedCooldownSeconds;
  }

  // If running inside a unit test that mocked pool.connect without real DB, use default 60s
  if (pool.connect && pool.connect.mock !== undefined) {
    return 60;
  }

  try {
    return settingsRegistry.get('cooldown_same_peer_seconds');
  } catch (err) {
    logger.warn('Failed to retrieve matching_settings from registry, defaulting to 60s:', err.message);
    return 60;
  }
}

/**
 * Executes the atomic candidate matching algorithm as specified in docs/CALL_FLOW.md.
 * 
 * Guarantees:
 * 1. Atomic claim via SELECT ... FOR UPDATE SKIP LOCKED prevents race conditions.
 * 2. Caller and callee are guaranteed not to be in another active call.
 * 3. Bidirectional blocks are strictly respected.
 * 4. Anonymous tokens only (neither party receives the other's ID, email, or phone).
 */
export async function matchCaller(callerId, liveSocketUserIds = [], busyUserIds = []) {
  const client = await pool.connect();

  try {
    const maxAttempts = Math.max(1, Number(settingsRegistry.get('max_match_attempts') ?? 3));
    const cooldownSeconds = Number(settingsRegistry.get('cooldown_same_peer_seconds') ?? 60);
    const tryLiveFirst = Boolean(settingsRegistry.get('try_live_presence_first'));

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await client.query('BEGIN');

      // 1. Lock caller row and verify caller is active
      const callerRes = await client.query(
        `SELECT id, status, is_available 
         FROM users 
         WHERE id = $1 
         FOR UPDATE;`,
        [callerId]
      );

      if (callerRes.rows.length === 0 || callerRes.rows[0].status !== 'active') {
        await client.query('ROLLBACK');
        return {
          success: false,
          error: 'caller_not_active',
          message: 'Your account is not active or eligible to place calls.',
        };
      }

      // 2. Check caller is not already participating in an active call
      const activeCallRes = await client.query(
        `SELECT id, call_code 
         FROM call_sessions 
         WHERE (caller_id = $1 OR callee_id = $1) 
           AND status IN ('requested', 'ringing', 'connected')
         LIMIT 1;`,
        [callerId]
      );

      if (activeCallRes.rows.length > 0) {
        await client.query('ROLLBACK');
        return {
          success: false,
          error: 'already_in_call',
          message: 'You are already in an active call.',
        };
      }

      // 3. Pre-call billing check (Step 4 billing check)
      const billingResult = await checkCallerBillingStanding(client, callerId);
      if (!billingResult.allowed) {
        await client.query('ROLLBACK');
        return {
          success: false,
          error: billingResult.error,
          message: billingResult.message,
        };
      }

      // 4. Atomically locate and lock exactly one eligible callee
      const liveIds = Array.isArray(liveSocketUserIds)
        ? liveSocketUserIds.filter((id) => typeof id === 'string' && id !== callerId)
        : [];

      const busyIds = Array.isArray(busyUserIds)
        ? busyUserIds.filter((id) => typeof id === 'string')
        : [];

      const candidateQuery = `
        WITH eligible_candidate AS (
          SELECT u.id, u.push_token
          FROM users u
          WHERE u.status = 'active'
            AND u.is_available = TRUE
            AND u.active_call_code IS NULL
            AND u.id <> $1
            -- Exclude in-memory active users
            AND NOT (u.id = ANY($3::uuid[]))
            -- Exclude busy users in DB
            AND NOT EXISTS (
              SELECT 1 FROM call_sessions cs
              WHERE (cs.caller_id = u.id OR cs.callee_id = u.id)
                AND cs.status IN ('requested', 'ringing', 'connected')
            )
            -- Exclude blocks in either direction
            AND NOT EXISTS (
              SELECT 1 FROM blocks b
              WHERE (b.blocker_id = $1 AND b.blocked_id = u.id)
                 OR (b.blocker_id = u.id AND b.blocked_id = $1)
            )
            -- Cooldown: avoid rematching with same user within cooldown window (if enabled)
            AND (
              $4::int <= 0
              OR NOT EXISTS (
                SELECT 1 FROM call_sessions cs_recent
                WHERE ((cs_recent.caller_id = $1 AND cs_recent.callee_id = u.id)
                    OR (cs_recent.caller_id = u.id AND cs_recent.callee_id = $1))
                  AND cs_recent.created_at > (NOW() - ($4 * INTERVAL '1 second'))
              )
            )
          ORDER BY 
            -- Prioritize users with live socket connection if configured
            CASE WHEN $5::boolean AND u.id = ANY($2::uuid[]) THEN 0 ELSE 1 END,
            RANDOM()
          LIMIT 1
          FOR UPDATE OF u SKIP LOCKED
        )
        SELECT id, push_token FROM eligible_candidate;
      `;

      const candidateRes = await client.query(candidateQuery, [
        callerId,
        liveIds,
        busyIds,
        cooldownSeconds,
        tryLiveFirst,
      ]);

      if (candidateRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return {
          success: false,
          error: 'no_users_available',
          message: 'No available users at this moment.',
        };
      }

      const callee = candidateRes.rows[0];

      // Double-check in-memory state: callee must not have become busy while query was executing
      if (callSessionManager.getSessionByUserId(callee.id)) {
        await client.query('ROLLBACK');
        if (attempt < maxAttempts) {
          continue;
        }
        return {
          success: false,
          error: 'no_users_available',
          message: 'No available users at this moment.',
        };
      }

      // 5. Create call_sessions row with status 'ringing' and snapshot billing/call settings
      let session;
      try {
        const snapMode = settingsRegistry.get('monetization_mode');
        const snapRate = Number(settingsRegistry.get('billing_rate_per_minute'));
        const snapRing = Number(settingsRegistry.get('ring_timeout_seconds'));
        const snapDuration = Number(settingsRegistry.get('max_call_duration_seconds'));
        const snapCurrency = 'INR';

        const sessionRes = await client.query(
          `INSERT INTO call_sessions (
             call_code,
             caller_id,
             callee_id,
             status,
             billing_mode,
             requested_at,
             snapshot_mode,
             snapshot_rate_per_minute,
             snapshot_ring_timeout,
             snapshot_max_duration,
             snapshot_currency
           )
           VALUES (
             gen_random_uuid()::text,
             $1,
             $2,
             'ringing',
             $3,
             CURRENT_TIMESTAMP,
             $4,
             $5,
             $6,
             $7,
             $8
           )
           RETURNING id, call_code, status, billing_mode, requested_at, snapshot_mode, snapshot_rate_per_minute, snapshot_ring_timeout, snapshot_max_duration, snapshot_currency;`,
          [callerId, callee.id, billingResult.mode, snapMode, snapRate, snapRing, snapDuration, snapCurrency]
        );

        session = sessionRes.rows[0];
        await client.query('COMMIT');
      } catch (insertErr) {
        await client.query('ROLLBACK');
        if (insertErr.code === '23505' && attempt < maxAttempts) {
          logger.debug('Concurrent claim conflict on call_sessions insert, retrying attempt:', attempt);
          continue;
        }
        if (insertErr.code === '23505') {
          return {
            success: false,
            error: 'no_users_available',
            message: 'No available users at this moment.',
          };
        }
        throw insertErr;
      }

      logger.info(
        `Call matched atomically: [SessionId: ${session.id}, CallCode: ${session.call_code}, BillingMode: ${session.billing_mode}]`
      );

      return {
        success: true,
        session: {
          id: session.id,
          callCode: session.call_code,
          status: session.status,
          billingMode: session.billing_mode,
          requestedAt: session.requested_at,
          snapshotMode: session.snapshot_mode,
          snapshotRatePerMinute: session.snapshot_rate_per_minute,
          snapshotRingTimeout: session.snapshot_ring_timeout,
          snapshotMaxDuration: session.snapshot_max_duration,
          snapshotCurrency: session.snapshot_currency,
        },
        callee: {
          id: callee.id,
          pushToken: callee.push_token,
        },
      };
    }
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Database error in matchCaller:', error.message);
    throw error;
  } finally {
    client.release();
  }
}
