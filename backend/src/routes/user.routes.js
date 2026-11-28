import { Router } from 'express';
import {
  getMe,
  toggleAvailability,
  savePushToken,
  removePushToken,
  blockUser,
  getBlockedUsers,
  unblockUser,
  reportUser,
  getCallHistory,
  deleteAccount,
  updateConsent,
} from '../controllers/user.controller.js';
import { authenticateUser } from '../middleware/auth.middleware.js';

const router = Router();

// All user routes strictly require authentication
router.use(authenticateUser);

// 3.0 Get Current User Profile
router.get('/me', getMe);
router.get('/profile', getMe);

// 3.1 Toggle Availability
router.put('/availability', toggleAvailability);

// 3.2 Save & Remove Push Token
router.post('/push-token', savePushToken);
router.delete('/push-token', removePushToken);

// 3.3 Block User
router.post('/blocks', blockUser);
router.get('/blocks', getBlockedUsers);
router.delete('/blocks/:id', unblockUser);

// 3.4 Report Call / User
router.post('/reports', reportUser);

// Call History via user endpoint
router.get('/calls', getCallHistory);

// 3.5 Delete Account (Google Play Compliance)
router.delete('/account', deleteAccount);
router.delete('/me', deleteAccount);

// 3.6 User Legal Consent Update
router.put('/consent', updateConsent);
router.post('/consent', updateConsent);

export default router;
