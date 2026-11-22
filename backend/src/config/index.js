import dotenv from 'dotenv';
import { z } from 'zod';
import crypto from 'node:crypto';

// Load environment variables from .env file
dotenv.config();

const envSchema = z.object({
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(1, 'JWT_SECRET is required'),
  JWT_REFRESH_SECRET: z.string().min(1, 'JWT_REFRESH_SECRET is required'),
  STUN_URLS: z.string().default('stun:stun.l.google.com:19302'),
  STUN_SERVER_URL: z.string().optional(),
  TURN_URL: z.string().optional(),
  TURN_SERVER_URL: z.string().optional(),
  TURN_SERVER_TCP_URL: z.string().optional(),
  TURN_USERNAME: z.string().optional(),
  TURN_PASSWORD: z.string().optional(),
  TURN_CREDENTIAL: z.string().optional(),
  TURN_SECRET: z.string().optional(),
  TURN_TTL: z.coerce.number().default(86400),
  ADMIN_CORS_ORIGIN: z.string().default('http://localhost:5173,http://127.0.0.1:5173'),
  EXPO_DEV_ORIGIN: z.string().default('http://localhost:8081,http://127.0.0.1:8081'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Environment validation error:', parsed.error.format());
  process.exit(1);
}

export const config = {
  host: parsed.data.HOST,
  port: parsed.data.PORT,
  env: parsed.data.NODE_ENV,
  db: {
    url: parsed.data.DATABASE_URL,
  },
  jwt: {
    secret: parsed.data.JWT_SECRET,
    refreshSecret: parsed.data.JWT_REFRESH_SECRET,
  },
  cors: {
    adminOrigin: parsed.data.ADMIN_CORS_ORIGIN,
    expoOrigin: parsed.data.EXPO_DEV_ORIGIN,
    getAllowedOrigins() {
      const adminOrigins = (parsed.data.ADMIN_CORS_ORIGIN || '')
        .split(',')
        .map((s) => s.trim().replace(/\/$/, ''))
        .filter(Boolean);
      const expoOrigins = (parsed.data.EXPO_DEV_ORIGIN || '')
        .split(',')
        .map((s) => s.trim().replace(/\/$/, ''))
        .filter(Boolean);
      return Array.from(new Set([...adminOrigins, ...expoOrigins]));
    },
  },
  webrtc: {
    get stunUrls() {
      return (
        process.env.STUN_URLS ||
        process.env.STUN_SERVER_URL ||
        'stun:stun.l.google.com:19302'
      );
    },
    get turnUrl() {
      return (
        process.env.TURN_URL ||
        process.env.TURN_SERVER_URL ||
        ''
      );
    },
    get turnUsername() {
      return process.env.TURN_USERNAME || '';
    },
    get turnPassword() {
      return (
        process.env.TURN_PASSWORD ||
        process.env.TURN_CREDENTIAL ||
        ''
      );
    },
    get turnSecret() {
      return process.env.TURN_SECRET || '';
    },
    get turnTtl() {
      return process.env.TURN_TTL ? Number(process.env.TURN_TTL) : 86400;
    },
    getIceServers({ callCode, userId } = {}) {
      const iceServers = [];

      // 1. STUN Servers (default Google public STUN)
      const stunRaw = this.stunUrls;
      const stunUrls = (stunRaw || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      if (stunUrls.length > 0) {
        iceServers.push({
          urls: stunUrls.length === 1 ? stunUrls[0] : stunUrls,
        });
      }

      // 2. TURN Server
      const rawTurn = this.turnUrl;
      if (rawTurn) {
        const turnUrls = rawTurn
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);

        const tcpUrl = process.env.TURN_SERVER_TCP_URL;
        if (tcpUrl && !turnUrls.includes(tcpUrl.trim())) {
          turnUrls.push(tcpUrl.trim());
        }

        const turnSecret = this.turnSecret;
        const turnUsername = this.turnUsername;
        const turnPassword = this.turnPassword;

        if (turnSecret) {
          // Ephemeral short-lived credentials generated per call (Coturn standard HMAC-SHA1)
          const ttl = this.turnTtl;
          const expiry = Math.floor(Date.now() / 1000) + ttl;
          const identifier = callCode || userId || turnUsername || 'user';
          const username = `${expiry}:${identifier}`;
          const credential = crypto
            .createHmac('sha1', turnSecret)
            .update(username)
            .digest('base64');

          iceServers.push({
            urls: turnUrls,
            username,
            credential,
          });
        } else if (turnUsername && turnPassword) {
          // Optional static TURN credentials
          iceServers.push({
            urls: turnUrls,
            username: turnUsername,
            credential: turnPassword,
          });
        }
        // Otherwise skip TURN
      }

      return iceServers;
    },
  },
};
