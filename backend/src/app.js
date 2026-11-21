import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { globalLimiter } from './middleware/rateLimiter.js';
import { errorHandler } from './middleware/errorHandler.js';
import routes from './routes/index.js';
import authRoutes from './routes/auth.routes.js';
import userRoutes from './routes/user.routes.js';
import callsRoutes from './routes/calls.routes.js';
import adminRoutes from './routes/admin.routes.js';
import { getHealth } from './controllers/health.controller.js';

const app = express();

// Security and standard middlewares
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(globalLimiter);

// Direct root endpoints (per API spec)
app.get('/health', getHealth);
app.use('/auth', authRoutes);
app.use('/user', userRoutes);
app.use('/calls', callsRoutes);
app.use('/admin', adminRoutes);

// Versioned /v1 prefix endpoints
app.use('/v1', routes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    statusCode: 404,
    error: 'NotFound',
    message: `Cannot ${req.method} ${req.path}`,
    timestamp: new Date().toISOString(),
  });
});

// Central error handler
app.use(errorHandler);

export default app;
