import { pool } from '../db/index.js';
import { logger } from '../utils/logger.js';

/**
 * Service to enforce pre-call billing authorization based on active app_settings.
 * The callee is never charged.
 */
export async function checkCallerBillingStanding(clientOrPool, callerId) {
  const db = clientOrPool || pool;

  // 1. Fetch current monetization mode and rates
  const settingsRes = await db.query(
    "SELECT value_json FROM app_settings WHERE key = 'monetization';"
  );

  const monetization = settingsRes.rows[0]?.value_json || {
    mode: 'free',
    per_minute_rate: 1.0,
    currency: 'INR',
    free_daily_minute_cap: null,
  };

  const mode = monetization.mode || 'free';

  // -------------------------------------------------------------------------
  // Mode 1: Free Mode
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
  // Mode 2: Subscription Mode
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
        logger.info(`Caller ${callerId} rejected: subscription daily cap reached (${usedMinutes}/${sub.daily_minute_cap} mins)`);
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
  // Mode 3: Per-Minute Mode
  // -------------------------------------------------------------------------
  if (mode === 'per_minute') {
    const walletRes = await db.query(
      `SELECT balance_amount, balance_minutes, free_trial_minutes, is_locked
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
    const balanceAmount = Number(wallet.balance_amount || 0.0);

    if (balanceAmount >= rate) {
      return { allowed: true, mode };
    }

    logger.info(`Caller ${callerId} rejected: insufficient balance (${balanceAmount} < rate ${rate})`);
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
