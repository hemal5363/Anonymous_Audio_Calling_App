import rateLimit from 'express-rate-limit';
import { config } from '../config/index.js';
import { settingsRegistry } from '../services/settings.service.js';

function resolveLimit(key, envName, fallback) {
  if (settingsRegistry.hasOverride && settingsRegistry.hasOverride(key)) {
    return Number(settingsRegistry.get(key));
  }
  if (process.env[envName] !== undefined && process.env[envName] !== '') {
    return Number(process.env[envName]);
  }
  try {
    return Number(settingsRegistry.get(key));
  } catch (_) {
    return Number(fallback);
  }
}

/**
 * Global rate limiter (per IP)
 */
export const globalLimiter = rateLimit({
  windowMs: config.rateLimit.globalWindowMs,
  max: () => resolveLimit('rate_limit_global_max', 'RATE_LIMIT_GLOBAL_MAX', config.rateLimit.globalMax),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    statusCode: 429,
    error: 'TooManyRequests',
    message: 'Too many requests from this IP, please try again later',
  },
});

/**
 * Registration rate limiter (per IP)
 */
export const registerLimiter = rateLimit({
  windowMs: config.rateLimit.registerWindowMs,
  max: () => resolveLimit('rate_limit_register_max', 'RATE_LIMIT_REGISTER_MAX', config.rateLimit.registerMax),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    statusCode: 429,
    error: 'TooManyRequests',
    message: 'Too many account registrations from this IP, please try again later',
  },
});

/**
 * Login rate limiter (per IP)
 */
export const loginIpLimiter = rateLimit({
  windowMs: config.rateLimit.loginWindowMs,
  max: () => resolveLimit('rate_limit_login_ip_max', 'RATE_LIMIT_LOGIN_MAX', config.rateLimit.loginMax),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    statusCode: 429,
    error: 'TooManyRequests',
    message: 'Too many login attempts from this IP, please try again later',
  },
});

/**
 * Login rate limiter (per target account / email)
 */
export const loginAccountLimiter = rateLimit({
  windowMs: config.rateLimit.loginWindowMs,
  max: () => resolveLimit('rate_limit_login_account_max', 'RATE_LIMIT_LOGIN_ACCOUNT_MAX', config.rateLimit.loginAccountMax),
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  keyGenerator: (req) => {
    const email = req.body?.email ? String(req.body.email).toLowerCase().trim() : '';
    return email ? `login_account:${email}` : `login_ip:${req.ip}`;
  },
  message: {
    statusCode: 429,
    error: 'TooManyRequests',
    message: 'Too many failed login attempts for this account, please try again later',
  },
});

/**
 * OTP Request rate limiter (per IP)
 */
export const otpRequestIpLimiter = rateLimit({
  windowMs: config.rateLimit.otpRequestWindowMs,
  max: () => resolveLimit('rate_limit_otp_request_max', 'RATE_LIMIT_OTP_REQUEST_MAX', config.rateLimit.otpRequestMax),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    statusCode: 429,
    error: 'TooManyRequests',
    message: 'Too many OTP requests from this IP, please try again later',
  },
});

/**
 * OTP Request rate limiter (per target phone number)
 */
export const otpRequestPhoneLimiter = rateLimit({
  windowMs: config.rateLimit.otpRequestWindowMs,
  max: () => resolveLimit('rate_limit_otp_request_phone_max', 'RATE_LIMIT_OTP_REQUEST_PHONE_MAX', config.rateLimit.otpRequestPhoneMax),
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  keyGenerator: (req) => {
    const phone = req.body?.phone ? String(req.body.phone).trim() : '';
    return phone ? `otp_request_phone:${phone}` : `otp_request_ip:${req.ip}`;
  },
  message: {
    statusCode: 429,
    error: 'TooManyRequests',
    message: 'Too many OTP requests for this phone number, please try again later',
  },
});

/**
 * OTP Verify rate limiter (per IP)
 */
export const otpVerifyIpLimiter = rateLimit({
  windowMs: config.rateLimit.otpVerifyWindowMs,
  max: () => config.rateLimit.otpVerifyMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    statusCode: 429,
    error: 'TooManyRequests',
    message: 'Too many OTP verification attempts from this IP, please try again later',
  },
});

/**
 * OTP Verify rate limiter (per target phone number)
 */
export const otpVerifyPhoneLimiter = rateLimit({
  windowMs: config.rateLimit.otpVerifyWindowMs,
  max: () => config.rateLimit.otpVerifyPhoneMax,
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  keyGenerator: (req) => {
    const phone = req.body?.phone ? String(req.body.phone).trim() : '';
    return phone ? `otp_verify_phone:${phone}` : `otp_verify_ip:${req.ip}`;
  },
  message: {
    statusCode: 429,
    error: 'TooManyRequests',
    message: 'Too many OTP verification attempts for this phone number, please try again later',
  },
});

// Backwards-compatible aliases
export const loginRateLimiter = loginIpLimiter;
export const otpRateLimiter = otpRequestIpLimiter;
