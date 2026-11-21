import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { config } from '../config/index.js';

/**
 * Generate a short-lived user access token (15 minutes)
 */
export function generateAccessToken(user) {
  const payload = {
    userId: user.id,
    email: user.email,
    phone: user.phone,
    role: 'user',
    type: 'user',
  };

  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: '15m',
  });
}

/**
 * Generate an admin access token (12 hours)
 */
export function generateAdminToken(admin) {
  const payload = {
    adminId: admin.id,
    email: admin.email,
    role: admin.role,
    type: 'admin',
  };

  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: '12h',
  });
}

/**
 * Generate a rotating refresh token (7 days)
 */
export function generateRefreshToken(user) {
  const payload = {
    userId: user.id,
    tokenVersion: crypto.randomBytes(8).toString('hex'),
  };

  return jwt.sign(payload, config.jwt.refreshSecret, {
    expiresIn: '7d',
  });
}

/**
 * Verify access token
 */
export function verifyAccessToken(token) {
  return jwt.verify(token, config.jwt.secret);
}

/**
 * Verify refresh token
 */
export function verifyRefreshToken(token) {
  return jwt.verify(token, config.jwt.refreshSecret);
}

/**
 * SHA-256 hash for storing refresh tokens and OTPs securely
 */
export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}
