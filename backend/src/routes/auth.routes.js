import { Router } from 'express';
import {
  register,
  login,
  requestOtp,
  verifyOtp,
  refresh,
  logout,
  getAuthConfig,
} from '../controllers/auth.controller.js';
import { authenticateUser } from '../middleware/auth.middleware.js';
import {
  registerLimiter,
  loginIpLimiter,
  loginAccountLimiter,
  otpRequestIpLimiter,
  otpRequestPhoneLimiter,
  otpVerifyIpLimiter,
  otpVerifyPhoneLimiter,
} from '../middleware/rateLimiter.js';

const router = Router();

// 2.7 Public Auth Configuration (feature flags e.g. mobile_login_enabled)
router.get('/config', getAuthConfig);
router.get('/mobile-login-enabled', getAuthConfig);

// 2.1 Register (Email & Password) - with IP registration rate limiting
router.post('/register', registerLimiter, register);

// 2.2 Login (Email & Password) - with brute-force rate limiting (per IP & per account)
router.post('/login', [loginIpLimiter, loginAccountLimiter], login);

// 2.3 Request Mobile OTP - with OTP flood rate limiting (per IP & per phone)
router.post('/otp/request', [otpRequestIpLimiter, otpRequestPhoneLimiter], requestOtp);

// 2.4 Verify Mobile OTP - with OTP verification rate limiting (per IP & per phone)
router.post('/otp/verify', [otpVerifyIpLimiter, otpVerifyPhoneLimiter], verifyOtp);

// 2.5 Refresh Access Token
router.post('/refresh', refresh);

// 2.6 Logout (Requires Bearer Access Token)
router.post('/logout', authenticateUser, logout);

export default router;
