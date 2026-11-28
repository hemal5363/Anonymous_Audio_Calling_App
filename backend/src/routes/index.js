import { Router } from 'express';
import healthRoutes from './health.routes.js';
import authRoutes from './auth.routes.js';
import userRoutes from './user.routes.js';
import callsRoutes from './calls.routes.js';
import billingRoutes from './billing.routes.js';
import adminRoutes from './admin.routes.js';
import { getPublicConfig } from '../controllers/config.controller.js';

const router = Router();

// Routes
router.use('/health', healthRoutes);
router.get('/config/public', getPublicConfig);
router.use('/auth', authRoutes);
router.use('/user', userRoutes);
router.use('/calls', callsRoutes);
router.use('/billing', billingRoutes);
router.use('/admin', adminRoutes);

export default router;
