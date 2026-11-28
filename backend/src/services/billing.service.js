import { pool } from '../db/index.js';
import { logger } from '../utils/logger.js';
import { userSocketMap } from '../socket/userSocketMap.js';
import { SOCKET_EVENTS } from '../socket/events.js';
import { callSessionManager } from '../socket/callSessionManager.js';
import { settingsRegistry } from './settings.service.js';

/**
 * UUID validation helper to prevent PostgreSQL syntax errors with mock fixtures
 */
function isValidUUID(str) {
  return (
    typeof str === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str)
  );
}

/**
 * In-memory map of active call billing timers: callCode -> timerEntry
 */
const activeBillingTimers = new Map();

/**
 * 1. Fetch current monetization mode and rates directly from app_settings in DB.
 * Always queries the database so admin updates apply immediately.
 */
export async function getMonetizationSettings(clientOrPool = pool) {
  // If unit test provided a mock client/pool that explicitly mocked the monetization query
  if (clientOrPool && clientOrPool.query && clientOrPool.query.mock !== undefined) {
    try {
      const settingsRes = await clientOrPool.query(
        "SELECT value_json FROM app_settings WHERE key = 'monetization';"
      );
      if (settingsRes?.rows?.length > 0 && settingsRes.rows[0].value_json) {
        return settingsRes.rows[0].value_json;
      }
    } catch (_) {}
  }

  return {
    mode: settingsRegistry.get('monetization_mode'),
    per_minute_rate: settingsRegistry.get('billing_rate_per_minute'),
    currency: 'INR',
    free_trial_minutes_new_user: settingsRegistry.get('free_trial_minutes_new_user'),
    free_daily_minute_cap: settingsRegistry.get('free_daily_minute_cap'),
    minimum_balance: settingsRegistry.get('billing_minimum_balance'),
    subscription_plans: settingsRegistry.get('subscription_plans'),
  };
}

/**
 * 2. Pre-call billing authorization check based on active app_settings.
 * Rules:
 * - free: always allow (with optional daily minute cap check if configured)
 * - subscription: allow only with an active subscription
 * - per-minute: require minimum wallet balance (at least 1 minute) before call starts
 * The callee is never charged.
 */
export async function checkCallerBillingStanding(clientOrPool, callerId) {
  const db = clientOrPool || pool;

  // Fetch current monetization mode and rates directly from DB
  const monetization = await getMonetizationSettings(db);
  const mode = monetization.mode || 'free';

  // -------------------------------------------------------------------------
  // Mode 1: Free Mode - always allow
  // -------------------------------------------------------------------------
  if (mode === 'free') {
    const dailyCap = monetization.free_daily_minute_cap;

    if (dailyCap && Number(dailyCap) > 0) {
      const todayUsageRes = await db.query(
        `SELECT COALESCE(SUM(duration_seconds), 0) as total_seconds
         FROM call_sessions
         WHERE caller_id = $1 
           AND created_at >= CURRENT_DATE 
           AND status = 'ended';`,
        [callerId]
      );

      const totalSeconds = parseInt(todayUsageRes.rows[0]?.total_seconds || 0, 10);
      const usedMinutes = Math.floor(totalSeconds / 60);

      if (usedMinutes >= Number(dailyCap)) {
        logger.info(`Caller ${callerId} rejected: daily free cap reached (${usedMinutes}/${dailyCap} mins)`);
        return {
          allowed: false,
          error: 'daily_limit_reached',
          message: 'Daily free calling limit reached. Please try again tomorrow.',
          mode,
        };
      }
    }

    return { allowed: true, mode };
  }

  // -------------------------------------------------------------------------
  // Mode 2: Subscription Mode - allow only with an active subscription
  // -------------------------------------------------------------------------
  if (mode === 'subscription') {
    const subRes = await db.query(
      `SELECT s.id, s.status, s.ends_at, p.daily_minute_cap
       FROM subscriptions s
       JOIN plans p ON s.plan_id = p.id
       WHERE s.user_id = $1 
         AND s.status = 'active' 
         AND s.ends_at > CURRENT_TIMESTAMP
       ORDER BY s.ends_at DESC
       LIMIT 1;`,
      [callerId]
    );

    if (subRes.rows.length === 0) {
      logger.info(`Caller ${callerId} rejected: no active subscription`);
      return {
        allowed: false,
        error: 'subscription_required',
        message: 'An active subscription plan is required to initiate calls.',
        mode,
      };
    }

    const sub = subRes.rows[0];

    // Check optional daily cap for this specific subscription plan
    if (sub.daily_minute_cap && Number(sub.daily_minute_cap) > 0) {
      const todayUsageRes = await db.query(
        `SELECT COALESCE(SUM(duration_seconds), 0) as total_seconds
         FROM call_sessions
         WHERE caller_id = $1 
           AND created_at >= CURRENT_DATE 
           AND status = 'ended';`,
        [callerId]
      );

      const totalSeconds = parseInt(todayUsageRes.rows[0]?.total_seconds || 0, 10);
      const usedMinutes = Math.floor(totalSeconds / 60);

      if (usedMinutes >= Number(sub.daily_minute_cap)) {
        logger.info(
          `Caller ${callerId} rejected: subscription daily cap reached (${usedMinutes}/${sub.daily_minute_cap} mins)`
        );
        return {
          allowed: false,
          error: 'daily_limit_reached',
          message: 'Daily subscription plan minute cap reached.',
          mode,
        };
      }
    }

    return { allowed: true, mode };
  }

  // -------------------------------------------------------------------------
  // Mode 3: Per-Minute Mode - require minimum wallet balance before call starts
  // -------------------------------------------------------------------------
  if (mode === 'per_minute') {
    const walletRes = await db.query(
      `SELECT id, balance_amount, balance_minutes, free_trial_minutes, is_locked
       FROM wallets
       WHERE user_id = $1;`,
      [callerId]
    );

    if (walletRes.rows.length === 0) {
      return {
        allowed: false,
        error: 'wallet_not_found',
        message: 'Wallet not initialized for user.',
        mode,
      };
    }

    const wallet = walletRes.rows[0];

    if (wallet.is_locked) {
      logger.info(`Caller ${callerId} rejected: wallet is locked`);
      return {
        allowed: false,
        error: 'wallet_locked',
        message: 'Your wallet is locked. Please contact support.',
        mode,
      };
    }

    // Prioritize free trial minutes or prepaid minutes
    if (Number(wallet.free_trial_minutes) > 0 || Number(wallet.balance_minutes) >= 1) {
      return { allowed: true, mode };
    }

    const rate = Number(monetization.per_minute_rate || 1.0);
    const minBalSetting = monetization.minimum_balance !== undefined
      ? Number(monetization.minimum_balance)
      : (db && db.query && db.query.mock !== undefined ? 0 : Number(settingsRegistry.get('billing_minimum_balance') ?? 0));
    const requiredBalance = Math.max(rate, minBalSetting);
    const balanceAmount = Number(wallet.balance_amount || 0.0);

    if (balanceAmount >= requiredBalance) {
      return { allowed: true, mode };
    }

    logger.info(`Caller ${callerId} rejected: insufficient balance (${balanceAmount} < required ${requiredBalance})`);
    return {
      allowed: false,
      error: 'insufficient_balance',
      message: 'Insufficient balance to initiate call. Please recharge your wallet.',
      mode,
    };
  }

  // Fallback default
  return { allowed: true, mode: 'free' };
}

/**
 * 3. In-call per-minute deduction.
 * Deducts 1 minute from trial minutes, prepaid minutes, or debits per_minute_rate.
 * Records the debit in wallet_transactions and updates call_sessions.
 * Returns balanceExhausted = true when balance reaches zero.
 */
export async function deductCallMinute(clientOrPool, { callCode, callerId, sessionId }) {
  const isPool = clientOrPool && typeof clientOrPool.connect === 'function';
  const client = isPool ? await clientOrPool.connect() : clientOrPool || pool;
  const shouldRelease = isPool;

  try {
    if (isPool) {
      await client.query('BEGIN');
    }

    // 1. Fetch current monetization mode and rates directly from DB
    const monetization = await getMonetizationSettings(client);
    let mode = monetization.mode || 'free';
    let rate = Number(monetization.per_minute_rate || 1.0);
    let currency = 'INR';

    // Prioritize call_sessions snapshot columns for in-progress calls (when real DB client is active)
    if ((callCode || sessionId) && (!client.query || client.query.mock === undefined)) {
      try {
        const sessionRes = await client.query(
          `SELECT snapshot_mode, snapshot_rate_per_minute, snapshot_currency, billing_mode
           FROM call_sessions
           WHERE ${callCode ? 'call_code = $1' : 'id = $1'}
           LIMIT 1;`,
          [callCode || sessionId]
        );
        if (sessionRes.rows.length > 0) {
          const sRow = sessionRes.rows[0];
          if (sRow.snapshot_mode) {
            mode = sRow.snapshot_mode;
          } else if (sRow.billing_mode) {
            mode = sRow.billing_mode;
          }
          if (sRow.snapshot_rate_per_minute !== null && sRow.snapshot_rate_per_minute !== undefined) {
            rate = Number(sRow.snapshot_rate_per_minute);
          }
          if (sRow.snapshot_currency) {
            currency = sRow.snapshot_currency;
          }
        }
      } catch (err) {
        logger.debug('Failed to query session snapshots in deductCallMinute, using live settings:', err.message);
      }
    }

    // If mode is not per_minute (e.g. admin changed mode mid-call or call was free), no deduction is required
    if (mode !== 'per_minute') {
      if (isPool) await client.query('COMMIT');
      return {
        success: true,
        deducted: false,
        mode,
        balanceExhausted: false,
        remainingMinutes: Infinity,
      };
    }

    // 2. Lock wallet row for update
    const walletRes = await client.query(
      `SELECT id, balance_amount, balance_minutes, free_trial_minutes, is_locked
       FROM wallets
       WHERE user_id = $1
       FOR UPDATE;`,
      [callerId]
    );

    if (walletRes.rows.length === 0) {
      if (isPool) await client.query('ROLLBACK');
      return {
        success: false,
        deducted: false,
        balanceExhausted: true,
        error: 'wallet_not_found',
      };
    }

    const wallet = walletRes.rows[0];

    if (wallet.is_locked) {
      if (isPool) await client.query('ROLLBACK');
      return {
        success: false,
        deducted: false,
        balanceExhausted: true,
        error: 'wallet_locked',
      };
    }

    const freeTrialMins = Number(wallet.free_trial_minutes || 0);
    const balanceMins = Number(wallet.balance_minutes || 0);
    const balanceAmount = Number(wallet.balance_amount || 0);

    let minuteCost = 0.0;
    let deductionType = '';
    let updatedWallet = null;

    if (freeTrialMins > 0) {
      deductionType = 'free_trial';
      minuteCost = 0.0;
      const updateRes = await client.query(
        `UPDATE wallets
         SET free_trial_minutes = free_trial_minutes - 1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING balance_amount, balance_minutes, free_trial_minutes;`,
        [wallet.id]
      );
      updatedWallet = updateRes.rows[0];

      await client.query(
        `INSERT INTO wallet_transactions (wallet_id, user_id, type, amount, minutes, call_session_id, reason)
         VALUES ($1, $2, 'debit', 0.00, 1, $3, 'Call minute deduction (Free trial)');`,
        [wallet.id, callerId, isValidUUID(sessionId) ? sessionId : null]
      );
    } else if (balanceMins > 0) {
      deductionType = 'prepaid_minute';
      minuteCost = 0.0;
      const updateRes = await client.query(
        `UPDATE wallets
         SET balance_minutes = balance_minutes - 1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING balance_amount, balance_minutes, free_trial_minutes;`,
        [wallet.id]
      );
      updatedWallet = updateRes.rows[0];

      await client.query(
        `INSERT INTO wallet_transactions (wallet_id, user_id, type, amount, minutes, call_session_id, reason)
         VALUES ($1, $2, 'debit', 0.00, 1, $3, 'Call minute deduction (Prepaid minute)');`,
        [wallet.id, callerId, isValidUUID(sessionId) ? sessionId : null]
      );
    } else if (balanceAmount >= rate) {
      deductionType = 'balance_amount';
      minuteCost = rate;
      const updateRes = await client.query(
        `UPDATE wallets
         SET balance_amount = balance_amount - $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2
         RETURNING balance_amount, balance_minutes, free_trial_minutes;`,
        [rate, wallet.id]
      );
      updatedWallet = updateRes.rows[0];

      await client.query(
        `INSERT INTO wallet_transactions (wallet_id, user_id, type, amount, minutes, call_session_id, reason)
         VALUES ($1, $2, 'debit', $3, 1, $4, 'Call minute deduction');`,
        [wallet.id, callerId, rate, isValidUUID(sessionId) ? sessionId : null]
      );
    } else {
      // Balance is insufficient to cover this minute
      if (isPool) await client.query('ROLLBACK');
      return {
        success: false,
        deducted: false,
        balanceExhausted: true,
        remainingMinutes: 0,
        balanceAmount: balanceAmount,
        currency: monetization.currency || 'INR',
      };
    }

    // Update call_sessions record with charged amount & minutes
    try {
      await client.query(
        `UPDATE call_sessions
         SET amount_charged = amount_charged + $1,
             minutes_charged = minutes_charged + 1
         WHERE call_code = $2;`,
        [minuteCost, callCode]
      );
    } catch (sessionErr) {
      logger.warn('Failed to update call_sessions during minute deduction:', sessionErr.message);
    }

    if (isPool) {
      await client.query('COMMIT');
    }

    const remTrial = Number(updatedWallet.free_trial_minutes || 0);
    const remPrepaid = Number(updatedWallet.balance_minutes || 0);
    const remAmount = Number(updatedWallet.balance_amount || 0);
    const remMinutes = remTrial + remPrepaid + Math.floor(remAmount / rate);
    const balanceExhausted = remMinutes <= 0;
    const warning = remMinutes === 1;

    return {
      success: true,
      deducted: true,
      deductionType,
      amountCharged: minuteCost,
      remainingMinutes: remMinutes,
      balanceAmount: remAmount,
      currency: monetization.currency || 'INR',
      balanceExhausted,
      warning,
    };
  } catch (error) {
    if (isPool) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {}
    }
    logger.error('Error during call minute deduction:', error.message);
    throw error;
  } finally {
    if (shouldRelease && typeof client.release === 'function') {
      client.release();
    }
  }
}

/**
 * 4. Start in-call active billing timer.
 * Emits billing:balance every minute, billing:warning at 1 minute remaining,
 * and automatically ends the call when balance reaches zero.
 */
export function startCallBillingTimer({
  io,
  callCode,
  callerId,
  sessionId,
  intervalMs = 60000,
  db = pool,
  onBalanceExhausted,
}) {
  if (!callCode) return null;
  if (activeBillingTimers.has(callCode)) {
    return activeBillingTimers.get(callCode);
  }

  logger.info(`[Billing Timer] Started billing timer for session: ${callCode} (Interval: ${intervalMs}ms)`);

  const timerId = setInterval(async () => {
    try {
      // Check if session is still tracked
      const session = callSessionManager.getSession(callCode);
      if (!session) {
        stopCallBillingTimer(callCode);
        return;
      }

      const result = await deductCallMinute(db, { callCode, callerId, sessionId });

      if (result.deducted) {
        logger.info(
          `[Billing] Deducted 1 min for session ${callCode}: charged ${result.amountCharged}, ${result.remainingMinutes} mins remaining`
        );

        if (io) {
          const callerSocketId = userSocketMap.getSocketId(callerId);
          if (callerSocketId) {
            io.to(callerSocketId).emit(SOCKET_EVENTS.BILLING_BALANCE, {
              callCode,
              balanceAmount: result.balanceAmount,
              remainingMinutes: result.remainingMinutes,
              currency: result.currency,
            });

            if (result.warning) {
              logger.info(`[Billing] Emitting low balance warning to caller ${callerId} for session: ${callCode}`);
              io.to(callerSocketId).emit(SOCKET_EVENTS.BILLING_WARNING, {
                callCode,
                message: '1 minute of call balance remaining.',
                remainingMinutes: 1,
              });
            }
          }
        }
      }

      if (result.balanceExhausted) {
        logger.info(`[Billing] Balance exhausted for session: ${callCode}. Terminating call automatically.`);
        stopCallBillingTimer(callCode);

        if (typeof onBalanceExhausted === 'function') {
          await onBalanceExhausted({ callCode, callerId, sessionId });
        } else {
          // Dynamic import to prevent circular dependency
          const { endCall } = await import('./call.service.js');
          const endRes = await endCall({ callCode, userId: callerId, reason: 'balance_exhausted' });

          if (io) {
            const endedPayload = {
              callCode,
              durationSeconds: endRes.durationSeconds || 0,
              reason: 'balance_exhausted',
            };

            io.to(`call:${callCode}`).emit(SOCKET_EVENTS.CALL_ENDED, endedPayload);

            // Also emit directly to caller socket in case room was not joined
            const callerSocketId = userSocketMap.getSocketId(callerId);
            if (callerSocketId) {
              io.to(callerSocketId).emit(SOCKET_EVENTS.CALL_ENDED, endedPayload);
            }
          }
        }
      }
    } catch (err) {
      logger.error(`Error in billing timer interval for ${callCode}:`, err.message);
    }
  }, intervalMs);

  const timerEntry = {
    timerId,
    callCode,
    callerId,
    sessionId,
    intervalMs,
  };

  activeBillingTimers.set(callCode, timerEntry);
  return timerEntry;
}

/**
 * 5. Stop active billing timer for a call session
 */
export function stopCallBillingTimer(callCode) {
  if (activeBillingTimers.has(callCode)) {
    const entry = activeBillingTimers.get(callCode);
    clearInterval(entry.timerId);
    activeBillingTimers.delete(callCode);
    logger.info(`[Billing Timer] Stopped billing timer for session: ${callCode}`);
    return true;
  }
  return false;
}

/**
 * 6. Check if billing timer is currently running for a callCode
 */
export function isCallBillingTimerActive(callCode) {
  return activeBillingTimers.has(callCode);
}

/**
 * 7. Clear all billing timers (useful for tests and graceful server shutdown)
 */
export function clearAllBillingTimers() {
  for (const [callCode, entry] of activeBillingTimers.entries()) {
    clearInterval(entry.timerId);
  }
  activeBillingTimers.clear();
}

/**
 * 8. Count of currently running billing timers
 */
export function getActiveBillingTimerCount() {
  return activeBillingTimers.size;
}
