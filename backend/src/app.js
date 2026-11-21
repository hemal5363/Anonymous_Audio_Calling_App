import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { globalLimiter } from './middleware/rateLimiter.js';
import { errorHandler } from './middleware/errorHandler.js';
import routes from './routes/index.js';
import authRoutes from './routes/auth.routes.js';
import userRoutes from './routes/user.routes.js';
import callsRoutes from './routes/calls.routes.js';
import billingRoutes from './routes/billing.routes.js';
import adminRoutes from './routes/admin.routes.js';
import { config } from './config/index.js';
import { getHealth } from './controllers/health.controller.js';
import { getAuthConfig } from './controllers/auth.controller.js';

const app = express();

// Security and standard middlewares
app.use(helmet());

// CORS configuration reading allowed origins from environment
const corsOptions = {
  origin: (origin, callback) => {
    // Allow non-browser requests with no origin (mobile app, curl, server-to-server)
    if (!origin) {
      return callback(null, true);
    }
    const cleanOrigin = origin.replace(/\/$/, '');
    const allowedOrigins = config.cors.getAllowedOrigins();
    if (
      allowedOrigins.includes('*') ||
      allowedOrigins.includes(cleanOrigin) ||
      allowedOrigins.includes(origin)
    ) {
      return callback(null, true);
    }
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Authorization'],
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json());
app.use(globalLimiter);

// Direct root endpoints (per API spec)
app.get('/health', getHealth);
app.get('/config/public', getAuthConfig);
app.use('/auth', authRoutes);
app.use('/user', userRoutes);
app.use('/calls', callsRoutes);
app.use('/billing', billingRoutes);
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
