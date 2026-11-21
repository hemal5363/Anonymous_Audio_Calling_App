import { pool } from '../db/index.js';
import { getMonetizationSettings } from '../services/billing.service.js';

/**
 * 5.1 Get Wallet Balance & Details
 * GET /billing/wallet
 */
export async function getWallet(req, res, next) {
  try {
    const userId = req.user.id;
    const monetization = await getMonetizationSettings();

    // Fetch user wallet, provision default if not yet created
    let { rows } = await pool.query(
      `SELECT balance_amount, balance_minutes, free_trial_minutes, is_locked, currency 
       FROM wallets 
       WHERE user_id = $1;`,
      [userId]
    );

    let wallet;
    if (rows.length === 0) {
      const defaultTrial = monetization.free_trial_minutes_new_user || 10;
      const currency = monetization.currency || 'INR';
      const insertRes = await pool.query(
        `INSERT INTO wallets (user_id, balance_amount, balance_minutes, free_trial_minutes, currency)
         VALUES ($1, '0.00', 0, $2, $3)
         RETURNING balance_amount, balance_minutes, free_trial_minutes, is_locked, currency;`,
        [userId, defaultTrial, currency]
      );
      wallet = insertRes.rows[0];
    } else {
      wallet = rows[0];
    }

    return res.status(200).json({
      wallet: {
        balance_amount: String(wallet.balance_amount || '0.00'),
        balance_minutes: parseInt(wallet.balance_minutes || 0, 10),
        free_trial_minutes: parseInt(wallet.free_trial_minutes || 0, 10),
        is_locked: Boolean(wallet.is_locked),
        currency: wallet.currency || monetization.currency || 'INR',
      },
      current_mode: monetization.mode || 'free',
      rate_per_minute: String(monetization.per_minute_rate || '1.00'),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 5.3 Get Subscription Status & Available Plans
 * GET /billing/subscription
 */
export async function getSubscription(req, res, next) {
  try {
    const userId = req.user.id;
    const monetization = await getMonetizationSettings();

    // Query active subscription
    const subRes = await pool.query(
      `SELECT s.id, s.plan_id, p.name as plan_name, s.status, s.starts_at, s.ends_at, p.daily_minute_cap
       FROM subscriptions s
       JOIN plans p ON s.plan_id = p.id
       WHERE s.user_id = $1 
         AND s.status = 'active' 
         AND s.ends_at > CURRENT_TIMESTAMP
       ORDER BY s.ends_at DESC
       LIMIT 1;`,
      [userId]
    );

    let activeSubscription = null;
    if (subRes.rows.length > 0) {
      const sub = subRes.rows[0];

      // Calculate minutes used today
      const todayUsageRes = await pool.query(
        `SELECT COALESCE(SUM(duration_seconds), 0) as total_seconds
         FROM call_sessions
         WHERE caller_id = $1 
           AND created_at >= CURRENT_DATE 
           AND status = 'ended';`,
        [userId]
      );
      const totalSeconds = parseInt(todayUsageRes.rows[0]?.total_seconds || 0, 10);
      const minutesUsedToday = Math.floor(totalSeconds / 60);

      activeSubscription = {
        id: sub.id,
        plan_id: sub.plan_id,
        plan_name: sub.plan_name,
        status: sub.status,
        starts_at: sub.starts_at,
        ends_at: sub.ends_at,
        daily_minute_cap: sub.daily_minute_cap ? parseInt(sub.daily_minute_cap, 10) : null,
        minutes_used_today: minutesUsedToday,
      };
    }

    // Query available active plans
    const { rows: availablePlans } = await pool.query(
      `SELECT id, name, description, price::text, currency, duration_days, daily_minute_cap
       FROM plans
       WHERE is_active = TRUE
       ORDER BY price ASC;`
    );

    return res.status(200).json({
      current_mode: monetization.mode || 'free',
      active_subscription: activeSubscription,
      available_plans: availablePlans.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        price: String(p.price),
        currency: p.currency,
        duration_days: parseInt(p.duration_days, 10),
        daily_minute_cap: p.daily_minute_cap ? parseInt(p.daily_minute_cap, 10) : null,
      })),
    });
  } catch (err) {
    next(err);
  }
}
