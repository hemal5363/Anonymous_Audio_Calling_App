import { Router } from 'express';
import healthRoutes from './health.routes.js';
import authRoutes from './auth.routes.js';
import userRoutes from './user.routes.js';
import callsRoutes from './calls.routes.js';
import adminRoutes from './admin.routes.js';

const router = Router();

// Routes
router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/user', userRoutes);
router.use('/calls', callsRoutes);
router.use('/admin', adminRoutes);

export default router;
