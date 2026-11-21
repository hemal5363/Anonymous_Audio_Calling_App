import rateLimit from 'express-rate-limit';

// Global rate limiter
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    statusCode: 429,
    error: 'TooManyRequests',
    message: 'Too many requests from this IP, please try again after 15 minutes',
  },
});

// Stricter rate limiter for login attempts (prevent brute-force)
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // max 10 failed/passed attempts per 15 mins per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    statusCode: 429,
    error: 'TooManyRequests',
    message: 'Too many login attempts from this IP, please try again after 15 minutes',
  },
});

// Stricter rate limiter for OTP requests (prevent SMS/OTP flooding)
export const otpRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // max 5 OTP requests per 15 minutes per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    statusCode: 429,
    error: 'TooManyRequests',
    message: 'Too many OTP requests from this IP, please try again after 15 minutes',
  },
});
