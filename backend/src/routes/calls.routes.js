import { Router } from 'express';
import { getCallHistory, getSessionById, getTurnCredentials } from '../controllers/user.controller.js';
import { authenticateUser } from '../middleware/auth.middleware.js';

const router = Router();

// All calls routes require authentication
router.use(authenticateUser);

// 4.1 Get Call History
router.get('/history', getCallHistory);

// 4.2 Get TURN Credentials
router.get('/turn-credentials', getTurnCredentials);

// 4.3 Query Session State (for Push Notification tap / cold start)
router.get('/session/:sessionId', getSessionById);
router.get('/:sessionId', getSessionById);
router.get('/:sessionId/state', getSessionById);

export default router;
