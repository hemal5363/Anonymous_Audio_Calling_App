import rateLimit from 'express-rate-limit';
import { config } from '../config/index.js';

/**
 * Global rate limiter (per IP)
 */
export const globalLimiter = rateLimit({
  windowMs: config.rateLimit.globalWindowMs,
  max: () => config.rateLimit.globalMax,
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
  max: () => config.rateLimit.registerMax,
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
  max: () => config.rateLimit.loginMax,
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
  max: () => config.rateLimit.loginAccountMax,
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
  max: () => config.rateLimit.otpRequestMax,
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
  max: () => config.rateLimit.otpRequestPhoneMax,
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
