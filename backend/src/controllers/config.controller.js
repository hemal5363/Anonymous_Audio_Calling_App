import { settingsRegistry } from '../services/settings.service.js';

/**
 * Public Configuration API
 * GET /api/v1/config/public
 * Returns non-sensitive public configuration for mobile clients.
 * Caching strictly disabled (no-store) for instant maintenance and version gating propagation.
 */
export function getPublicConfig(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  return res.status(200).json(settingsRegistry.getPublicConfig());
}
