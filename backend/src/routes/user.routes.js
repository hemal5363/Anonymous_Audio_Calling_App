import { Router } from 'express';
import {
  toggleAvailability,
  savePushToken,
  blockUser,
  getBlockedUsers,
  unblockUser,
  reportUser,
  getCallHistory,
} from '../controllers/user.controller.js';
import { authenticateUser } from '../middleware/auth.middleware.js';

const router = Router();

// All user routes strictly require authentication
router.use(authenticateUser);

// 3.1 Toggle Availability
router.put('/availability', toggleAvailability);

// 3.2 Save Push Token
router.post('/push-token', savePushToken);

// 3.3 Block User
router.post('/blocks', blockUser);
router.get('/blocks', getBlockedUsers);
router.delete('/blocks/:id', unblockUser);

// 3.4 Report Call / User
router.post('/reports', reportUser);

// Call History via user endpoint
router.get('/calls', getCallHistory);

export default router;
