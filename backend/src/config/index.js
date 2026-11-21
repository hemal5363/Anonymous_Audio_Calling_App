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
};
