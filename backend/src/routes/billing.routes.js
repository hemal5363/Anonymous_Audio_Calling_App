import { Router } from 'express';
import { getWallet, getSubscription } from '../controllers/billing.controller.js';
import { authenticateUser } from '../middleware/auth.middleware.js';

const router = Router();

// All billing routes strictly require authentication
router.use(authenticateUser);

// 5.1 Get Wallet Balance
router.get('/wallet', getWallet);

// 5.3 Get Subscription Status & Plans
router.get('/subscription', getSubscription);

export default router;
