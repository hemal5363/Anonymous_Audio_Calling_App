import { Router } from 'express';
import {
  register,
  login,
  requestOtp,
  verifyOtp,
  refresh,
  logout,
} from '../controllers/auth.controller.js';
import { authenticateUser } from '../middleware/auth.middleware.js';
import { loginRateLimiter, otpRateLimiter } from '../middleware/rateLimiter.js';

const router = Router();

// 2.1 Register (Email & Password)
router.post('/register', register);

// 2.2 Login (Email & Password) - with brute-force rate limiting
router.post('/login', loginRateLimiter, login);

// 2.3 Request Mobile OTP - with OTP flood rate limiting
router.post('/otp/request', otpRateLimiter, requestOtp);

// 2.4 Verify Mobile OTP
router.post('/otp/verify', loginRateLimiter, verifyOtp);

// 2.5 Refresh Access Token
router.post('/refresh', refresh);

// 2.6 Logout (Requires Bearer Access Token)
router.post('/logout', authenticateUser, logout);

export default router;
