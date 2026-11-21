import { Router } from 'express';
import { getCallHistory } from '../controllers/user.controller.js';
import { authenticateUser } from '../middleware/auth.middleware.js';

const router = Router();

// All calls routes require authentication
router.use(authenticateUser);

// 4.1 Get Call History
router.get('/history', getCallHistory);

export default router;
