import bcrypt from 'bcrypt';
import { z } from 'zod';
import { pool } from '../db/index.js';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  hashToken,
} from '../utils/token.js';
import { logger } from '../utils/logger.js';

// Validation Schemas
const registerSchema = z.object({
  email: z.string().email('Invalid email address format').toLowerCase().trim(),
  password: z.string().min(8, 'Password must be at least 8 characters long'),
  confirm_age_18: z.literal(true, {
    errorMap: () => ({ message: 'You must confirm that you are 18 years or older' }),
  }),
  terms_version: z.string().default('1.0'),
  privacy_version: z.string().default('1.0'),
});

const loginSchema = z.object({
  email: z.string().email('Invalid email address format').toLowerCase().trim(),
  password: z.string().min(1, 'Password is required'),
});

const otpRequestSchema = z.object({
  phone: z.string().regex(/^\+[1-9]\d{6,14}$/, 'Phone number must be in valid E.164 format (e.g. +919876543210)'),
});

const otpVerifySchema = z.object({
  phone: z.string().regex(/^\+[1-9]\d{6,14}$/, 'Phone number must be in valid E.164 format (e.g. +919876543210)'),
  otp: z.string().length(6, 'OTP must be exactly 6 digits'),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

/**
 * Checks if mobile login is enabled in admin app_settings
 */
async function isMobileLoginEnabled() {
  try {
    const { rows } = await pool.query("SELECT value_json FROM app_settings WHERE key = 'auth_settings'");
    if (rows.length === 0) return false;
    return Boolean(rows[0].value_json?.mobile_login_enabled);
  } catch (err) {
    logger.warn('Could not query app_settings for auth_settings, defaulting mobile login to disabled:', err.message);
    return false;
  }
}

/**
 * 2.7 Public Auth Configuration
 * GET /auth/config
 * Returns public configuration flags (e.g. mobile_login_enabled)
 */
export async function getAuthConfig(req, res, next) {
  try {
    const mobileEnabled = await isMobileLoginEnabled();
    return res.status(200).json({
      mobile_login_enabled: mobileEnabled,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 2.1 Register User (Email & Password)
 */
export async function register(req, res, next) {
  try {
    const validated = registerSchema.safeParse(req.body);
    if (!validated.success) {
      return res.status(400).json({
        statusCode: 400,
        error: 'BadRequest',
        message: validated.error.errors.map((e) => e.message).join(', '),
      });
    }

    const { email, password, terms_version, privacy_version } = validated.data;

    // Check if email already registered
    const { rows: existing } = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.length > 0) {
      return res.status(409).json({
        statusCode: 409,
        error: 'Conflict',
        message: 'Email already registered',
      });
    }

    // Hash password with bcrypt (10 rounds)
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Insert new user
      const { rows: userRows } = await client.query(
        `
        INSERT INTO users (email, password_hash, age_confirmed_at, terms_version, privacy_version, status, is_available)
        VALUES ($1, $2, CURRENT_TIMESTAMP, $3, $4, 'active', FALSE)
        RETURNING id, email, status, is_available, created_at;
        `,
        [email, passwordHash, terms_version, privacy_version]
      );

      const user = userRows[0];

      // Create initial wallet with 10 free trial minutes
      await client.query(
        `
        INSERT INTO wallets (user_id, balance_amount, balance_minutes, free_trial_minutes)
        VALUES ($1, 0.00, 0, 10);
        `,
        [user.id]
      );

      // Generate tokens
      const accessToken = generateAccessToken(user);
      const refreshToken = generateRefreshToken(user);
      const tokenHash = hashToken(refreshToken);

      // Store refresh token
      await client.query(
        `
        INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
        VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL '7 days');
        `,
        [user.id, tokenHash]
      );

      await client.query('COMMIT');

      logger.info(`User registered successfully: [ID: ${user.id}, Email: ${user.email}]`);

      return res.status(201).json({
        user: {
          id: user.id,
          email: user.email,
          status: user.status,
          is_available: user.is_available,
          created_at: user.created_at,
        },
        tokens: {
          accessToken,
          refreshToken,
        },
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    next(error);
  }
}

/**
 * 2.2 Login User (Email & Password)
 */
export async function login(req, res, next) {
  try {
    const validated = loginSchema.safeParse(req.body);
    if (!validated.success) {
      return res.status(400).json({
        statusCode: 400,
        error: 'BadRequest',
        message: validated.error.errors.map((e) => e.message).join(', '),
      });
    }

    const { email, password } = validated.data;

    // Find user by email
    const { rows } = await pool.query(
      `
      SELECT id, email, phone, password_hash, status, is_available
      FROM users
      WHERE email = $1;
      `,
      [email]
    );

    if (rows.length === 0 || !rows[0].password_hash) {
      return res.status(401).json({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Invalid email or password',
      });
    }

    const user = rows[0];

    // Check account status
    if (user.status === 'suspended' || user.status === 'banned') {
      return res.status(403).json({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Account is suspended or banned',
      });
    }

    // Verify password with bcrypt
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Invalid email or password',
      });
    }

    // Generate tokens
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);
    const tokenHash = hashToken(refreshToken);

    // Store refresh token
    await pool.query(
      `
      INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
      VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL '7 days');
      `,
      [user.id, tokenHash]
    );

    logger.info(`User logged in successfully: [ID: ${user.id}, Email: ${user.email}]`);

    return res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        status: user.status,
        is_available: user.is_available,
      },
      tokens: {
        accessToken,
        refreshToken,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 2.3 Request Mobile OTP
 */
export async function requestOtp(req, res, next) {
  try {
    // 1. Check if mobile login is enabled by administrator
    const enabled = await isMobileLoginEnabled();
    if (!enabled) {
      return res.status(403).json({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Mobile login is disabled by platform administrator',
      });
    }

    // 2. Validate input
    const validated = otpRequestSchema.safeParse(req.body);
    if (!validated.success) {
      return res.status(400).json({
        statusCode: 400,
        error: 'BadRequest',
        message: validated.error.errors.map((e) => e.message).join(', '),
      });
    }

    const { phone } = validated.data;

    // 3. Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const codeHash = hashToken(otp);

    // Invalidate previous active OTPs for this phone
    await pool.query(
      `
      UPDATE otp_codes 
      SET is_used = TRUE 
      WHERE target = $1 AND purpose = 'login' AND is_used = FALSE;
      `,
      [phone]
    );

    // Save new OTP record (valid for 5 minutes)
    await pool.query(
      `
      INSERT INTO otp_codes (target, code_hash, purpose, expires_at, max_attempts)
      VALUES ($1, $2, 'login', CURRENT_TIMESTAMP + INTERVAL '5 minutes', 3);
      `,
      [phone, codeHash]
    );

    // 4. In development: print OTP to the server console instead of sending SMS
    logger.info('===============================================================');
    logger.info(`[DEV CONSOLE] Mobile Login OTP for ${phone}: [ ${otp} ]`);
    logger.info('Expires in 5 minutes (300 seconds). Do not share this code.');
    logger.info('===============================================================');

    return res.status(200).json({
      message: 'OTP sent successfully',
      expires_in_seconds: 300,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 2.4 Verify Mobile OTP
 */
export async function verifyOtp(req, res, next) {
  try {
    // 1. Check if mobile login is enabled
    const enabled = await isMobileLoginEnabled();
    if (!enabled) {
      return res.status(403).json({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Mobile login is disabled by platform administrator',
      });
    }

    // 2. Validate input
    const validated = otpVerifySchema.safeParse(req.body);
    if (!validated.success) {
      return res.status(400).json({
        statusCode: 400,
        error: 'BadRequest',
        message: validated.error.errors.map((e) => e.message).join(', '),
      });
    }

    const { phone, otp } = validated.data;

    // 3. Fetch latest active OTP for phone
    const { rows: otpRows } = await pool.query(
      `
      SELECT id, code_hash, attempts, max_attempts, expires_at
      FROM otp_codes
      WHERE target = $1 AND purpose = 'login' AND is_used = FALSE
      ORDER BY created_at DESC
      LIMIT 1;
      `,
      [phone]
    );

    if (otpRows.length === 0) {
      return res.status(401).json({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Invalid or expired OTP code',
      });
    }

    const otpRecord = otpRows[0];

    // Check expiration
    if (new Date() > new Date(otpRecord.expires_at)) {
      return res.status(401).json({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Invalid or expired OTP code',
      });
    }

    // Check max attempts
    if (otpRecord.attempts >= otpRecord.max_attempts) {
      return res.status(401).json({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Maximum OTP verification attempts reached. Please request a new code.',
      });
    }

    // Verify hash
    const inputHash = hashToken(otp);
    if (inputHash !== otpRecord.code_hash) {
      await pool.query(
        'UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1',
        [otpRecord.id]
      );
      return res.status(401).json({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Invalid OTP code',
      });
    }

    // Mark OTP as used
    await pool.query('UPDATE otp_codes SET is_used = TRUE WHERE id = $1', [otpRecord.id]);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Check if user already exists
      const { rows: userRows } = await client.query(
        `SELECT id, email, phone, status, is_available FROM users WHERE phone = $1;`,
        [phone]
      );

      let user;

      if (userRows.length > 0) {
        user = userRows[0];
        if (user.status === 'suspended' || user.status === 'banned') {
          await client.query('ROLLBACK');
          return res.status(403).json({
            statusCode: 403,
            error: 'Forbidden',
            message: 'Account is suspended or banned',
          });
        }
      } else {
        // Auto-create new user account with phone
        const { rows: newUserRows } = await client.query(
          `
          INSERT INTO users (phone, status, is_available)
          VALUES ($1, 'active', FALSE)
          RETURNING id, email, phone, status, is_available;
          `,
          [phone]
        );
        user = newUserRows[0];

        // Create wallet for new phone user
        await client.query(
          `
          INSERT INTO wallets (user_id, balance_amount, balance_minutes, free_trial_minutes)
          VALUES ($1, 0.00, 0, 10);
          `,
          [user.id]
        );
      }

      // Generate tokens
      const accessToken = generateAccessToken(user);
      const refreshToken = generateRefreshToken(user);
      const tokenHash = hashToken(refreshToken);

      // Store refresh token
      await client.query(
        `
        INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
        VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL '7 days');
        `,
        [user.id, tokenHash]
      );

      await client.query('COMMIT');

      logger.info(`User authenticated via OTP: [ID: ${user.id}, Phone: ${user.phone}]`);

      return res.status(200).json({
        user: {
          id: user.id,
          email: user.email,
          phone: user.phone,
          status: user.status,
          is_available: user.is_available,
        },
        tokens: {
          accessToken,
          refreshToken,
        },
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    next(error);
  }
}

/**
 * 2.5 Refresh Access Token
 */
export async function refresh(req, res, next) {
  try {
    const validated = refreshSchema.safeParse(req.body);
    if (!validated.success) {
      return res.status(400).json({
        statusCode: 400,
        error: 'BadRequest',
        message: 'Refresh token is required',
      });
    }

    const { refreshToken } = validated.data;

    let decoded;
    try {
      decoded = verifyRefreshToken(refreshToken);
    } catch (err) {
      return res.status(401).json({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Invalid or expired refresh token',
      });
    }

    const tokenHash = hashToken(refreshToken);

    // Look up token in refresh_tokens table
    const { rows: tokenRows } = await pool.query(
      `
      SELECT id, user_id, expires_at, revoked_at
      FROM refresh_tokens
      WHERE token_hash = $1;
      `,
      [tokenHash]
    );

    if (tokenRows.length === 0 || tokenRows[0].revoked_at !== null) {
      return res.status(401).json({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Refresh token has been revoked or expired',
      });
    }

    const tokenRecord = tokenRows[0];

    if (new Date() > new Date(tokenRecord.expires_at)) {
      return res.status(401).json({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Refresh token has expired',
      });
    }

    // Check user account status
    const { rows: userRows } = await pool.query(
      'SELECT id, email, phone, status, is_available FROM users WHERE id = $1',
      [tokenRecord.user_id]
    );

    if (userRows.length === 0) {
      return res.status(401).json({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'User no longer exists',
      });
    }

    const user = userRows[0];

    if (user.status === 'suspended' || user.status === 'banned') {
      return res.status(403).json({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Account is suspended or banned',
      });
    }

    // Revoke old refresh token (token rotation)
    await pool.query(
      'UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE id = $1',
      [tokenRecord.id]
    );

    // Generate new access token and rotating refresh token
    const newAccessToken = generateAccessToken(user);
    const newRefreshToken = generateRefreshToken(user);
    const newTokenHash = hashToken(newRefreshToken);

    // Save new refresh token
    await pool.query(
      `
      INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
      VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL '7 days');
      `,
      [user.id, newTokenHash]
    );

    return res.status(200).json({
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 2.6 Logout
 */
export async function logout(req, res, next) {
  try {
    const refreshToken = req.body?.refreshToken;

    if (refreshToken) {
      const tokenHash = hashToken(refreshToken);
      await pool.query(
        'UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE token_hash = $1',
        [tokenHash]
      );
    } else if (req.user?.id) {
      // If no specific refresh token provided, revoke all active refresh tokens for user
      await pool.query(
        'UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND revoked_at IS NULL',
        [req.user.id]
      );
    }

    logger.info(`User logged out: [ID: ${req.user?.id}]`);

    return res.status(200).json({
      message: 'Logged out successfully',
    });
  } catch (error) {
    next(error);
  }
}
