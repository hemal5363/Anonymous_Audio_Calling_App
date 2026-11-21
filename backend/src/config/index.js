import dotenv from 'dotenv';
import { z } from 'zod';

// Load environment variables from .env file
dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(1, 'JWT_SECRET is required'),
  JWT_REFRESH_SECRET: z.string().min(1, 'JWT_REFRESH_SECRET is required'),
  STUN_SERVER_URL: z.string().default('stun:stun.l.google.com:19302'),
  TURN_SERVER_URL: z.string().default('turn:turn.example.com:3478?transport=udp'),
  TURN_SERVER_TCP_URL: z.string().default('turn:turn.example.com:3478?transport=tcp'),
  TURN_USERNAME: z.string().default('turn_user'),
  TURN_CREDENTIAL: z.string().default('turn_secret_password'),
  ADMIN_CORS_ORIGIN: z.string().default('http://localhost:5173'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Environment validation error:', parsed.error.format());
  process.exit(1);
}

export const config = {
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
    getAllowedOrigins() {
      return parsed.data.ADMIN_CORS_ORIGIN
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    },
  },
  webrtc: {
    stunUrl: parsed.data.STUN_SERVER_URL,
    turnUrl: parsed.data.TURN_SERVER_URL,
    turnTcpUrl: parsed.data.TURN_SERVER_TCP_URL,
    turnUsername: parsed.data.TURN_USERNAME,
    turnCredential: parsed.data.TURN_CREDENTIAL,
    getIceServers() {
      return [
        { urls: parsed.data.STUN_SERVER_URL },
        {
          urls: [parsed.data.TURN_SERVER_URL, parsed.data.TURN_SERVER_TCP_URL],
          username: parsed.data.TURN_USERNAME,
          credential: parsed.data.TURN_CREDENTIAL,
        },
      ];
    },
  },
};
