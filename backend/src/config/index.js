import dotenv from 'dotenv';
import { z } from 'zod';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env file (both cwd and backend root)
dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const envSchema = z.object({
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET is required and must be at least 32 characters long'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET is required and must be at least 32 characters long'),
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
  TRUST_PROXY: z.string().default('1'),

  // REST Rate Limiting
  RATE_LIMIT_GLOBAL_MAX: z.coerce.number().default(300),
  RATE_LIMIT_GLOBAL_WINDOW_MS: z.coerce.number().default(15 * 60 * 1000),
  RATE_LIMIT_REGISTER_MAX: z.coerce.number().default(10),
  RATE_LIMIT_REGISTER_WINDOW_MS: z.coerce.number().default(15 * 60 * 1000),
  RATE_LIMIT_LOGIN_MAX: z.coerce.number().default(10),
  RATE_LIMIT_LOGIN_ACCOUNT_MAX: z.coerce.number().default(5),
  RATE_LIMIT_LOGIN_WINDOW_MS: z.coerce.number().default(15 * 60 * 1000),
  RATE_LIMIT_OTP_REQUEST_MAX: z.coerce.number().default(5),
  RATE_LIMIT_OTP_REQUEST_PHONE_MAX: z.coerce.number().default(3),
  RATE_LIMIT_OTP_REQUEST_WINDOW_MS: z.coerce.number().default(15 * 60 * 1000),
  RATE_LIMIT_OTP_VERIFY_MAX: z.coerce.number().default(10),
  RATE_LIMIT_OTP_VERIFY_PHONE_MAX: z.coerce.number().default(5),
  RATE_LIMIT_OTP_VERIFY_WINDOW_MS: z.coerce.number().default(15 * 60 * 1000),

  // Socket Abuse Protection
  SOCKET_MAX_PAYLOAD_BYTES: z.coerce.number().default(65536),
  SOCKET_RATE_LIMIT_CALL_FIND_MAX: z.coerce.number().default(10),
  SOCKET_RATE_LIMIT_SIGNAL_MAX: z.coerce.number().default(60),
  SOCKET_RATE_LIMIT_ACCEPT_MAX: z.coerce.number().default(15),
  SOCKET_MAX_MALFORMED_EVENTS: z.coerce.number().default(5),
  SOCKET_SKIP_CANCEL_THRESHOLD: z.coerce.number().default(5),
  SOCKET_SKIP_CANCEL_WINDOW_MS: z.coerce.number().default(60000),
  SOCKET_SKIP_CANCEL_COOLDOWN_MS: z.coerce.number().default(30000),

  // Admin Abuse Protection
  ADMIN_MAX_LOGIN_ATTEMPTS: z.coerce.number().default(5),
  ADMIN_LOCKOUT_MINUTES: z.coerce.number().default(15),
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
  trustProxy: parsed.data.TRUST_PROXY,
  rateLimit: {
    get globalMax() {
      return Number(process.env.RATE_LIMIT_GLOBAL_MAX || parsed.data.RATE_LIMIT_GLOBAL_MAX);
    },
    get globalWindowMs() {
      return Number(process.env.RATE_LIMIT_GLOBAL_WINDOW_MS || parsed.data.RATE_LIMIT_GLOBAL_WINDOW_MS);
    },
    get registerMax() {
      return Number(process.env.RATE_LIMIT_REGISTER_MAX || parsed.data.RATE_LIMIT_REGISTER_MAX);
    },
    get registerWindowMs() {
      return Number(process.env.RATE_LIMIT_REGISTER_WINDOW_MS || parsed.data.RATE_LIMIT_REGISTER_WINDOW_MS);
    },
    get loginMax() {
      return Number(process.env.RATE_LIMIT_LOGIN_MAX || parsed.data.RATE_LIMIT_LOGIN_MAX);
    },
    get loginAccountMax() {
      return Number(process.env.RATE_LIMIT_LOGIN_ACCOUNT_MAX || parsed.data.RATE_LIMIT_LOGIN_ACCOUNT_MAX);
    },
    get loginWindowMs() {
      return Number(process.env.RATE_LIMIT_LOGIN_WINDOW_MS || parsed.data.RATE_LIMIT_LOGIN_WINDOW_MS);
    },
    get otpRequestMax() {
      return Number(process.env.RATE_LIMIT_OTP_REQUEST_MAX || parsed.data.RATE_LIMIT_OTP_REQUEST_MAX);
    },
    get otpRequestPhoneMax() {
      return Number(process.env.RATE_LIMIT_OTP_REQUEST_PHONE_MAX || parsed.data.RATE_LIMIT_OTP_REQUEST_PHONE_MAX);
    },
    get otpRequestWindowMs() {
      return Number(process.env.RATE_LIMIT_OTP_REQUEST_WINDOW_MS || parsed.data.RATE_LIMIT_OTP_REQUEST_WINDOW_MS);
    },
    get otpVerifyMax() {
      return Number(process.env.RATE_LIMIT_OTP_VERIFY_MAX || parsed.data.RATE_LIMIT_OTP_VERIFY_MAX);
    },
    get otpVerifyPhoneMax() {
      return Number(process.env.RATE_LIMIT_OTP_VERIFY_PHONE_MAX || parsed.data.RATE_LIMIT_OTP_VERIFY_PHONE_MAX);
    },
    get otpVerifyWindowMs() {
      return Number(process.env.RATE_LIMIT_OTP_VERIFY_WINDOW_MS || parsed.data.RATE_LIMIT_OTP_VERIFY_WINDOW_MS);
    },
  },
  socketAbuse: {
    get maxPayloadBytes() {
      return Number(process.env.SOCKET_MAX_PAYLOAD_BYTES || parsed.data.SOCKET_MAX_PAYLOAD_BYTES);
    },
    get callFindMax() {
      return Number(process.env.SOCKET_RATE_LIMIT_CALL_FIND_MAX || parsed.data.SOCKET_RATE_LIMIT_CALL_FIND_MAX);
    },
    get signalMax() {
      return Number(process.env.SOCKET_RATE_LIMIT_SIGNAL_MAX || parsed.data.SOCKET_RATE_LIMIT_SIGNAL_MAX);
    },
    get acceptMax() {
      return Number(process.env.SOCKET_RATE_LIMIT_ACCEPT_MAX || parsed.data.SOCKET_RATE_LIMIT_ACCEPT_MAX);
    },
    get maxMalformedEvents() {
      return Number(process.env.SOCKET_MAX_MALFORMED_EVENTS || parsed.data.SOCKET_MAX_MALFORMED_EVENTS);
    },
    get skipCancelThreshold() {
      return Number(process.env.SOCKET_SKIP_CANCEL_THRESHOLD || parsed.data.SOCKET_SKIP_CANCEL_THRESHOLD);
    },
    get skipCancelWindowMs() {
      return Number(process.env.SOCKET_SKIP_CANCEL_WINDOW_MS || parsed.data.SOCKET_SKIP_CANCEL_WINDOW_MS);
    },
    get skipCancelCooldownMs() {
      return Number(process.env.SOCKET_SKIP_CANCEL_COOLDOWN_MS || parsed.data.SOCKET_SKIP_CANCEL_COOLDOWN_MS);
    },
  },
  adminSecurity: {
    get maxLoginAttempts() {
      return Number(process.env.ADMIN_MAX_LOGIN_ATTEMPTS || parsed.data.ADMIN_MAX_LOGIN_ATTEMPTS);
    },
    get lockoutMinutes() {
      return Number(process.env.ADMIN_LOCKOUT_MINUTES || parsed.data.ADMIN_LOCKOUT_MINUTES);
    },
  },
};
