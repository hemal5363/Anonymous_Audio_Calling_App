import { z } from 'zod';
import { pool } from '../db/index.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

export const planItemSchema = z.object({
  id: z.union([z.string(), z.number()]).transform((v) => String(v)),
  name: z.string().min(1, 'Plan name is required').max(100),
  price: z.coerce.number().min(0, 'Plan price must be non-negative'),
  duration_days: z.coerce.number().int().min(1, 'Duration must be at least 1 day'),
  active: z.boolean().default(true),
  daily_minute_cap: z.coerce.number().int().nullable().optional(),
});

export const SETTINGS_REGISTRY = {
  // 1. System
  maintenance_mode_enabled: {
    group: 'system',
    label: 'Maintenance Mode',
    help: 'When enabled, halts new logins, registrations, and matching while exempting admins.',
    type: 'boolean',
    default: false,
    public: true,
    timing: 'instant',
    schema: z.boolean(),
  },
  maintenance_mode_message: {
    group: 'system',
    label: 'Maintenance Banner Message',
    help: 'User-facing banner displayed on mobile screens during maintenance.',
    type: 'string',
    min: 1,
    max: 500,
    default: 'Platform is undergoing scheduled maintenance. Please check back shortly.',
    public: true,
    timing: 'instant',
    schema: z.string().min(1).max(500),
  },
  min_supported_mobile_version: {
    group: 'system',
    label: 'Minimum Supported Mobile Version',
    help: 'Enforces mandatory app update for clients below this SemVer (e.g. 1.0.0).',
    type: 'string',
    default: '1.0.0',
    public: true,
    timing: 'instant',
    schema: z.string().regex(/^\d+\.\d+\.\d+$/, 'Version must follow SemVer format (e.g. 1.0.0)'),
  },
  force_update_store_url_android: {
    group: 'system',
    label: 'Android Store Update URL',
    help: 'Direct Play Store or market link opened when user taps Update Now.',
    type: 'string',
    default: 'https://play.google.com/store/apps/details?id=com.hemal.anonaudiocall',
    public: true,
    timing: 'instant',
    schema: z
      .string()
      .refine(
        (url) => url.startsWith('https://') || url.startsWith('market://'),
        'URL must start with https:// or market://'
      ),
  },

  // 2. Auth & OTP
  user_registration_enabled: {
    group: 'auth',
    label: 'User Registration Enabled',
    help: 'Controls whether new users are allowed to create accounts.',
    type: 'boolean',
    default: true,
    public: true,
    timing: 'instant',
    schema: z.boolean(),
  },
  email_login_enabled: {
    group: 'auth',
    label: 'Email & Password Login',
    help: 'Allow existing users to authenticate via email and password.',
    type: 'boolean',
    default: true,
    public: true,
    timing: 'instant',
    schema: z.boolean(),
  },
  mobile_login_enabled: {
    group: 'auth',
    label: 'Mobile Phone (SMS OTP) Login',
    help: 'Allow users to authenticate via SMS one-time passcode. Requires configured SMS provider in production.',
    type: 'boolean',
    default: false,
    public: true,
    timing: 'instant',
    schema: z.boolean(),
  },
  user_password_min_length: {
    group: 'auth',
    label: 'Minimum Password Length',
    help: 'Minimum character length required for user account passwords.',
    type: 'integer',
    min: 8,
    max: 64,
    default: 8,
    unit: 'chars',
    public: true,
    timing: 'instant',
    schema: z.coerce.number().int().min(8).max(64),
  },
  otp_expiry_seconds: {
    group: 'auth',
    label: 'OTP Validity Lifetime',
    help: 'Duration in seconds before an issued SMS verification code expires.',
    type: 'integer',
    min: 60,
    max: 900,
    default: 300,
    unit: 'seconds',
    public: true,
    timing: 'instant',
    schema: z.coerce.number().int().min(60).max(900),
  },
  otp_max_verify_attempts: {
    group: 'auth',
    label: 'Maximum OTP Verification Attempts',
    help: 'Maximum incorrect verification guesses permitted before an OTP is invalidated.',
    type: 'integer',
    min: 1,
    max: 10,
    default: 3,
    unit: 'attempts',
    public: false,
    timing: 'instant',
    schema: z.coerce.number().int().min(1).max(10),
  },
  otp_resend_cooldown_seconds: {
    group: 'auth',
    label: 'OTP Resend Cooldown',
    help: 'Minimum wait time before a user can request another SMS verification code.',
    type: 'integer',
    min: 15,
    max: 300,
    default: 60,
    unit: 'seconds',
    public: true,
    timing: 'instant',
    schema: z.coerce.number().int().min(15).max(300),
  },

  // 3. Matching & Calls
  cooldown_same_peer_seconds: {
    group: 'matching',
    label: 'Same-Peer Rematch Cooldown',
    help: 'Duration in seconds preventing the same two users from being paired again. 0 allows immediate rematch.',
    type: 'integer',
    min: 0,
    max: 86400,
    default: 60,
    unit: 'seconds',
    public: false,
    timing: 'instant',
    schema: z.coerce.number().int().min(0).max(86400),
  },
  max_match_attempts: {
    group: 'matching',
    label: 'Maximum Match Attempts',
    help: 'Number of pairing retries before returning no_users_available.',
    type: 'integer',
    min: 1,
    max: 10,
    default: 3,
    unit: 'attempts',
    public: false,
    timing: 'new_calls',
    schema: z.coerce.number().int().min(1).max(10),
  },
  try_live_presence_first: {
    group: 'matching',
    label: 'Prioritize Active Socket Presence',
    help: 'Attempts matching online connected users first before falling back to push notification matching.',
    type: 'boolean',
    default: true,
    public: false,
    timing: 'instant',
    schema: z.boolean(),
  },
  ring_timeout_seconds: {
    group: 'matching',
    label: 'Incoming Ring Timeout',
    help: 'Duration an incoming call rings the callee before expiring as missed.',
    type: 'integer',
    min: 10,
    max: 120,
    default: 30,
    unit: 'seconds',
    public: true,
    timing: 'new_calls',
    schema: z.coerce.number().int().min(10).max(120),
  },
  network_disconnect_grace_period_seconds: {
    group: 'matching',
    label: 'Socket Disconnect Grace Period',
    help: 'Grace window allowed when mobile socket drops mid-call before terminating media session.',
    type: 'integer',
    min: 2,
    max: 30,
    default: 5,
    unit: 'seconds',
    public: true,
    timing: 'new_calls',
    schema: z.coerce.number().int().min(2).max(30),
  },
  max_call_duration_seconds: {
    group: 'matching',
    label: 'Maximum Call Duration',
    help: 'Hard duration cap in seconds for any single call session before server auto-terminates.',
    type: 'integer',
    min: 300,
    max: 86400,
    default: 3600,
    unit: 'seconds',
    public: true,
    timing: 'new_calls',
    schema: z.coerce.number().int().min(300).max(86400),
  },

  // 4. Billing
  monetization_mode: {
    group: 'billing',
    label: 'Platform Monetization Mode',
    help: 'Active commercial model: free, subscription, or per_minute metering.',
    type: 'enum',
    default: 'free',
    public: true,
    timing: 'instant',
    schema: z.enum(['free', 'subscription', 'per_minute']),
  },
  billing_rate_per_minute: {
    group: 'billing',
    label: 'Per-Minute Rate',
    help: 'Amount debited per minute of active call time in per_minute billing mode.',
    type: 'float',
    min: 0.01,
    max: 1000.0,
    default: 1.0,
    unit: 'INR/min',
    public: true,
    timing: 'new_calls',
    schema: z.coerce.number().min(0.01).max(1000.0),
  },
  billing_minimum_balance: {
    group: 'billing',
    label: 'Minimum Dialing Balance',
    help: 'Minimum wallet balance required to initiate an outgoing call in per-minute mode.',
    type: 'float',
    min: 0.0,
    max: 500.0,
    default: 5.0,
    unit: 'INR',
    public: true,
    timing: 'instant',
    schema: z.coerce.number().min(0.0).max(500.0),
  },
  free_trial_minutes_new_user: {
    group: 'billing',
    label: 'New User Free Trial Minutes',
    help: 'Free call minutes credited to newly registered user accounts upon creation.',
    type: 'integer',
    min: 0,
    max: 600,
    default: 10,
    unit: 'minutes',
    public: true,
    timing: 'instant',
    schema: z.coerce.number().int().min(0).max(600),
  },
  free_daily_minute_cap: {
    group: 'billing',
    label: 'Free Daily Minute Cap',
    help: 'Maximum daily call minutes permitted per user in free mode. 0 means unlimited.',
    type: 'integer',
    min: 0,
    max: 1440,
    default: 30,
    unit: 'minutes',
    public: true,
    timing: 'instant',
    schema: z.coerce.number().int().min(0).max(1440),
  },
  subscription_plans: {
    group: 'billing',
    label: 'Subscription Plans Catalog',
    help: 'Available tiered packages presented to users in subscription mode.',
    type: 'array',
    default: [
      { id: '1', name: 'Starter Pass', price: 49.0, duration_days: 30, active: true },
      { id: '2', name: 'Unlimited Monthly', price: 99.0, duration_days: 30, active: true },
    ],
    public: true,
    timing: 'instant',
    schema: z.array(planItemSchema).min(1, 'At least one subscription plan is required'),
  },

  // 5. Moderation
  auto_flag_report_threshold: {
    group: 'moderation',
    label: 'Auto-Flag Report Threshold',
    help: 'Distinct user reports required before an account is auto-flagged for moderator audit.',
    type: 'integer',
    min: 1,
    max: 20,
    default: 3,
    unit: 'reports',
    public: false,
    timing: 'instant',
    schema: z.coerce.number().int().min(1).max(20),
  },
  auto_suspend_report_threshold: {
    group: 'moderation',
    label: 'Auto-Suspend Report Threshold',
    help: 'Reports required within window before account is automatically suspended.',
    type: 'integer',
    min: 1,
    max: 50,
    default: 5,
    unit: 'reports',
    public: false,
    timing: 'instant',
    schema: z.coerce.number().int().min(1).max(50),
  },
  auto_suspend_window_hours: {
    group: 'moderation',
    label: 'Auto-Suspend Rolling Window',
    help: 'Rolling time window in hours for accumulating abuse reports toward auto-suspension.',
    type: 'integer',
    min: 1,
    max: 168,
    default: 24,
    unit: 'hours',
    public: false,
    timing: 'instant',
    schema: z.coerce.number().int().min(1).max(168),
  },
  auto_suspension_duration_hours: {
    group: 'moderation',
    label: 'Auto-Suspension Duration',
    help: 'Duration in hours an auto-suspended user remains blocked.',
    type: 'integer',
    min: 1,
    max: 720,
    default: 48,
    unit: 'hours',
    public: false,
    timing: 'instant',
    schema: z.coerce.number().int().min(1).max(720),
  },
  report_note_max_length: {
    group: 'moderation',
    label: 'Maximum Report Note Length',
    help: 'Maximum characters permitted in an abuse report explanation note.',
    type: 'integer',
    min: 100,
    max: 5000,
    default: 1000,
    unit: 'chars',
    public: true,
    timing: 'instant',
    schema: z.coerce.number().int().min(100).max(5000),
  },

  // 6. Limits (Traffic & Socket Abuse)
  rate_limit_global_max: {
    group: 'limits',
    label: 'Global REST Request Limit',
    help: 'Maximum HTTP requests permitted per IP per 15-minute window.',
    type: 'integer',
    min: 50,
    max: 5000,
    default: 300,
    unit: 'req/15m',
    public: false,
    timing: 'instant',
    schema: z.coerce.number().int().min(50).max(5000),
  },
  rate_limit_register_max: {
    group: 'limits',
    label: 'Registration Request Limit',
    help: 'Maximum registration attempts permitted per IP per 15-minute window.',
    type: 'integer',
    min: 1,
    max: 100,
    default: 10,
    unit: 'req/15m',
    public: false,
    timing: 'instant',
    schema: z.coerce.number().int().min(1).max(100),
  },
  rate_limit_login_ip_max: {
    group: 'limits',
    label: 'Login Request Limit (Per IP)',
    help: 'Maximum login attempts permitted per IP per 15-minute window.',
    type: 'integer',
    min: 5,
    max: 100,
    default: 10,
    unit: 'req/15m',
    public: false,
    timing: 'instant',
    schema: z.coerce.number().int().min(5).max(100),
  },
  rate_limit_login_account_max: {
    group: 'limits',
    label: 'Login Request Limit (Per Account)',
    help: 'Maximum login attempts permitted per email/phone target per 15-minute window.',
    type: 'integer',
    min: 3,
    max: 50,
    default: 5,
    unit: 'req/15m',
    public: false,
    timing: 'instant',
    schema: z.coerce.number().int().min(3).max(50),
  },
  rate_limit_otp_request_max: {
    group: 'limits',
    label: 'OTP Request Limit (Per IP)',
    help: 'Maximum OTP SMS dispatch requests permitted per IP per 15-minute window.',
    type: 'integer',
    min: 1,
    max: 50,
    default: 5,
    unit: 'req/15m',
    public: false,
    timing: 'instant',
    schema: z.coerce.number().int().min(1).max(50),
  },
  rate_limit_otp_request_phone_max: {
    group: 'limits',
    label: 'OTP Request Limit (Per Phone)',
    help: 'Maximum OTP SMS dispatches permitted per target phone number per 15-minute window.',
    type: 'integer',
    min: 1,
    max: 20,
    default: 3,
    unit: 'req/15m',
    public: false,
    timing: 'instant',
    schema: z.coerce.number().int().min(1).max(20),
  },
  socket_skip_cancel_threshold: {
    group: 'limits',
    label: 'Socket Skip/Cancel Threshold',
    help: 'Maximum rapid skips or search cancellations permitted before triggering penalty cooldown.',
    type: 'integer',
    min: 2,
    max: 20,
    default: 5,
    unit: 'actions',
    public: false,
    timing: 'instant',
    schema: z.coerce.number().int().min(2).max(20),
  },
  socket_skip_cancel_cooldown_ms: {
    group: 'limits',
    label: 'Socket Skip/Cancel Cooldown',
    help: 'Duration in milliseconds a user is blocked from matching after rapid skip/cancel abuse.',
    type: 'integer',
    min: 5000,
    max: 300000,
    default: 30000,
    unit: 'ms',
    public: false,
    timing: 'instant',
    schema: z.coerce.number().int().min(5000).max(300000),
  },
  socket_rate_limit_call_find_max: {
    group: 'limits',
    label: 'Socket call:find Rate Limit',
    help: 'Maximum matchmaking search requests permitted per user per 60-second window.',
    type: 'integer',
    min: 2,
    max: 60,
    default: 10,
    unit: 'req/min',
    public: false,
    timing: 'instant',
    schema: z.coerce.number().int().min(2).max(60),
  },
  socket_rate_limit_signal_max: {
    group: 'limits',
    label: 'Socket Signaling Rate Limit',
    help: 'Maximum WebRTC signaling packets permitted per user per 60-second window.',
    type: 'integer',
    min: 20,
    max: 300,
    default: 60,
    unit: 'req/min',
    public: false,
    timing: 'instant',
    schema: z.coerce.number().int().min(20).max(300),
  },
  socket_max_malformed_events: {
    group: 'limits',
    label: 'Socket Malformed Packet Cap',
    help: 'Maximum invalid or schema-violating socket payloads before connection is forcefully dropped.',
    type: 'integer',
    min: 1,
    max: 20,
    default: 5,
    unit: 'events',
    public: false,
    timing: 'instant',
    schema: z.coerce.number().int().min(1).max(20),
  },

  // 7. Retention
  availability_grace_period_minutes: {
    group: 'retention',
    label: 'User Inactivity Grace Period',
    help: 'Minutes of inactivity before idle available users are marked unavailable.',
    type: 'integer',
    min: 5,
    max: 1440,
    default: 60,
    unit: 'minutes',
    public: false,
    timing: 'instant',
    schema: z.coerce.number().int().min(5).max(1440),
  },
  call_history_retention_days: {
    group: 'retention',
    label: 'Call History Retention',
    help: 'Days completed call records are retained before automated deletion.',
    type: 'integer',
    min: 7,
    max: 730,
    default: 90,
    unit: 'days',
    public: false,
    timing: 'instant',
    schema: z.coerce.number().int().min(7).max(730),
  },

  // 8. Legal & Text
  privacy_policy_url: {
    group: 'legal',
    label: 'Privacy Policy URL',
    help: 'Direct HTTPS link to public privacy policy document.',
    type: 'string',
    default: 'https://anoncall-admin.duckdns.org/privacy.html',
    public: true,
    timing: 'instant',
    schema: z.string().url().startsWith('https://'),
  },
  terms_of_service_url: {
    group: 'legal',
    label: 'Terms of Service URL',
    help: 'Direct HTTPS link to public terms of service agreement.',
    type: 'string',
    default: 'https://anoncall-admin.duckdns.org/terms.html',
    public: true,
    timing: 'instant',
    schema: z.string().url().startsWith('https://'),
  },
  active_terms_version: {
    group: 'legal',
    label: 'Active Terms Version',
    help: 'Enforced legal terms version string (e.g. 1.0).',
    type: 'string',
    min: 1,
    max: 20,
    default: '1.0',
    public: true,
    timing: 'instant',
    schema: z.string().min(1).max(20),
  },
  active_privacy_version: {
    group: 'legal',
    label: 'Active Privacy Version',
    help: 'Enforced privacy policy version string (e.g. 1.0).',
    type: 'string',
    min: 1,
    max: 20,
    default: '1.0',
    public: true,
    timing: 'instant',
    schema: z.string().min(1).max(20),
  },
  push_notification_title: {
    group: 'legal',
    label: 'Push Notification Title',
    help: 'Title text on incoming call push notifications.',
    type: 'string',
    min: 1,
    max: 100,
    default: 'Incoming call',
    public: false,
    timing: 'instant',
    schema: z.string().min(1).max(100),
  },
  push_notification_body: {
    group: 'legal',
    label: 'Push Notification Body',
    help: 'Body copy on incoming call push notifications.',
    type: 'string',
    min: 1,
    max: 200,
    default: 'Someone wants to talk',
    public: false,
    timing: 'instant',
    schema: z.string().min(1).max(200),
  },
};

/**
 * Compare two SemVer strings numerically.
 * Returns:
 *   1 if v1 > v2
 *  -1 if v1 < v2
 *   0 if v1 === v2
 */
export function compareSemver(v1, v2) {
  if (!v1 || typeof v1 !== 'string') return -1;
  if (!v2 || typeof v2 !== 'string') return 1;
  const p1 = v1.split('.').map((n) => parseInt(n, 10) || 0);
  const p2 = v2.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
    const num1 = p1[i] || 0;
    const num2 = p2[i] || 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}

export class SettingsRegistryService {
  constructor() {
    this.cache = new Map();
    this.overriddenKeys = new Set();
    this.initialized = false;
  }

  /**
   * Initialize settings cache from code defaults and PostgreSQL overrides.
   * If database is unavailable, logs warning and runs with default values.
   */
  async init(customPool = pool) {
    // 1. Populate memory cache with code defaults
    for (const [key, meta] of Object.entries(SETTINGS_REGISTRY)) {
      this.cache.set(key, meta.default);
    }
    this.overriddenKeys.clear();

    // 2. Load database overrides
    try {
      const { rows } = await customPool.query('SELECT key, value_json FROM app_settings;');
      for (const row of rows) {
        if (SETTINGS_REGISTRY[row.key]) {
          const parsed = SETTINGS_REGISTRY[row.key].schema.safeParse(row.value_json);
          if (parsed.success) {
            this.cache.set(row.key, parsed.data);
            this.overriddenKeys.add(row.key);
          } else {
            logger.warn(`Invalid override in DB for setting ${row.key}, falling back to default`);
          }
        }
      }
      this.initialized = true;
      logger.info(`SettingsRegistry initialized with ${this.overriddenKeys.size} database override(s).`);
    } catch (err) {
      this.initialized = false;
      logger.warn('Failed to load settings overrides from database. Operating in Safe Default Mode:', err.message);
    }
  }

  /**
   * Synchronous, 0ms latency setting read from in-memory cache.
   */
  get(key) {
    const meta = SETTINGS_REGISTRY[key];
    if (!meta) {
      throw new Error(`Unknown setting key: '${key}'`);
    }
    return this.cache.has(key) ? this.cache.get(key) : meta.default;
  }

  hasOverride(key) {
    return this.overriddenKeys.has(key);
  }

  /**
   * Derived parameter: ring_timeout_seconds + 30
   */
  getDerivedStuckRingingCleanupSeconds() {
    return this.get('ring_timeout_seconds') + 30;
  }

  /**
   * Returns all settings with metadata for Admin UI consumption.
   */
  getAllSettingsForAdmin() {
    const result = [];
    for (const [key, meta] of Object.entries(SETTINGS_REGISTRY)) {
      result.push({
        key,
        group: meta.group,
        label: meta.label,
        help: meta.help,
        type: meta.type,
        min: meta.min ?? null,
        max: meta.max ?? null,
        default: meta.default,
        current_value: this.get(key),
        is_overridden: this.overriddenKeys.has(key),
        unit: meta.unit ?? null,
        public: meta.public,
        timing: meta.timing,
      });
    }
    return result;
  }

  /**
   * Returns public configuration for mobile clients.
   * Strips all private keys.
   */
  getPublicConfig() {
    return {
      maintenance: {
        enabled: this.get('maintenance_mode_enabled'),
        message: this.get('maintenance_mode_message'),
      },
      version_gating: {
        min_supported_version: this.get('min_supported_mobile_version'),
        force_update_url: this.get('force_update_store_url_android'),
      },
      auth: {
        registration_enabled: this.get('user_registration_enabled'),
        email_login_enabled: this.get('email_login_enabled'),
        mobile_login_enabled: this.get('mobile_login_enabled'),
        password_min_length: this.get('user_password_min_length'),
        otp_expiry_seconds: this.get('otp_expiry_seconds'),
        otp_resend_cooldown_seconds: this.get('otp_resend_cooldown_seconds'),
      },
      calls: {
        ring_timeout_seconds: this.get('ring_timeout_seconds'),
        disconnect_grace_period_seconds: this.get('network_disconnect_grace_period_seconds'),
        max_call_duration_seconds: this.get('max_call_duration_seconds'),
      },
      monetization: {
        mode: this.get('monetization_mode'),
        currency: 'INR',
        rate_per_minute: this.get('billing_rate_per_minute'),
        minimum_balance: this.get('billing_minimum_balance'),
        free_trial_minutes_new_user: this.get('free_trial_minutes_new_user'),
        free_daily_minute_cap: this.get('free_daily_minute_cap'),
        subscription_plans: this.get('subscription_plans'),
      },
      moderation: {
        report_note_max_length: this.get('report_note_max_length'),
      },
      legal: {
        privacy_policy_url: this.get('privacy_policy_url'),
        terms_of_service_url: this.get('terms_of_service_url'),
        active_terms_version: this.get('active_terms_version'),
        active_privacy_version: this.get('active_privacy_version'),
        min_registration_age: 18,
      },
    };
  }

  /**
   * Update setting value inside an atomic transaction.
   * Locks the row with SELECT ... FOR UPDATE.
   * Records old and new values in settings_audit.
   * Commits to in-memory cache ONLY on successful DB commit.
   */
  async update(key, value, { adminId, adminEmail = 'admin@example.com', ipAddress = '127.0.0.1', customPool = pool } = {}) {
    const meta = SETTINGS_REGISTRY[key];
    if (!meta) {
      const err = new Error(`Unknown setting key: '${key}'`);
      err.statusCode = 400;
      throw err;
    }

    // 1. Zod validation
    const validation = meta.schema.safeParse(value);
    if (!validation.success) {
      const err = new Error(validation.error.errors.map((e) => e.message).join(', '));
      err.statusCode = 400;
      throw err;
    }
    const parsedValue = validation.data;

    // 2. Cross-field & environment safety rules
    if (key === 'mobile_login_enabled' && parsedValue === true) {
      const isProd = (process.env.NODE_ENV || config.env) === 'production';
      if (isProd && !config.smsProviderConfigured) {
        const err = new Error('Cannot enable mobile login in production: No SMS provider configured.');
        err.statusCode = 400;
        throw err;
      }
    }

    // 3. Database transaction
    const isValidUuid = (val) =>
      typeof val === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
    const auditAdminId = isValidUuid(adminId) ? adminId : null;

    const client = await customPool.connect();
    try {
      await client.query('BEGIN');

      // Read current value with row-level locking
      const { rows: currentRows } = await client.query(
        'SELECT value_json FROM app_settings WHERE key = $1 FOR UPDATE;',
        [key]
      );
      const oldValue = currentRows.length > 0 ? currentRows[0].value_json : meta.default;

      // Upsert override row
      await client.query(
        `INSERT INTO app_settings (key, value_json, updated_by, updated_at)
         VALUES ($1, $2::jsonb, $3, CURRENT_TIMESTAMP)
         ON CONFLICT (key) DO UPDATE
         SET value_json = EXCLUDED.value_json,
             updated_by = EXCLUDED.updated_by,
             updated_at = CURRENT_TIMESTAMP;`,
        [key, JSON.stringify(parsedValue), auditAdminId]
      );

      // Record audit entry
      await client.query(
        `INSERT INTO settings_audit (admin_id, admin_email, key, old_value, new_value, ip_address)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6);`,
        [
          auditAdminId,
          adminEmail,
          key,
          JSON.stringify(oldValue),
          JSON.stringify(parsedValue),
          ipAddress,
        ]
      );

      await client.query('COMMIT');

      // 4. Update in-memory cache on commit
      this.cache.set(key, parsedValue);
      this.overriddenKeys.add(key);

      logger.info(`Setting '${key}' updated by ${adminEmail} from IP ${ipAddress}.`);
      return { key, value: parsedValue, is_overridden: true };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Reset setting to code default.
   * Deletes override from app_settings and records audit entry.
   */
  async reset(key, { adminId, adminEmail = 'admin@example.com', ipAddress = '127.0.0.1', customPool = pool } = {}) {
    const meta = SETTINGS_REGISTRY[key];
    if (!meta) {
      const err = new Error(`Unknown setting key: '${key}'`);
      err.statusCode = 400;
      throw err;
    }

    const isValidUuid = (val) =>
      typeof val === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
    const auditAdminId = isValidUuid(adminId) ? adminId : null;

    const client = await customPool.connect();
    try {
      await client.query('BEGIN');

      const { rows: currentRows } = await client.query(
        'SELECT value_json FROM app_settings WHERE key = $1 FOR UPDATE;',
        [key]
      );
      const oldValue = currentRows.length > 0 ? currentRows[0].value_json : meta.default;

      // Delete override row
      await client.query('DELETE FROM app_settings WHERE key = $1;', [key]);

      // Record audit entry
      await client.query(
        `INSERT INTO settings_audit (admin_id, admin_email, key, old_value, new_value, ip_address)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6);`,
        [
          auditAdminId,
          adminEmail,
          key,
          JSON.stringify(oldValue),
          JSON.stringify(meta.default),
          ipAddress,
        ]
      );

      await client.query('COMMIT');

      // Reset in-memory cache to default
      this.cache.set(key, meta.default);
      this.overriddenKeys.delete(key);

      logger.info(`Setting '${key}' reset to default by ${adminEmail}.`);
      return { key, value: meta.default, is_overridden: false };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

export const settingsRegistry = new SettingsRegistryService();
