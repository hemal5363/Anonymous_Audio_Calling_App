import { Router } from 'express';
import {
  adminLogin,
  adminRefreshToken,
  changeAdminPassword,
  getSettings,
  updateSetting,
  resetSetting,
  getSettingsHistory,
  getSettingsStatus,
  listUsers,
  updateUserStatus,
  listReports,
  resolveReport,
  getStats,
  listCallLogs,
} from '../controllers/admin.controller.js';
import { authenticateAdmin } from '../middleware/adminAuth.middleware.js';
import { loginRateLimiter } from '../middleware/rateLimiter.js';

const router = Router();

// 6.1 Admin Login (Public, rate-limited)
router.post('/auth/login', loginRateLimiter, adminLogin);

// 6.1c Admin Refresh Token (Public with valid refresh token)
router.post('/auth/refresh', adminRefreshToken);

// All subsequent admin routes strictly require an Admin token!
router.use(authenticateAdmin);

// 6.1b Admin Password Update (Enforces strong password policy & revokes refresh tokens)
router.patch('/auth/password', changeAdminPassword);

// 6.2 Settings (Get, Update, Reset, History, Status)
router.get('/settings/history', getSettingsHistory);
router.get('/settings/status', getSettingsStatus);
router.get('/settings', getSettings);
router.put('/settings/:key', updateSetting);
router.delete('/settings/:key', resetSetting);

// 6.3 User Management
router.get('/users', listUsers);
router.patch('/users/:id/status', updateUserStatus);

// 6.4 Reports Queue & Moderation Actions
router.get('/reports', listReports);
router.patch('/reports/:id', resolveReport);

// 6.5 Platform Statistics & Dashboard
router.get('/stats', getStats);

// 6.6 Platform Call Logs (Anonymous)
router.get('/calls', listCallLogs);
router.get('/call-logs', listCallLogs);

export default router;
