import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import { pool } from './index.js';
import { logger } from '../utils/logger.js';

dotenv.config();

async function runSeed() {
  logger.info('Starting database seeding...');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Read Admin credentials from .env
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com';
    const adminPassword = process.env.ADMIN_PASSWORD || 'AdminPassword123!';

    logger.info(`Seeding admin user for email: ${adminEmail}`);

    // Hash the password with bcrypt (10 rounds)
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(adminPassword, saltRounds);

    const { rows: adminRows } = await client.query(
      `
      INSERT INTO admin_users (email, password_hash, role, is_active)
      VALUES ($1, $2, 'superadmin', TRUE)
      ON CONFLICT (email)
      DO UPDATE SET 
        password_hash = EXCLUDED.password_hash,
        is_active = TRUE,
        updated_at = CURRENT_TIMESTAMP
      RETURNING id, email, role;
      `,
      [adminEmail, passwordHash]
    );

    const adminUser = adminRows[0];
    logger.info(`Admin user created/updated [ID: ${adminUser.id}, Email: ${adminUser.email}, Role: ${adminUser.role}]`);

    // 2. Insert or update default app_settings
    logger.info('Seeding default app_settings (monetization=free, mobile_login=disabled)...');

    const defaultSettings = [
      {
        key: 'monetization',
        value: {
          mode: 'free',
          per_minute_rate: 1.00,
          currency: 'INR',
          free_trial_minutes_new_user: 10,
          free_daily_minute_cap: 30,
        },
        description: 'Active monetization mode (free, subscription, or per_minute) and pricing parameters',
      },
      {
        key: 'auth_settings',
        value: {
          email_login_enabled: true,
          mobile_login_enabled: false,
          otp_expiry_seconds: 300,
          max_otp_attempts: 3,
        },
        description: 'Controls allowed authentication methods and mobile login toggle',
      },
      {
        key: 'matching_settings',
        value: {
          ring_timeout_seconds: 30,
          max_match_attempts: 3,
          cooldown_same_peer_seconds: 1800,
          try_live_presence_first: true,
        },
        description: 'Matching engine thresholds and retry limits',
      },
      {
        key: 'moderation_settings',
        value: {
          auto_suspend_report_threshold: 3,
          auto_suspend_window_hours: 24,
          suspension_duration_hours: 48,
        },
        description: 'Automated safety and moderation enforcement rules',
      },
    ];

    for (const setting of defaultSettings) {
      await client.query(
        `
        INSERT INTO app_settings (key, value_json, description, updated_by)
        VALUES ($1, $2::jsonb, $3, $4)
        ON CONFLICT (key)
        DO UPDATE SET 
          value_json = EXCLUDED.value_json,
          description = EXCLUDED.description,
          updated_by = EXCLUDED.updated_by,
          updated_at = CURRENT_TIMESTAMP;
        `,
        [setting.key, JSON.stringify(setting.value), setting.description, adminUser.id]
      );
      logger.info(`Setting '${setting.key}' seeded successfully.`);
    }

    // 3. Seed default plans (if plans table is empty)
    await client.query(
      `
      INSERT INTO plans (name, description, price, currency, duration_days, daily_minute_cap, is_active)
      VALUES
        ('Starter Free Plan', 'Basic free tier with daily minute allowance', 0.00, 'INR', 30, 15, TRUE),
        ('Unlimited Monthly', 'Unlimited anonymous audio calling for 30 days', 99.00, 'INR', 30, NULL, TRUE)
      ON CONFLICT DO NOTHING;
      `
    );
    logger.info('Default subscription plans seeded.');

    await client.query('COMMIT');
    logger.info('Seeding completed successfully!');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Seeding failed:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

runSeed()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    logger.error('Seed process terminated with error:', err);
    process.exit(1);
  });
