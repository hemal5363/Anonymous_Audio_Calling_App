import * as SecureStore from 'expo-secure-store';
import { API_URL } from './index';
import { APP_VERSION, BILLING_CURRENCY, MIN_REGISTRATION_AGE, compareSemver } from './constants';

export interface SubscriptionPlan {
  id: string;
  name: string;
  price: number;
  duration_days: number;
  active: boolean;
}

export interface PublicConfig {
  maintenance: {
    enabled: boolean;
    message: string;
  };
  version_gating: {
    min_supported_version: string;
    force_update_url: string;
  };
  auth: {
    registration_enabled: boolean;
    email_login_enabled: boolean;
    mobile_login_enabled: boolean;
    password_min_length: number;
    otp_expiry_seconds: number;
    otp_resend_cooldown_seconds: number;
  };
  calls: {
    ring_timeout_seconds: number;
    disconnect_grace_period_seconds: number;
    max_call_duration_seconds: number;
  };
  monetization: {
    mode: 'free' | 'subscription' | 'per_minute';
    currency: string;
    rate_per_minute: number;
    minimum_balance: number;
    free_trial_minutes_new_user: number;
    free_daily_minute_cap: number;
    subscription_plans: SubscriptionPlan[];
  };
  moderation: {
    report_note_max_length: number;
  };
  legal: {
    privacy_policy_url: string;
    terms_of_service_url: string;
    active_terms_version: string;
    active_privacy_version: string;
    min_registration_age: number;
  };
}

/**
 * Default fallback configuration.
 * CRITICAL: Use defaults ONLY for display fallbacks, NEVER for gating!
 */
export const DEFAULT_PUBLIC_CONFIG: PublicConfig = {
  maintenance: {
    enabled: false,
    message: 'Platform is undergoing scheduled maintenance. Please check back shortly.',
  },
  version_gating: {
    min_supported_version: '1.0.0',
    force_update_url: 'https://play.google.com/store/apps/details?id=com.hemal.anonaudiocall',
  },
  auth: {
    registration_enabled: true,
    email_login_enabled: true,
    mobile_login_enabled: false,
    password_min_length: 8,
    otp_expiry_seconds: 300,
    otp_resend_cooldown_seconds: 60,
  },
  calls: {
    ring_timeout_seconds: 30,
    disconnect_grace_period_seconds: 5,
    max_call_duration_seconds: 3600,
  },
  monetization: {
    mode: 'free',
    currency: BILLING_CURRENCY,
    rate_per_minute: 1.0,
    minimum_balance: 5.0,
    free_trial_minutes_new_user: 10,
    free_daily_minute_cap: 30,
    subscription_plans: [],
  },
  moderation: {
    report_note_max_length: 1000,
  },
  legal: {
    privacy_policy_url: 'https://anoncall-admin.duckdns.org/privacy.html',
    terms_of_service_url: 'https://anoncall-admin.duckdns.org/terms.html',
    active_terms_version: '1.0',
    active_privacy_version: '1.0',
    min_registration_age: MIN_REGISTRATION_AGE,
  },
};

const STORAGE_KEY_PUBLIC_CONFIG = 'anoncall_public_config';
const STORAGE_KEY_ACCEPTED_TERMS = 'anoncall_accepted_terms_version';
const STORAGE_KEY_ACCEPTED_PRIVACY = 'anoncall_accepted_privacy_version';

// In-memory latest good copy
let inMemoryConfig: PublicConfig | null = null;

export function getLatestPublicConfig(): PublicConfig {
  return inMemoryConfig || DEFAULT_PUBLIC_CONFIG;
}

/**
 * Validates the runtime shape of the public configuration received from the API
 */
export function validatePublicConfig(data: any): data is PublicConfig {
  if (!data || typeof data !== 'object') return false;

  // 1. Maintenance
  if (!data.maintenance || typeof data.maintenance.enabled !== 'boolean') return false;

  // 2. Version Gating
  if (
    !data.version_gating ||
    typeof data.version_gating.min_supported_version !== 'string' ||
    typeof data.version_gating.force_update_url !== 'string'
  ) {
    return false;
  }

  // 3. Auth
  if (
    !data.auth ||
    typeof data.auth.registration_enabled !== 'boolean' ||
    typeof data.auth.email_login_enabled !== 'boolean' ||
    typeof data.auth.mobile_login_enabled !== 'boolean' ||
    typeof data.auth.password_min_length !== 'number' ||
    typeof data.auth.otp_expiry_seconds !== 'number'
  ) {
    return false;
  }

  // 4. Calls
  if (
    !data.calls ||
    typeof data.calls.ring_timeout_seconds !== 'number' ||
    typeof data.calls.disconnect_grace_period_seconds !== 'number' ||
    typeof data.calls.max_call_duration_seconds !== 'number'
  ) {
    return false;
  }

  // 5. Monetization
  if (!data.monetization || !['free', 'subscription', 'per_minute'].includes(data.monetization.mode)) {
    return false;
  }

  // 6. Moderation
  if (!data.moderation || typeof data.moderation.report_note_max_length !== 'number') {
    return false;
  }

  // 7. Legal
  if (
    !data.legal ||
    typeof data.legal.privacy_policy_url !== 'string' ||
    typeof data.legal.terms_of_service_url !== 'string'
  ) {
    return false;
  }

  return true;
}

/**
 * Load saved copy from device storage (SecureStore)
 */
export async function loadSavedPublicConfig(): Promise<PublicConfig | null> {
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_KEY_PUBLIC_CONFIG);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (validatePublicConfig(parsed)) {
      inMemoryConfig = parsed;
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Persist good configuration to device storage
 */
export async function savePublicConfig(config: PublicConfig): Promise<void> {
  try {
    inMemoryConfig = config;
    await SecureStore.setItemAsync(STORAGE_KEY_PUBLIC_CONFIG, JSON.stringify(config));
  } catch {
    // Non-fatal if storage write fails
  }
}

/**
 * Fetch public config from server with 5s timeout and no HTTP caching
 */
export async function fetchPublicConfig(timeoutMs = 5000): Promise<PublicConfig> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const endpoint = `${API_URL}/api/v1/config/public`;

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
        'X-App-Version': APP_VERSION,
      },
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      throw new Error(`Public config request failed with HTTP ${response.status}`);
    }

    const data = await response.json();
    if (!validatePublicConfig(data)) {
      throw new Error('Public config response shape validation failed');
    }

    // Cache latest good copy in memory and on device
    await savePublicConfig(data);
    return data;
  } catch (err: any) {
    clearTimeout(timer);
    throw err;
  }
}

/**
 * Retrieve user's locally accepted legal terms & privacy versions
 */
export async function getAcceptedConsentVersions(): Promise<{
  acceptedTerms: string | null;
  acceptedPrivacy: string | null;
}> {
  try {
    const [acceptedTerms, acceptedPrivacy] = await Promise.all([
      SecureStore.getItemAsync(STORAGE_KEY_ACCEPTED_TERMS),
      SecureStore.getItemAsync(STORAGE_KEY_ACCEPTED_PRIVACY),
    ]);
    return { acceptedTerms, acceptedPrivacy };
  } catch {
    return { acceptedTerms: null, acceptedPrivacy: null };
  }
}

/**
 * Save user's accepted legal terms & privacy versions to device
 */
export async function saveAcceptedConsentVersions(
  termsVersion: string,
  privacyVersion: string
): Promise<void> {
  try {
    await Promise.all([
      SecureStore.setItemAsync(STORAGE_KEY_ACCEPTED_TERMS, termsVersion),
      SecureStore.setItemAsync(STORAGE_KEY_ACCEPTED_PRIVACY, privacyVersion),
    ]);
  } catch {
    // Non-fatal
  }
}

export type GatingDecision =
  | { status: 'ok' }
  | { status: 'maintenance'; message: string }
  | { status: 'update_required'; minVersion: string; forceUpdateUrl: string }
  | { status: 'offline_blocked'; reason: 'no_config' | 'untrusted_maintenance' | 'untrusted_version' }
  | { status: 'consent_required'; termsVersion: string; privacyVersion: string };

/**
 * Pure deterministic gating evaluation function.
 *
 * RULES:
 * 1. Live config:
 *    - maintenance.enabled === true -> 'maintenance'
 *    - compareSemver(installedVersion, min_supported_version) < 0 -> 'update_required'
 *    - user accepted terms/privacy < active versions -> 'consent_required'
 *    - Otherwise -> 'ok'
 * 2. Offline with saved copy:
 *    - Do NOT trust a saved maintenance=true while offline (treat as unknown, block with retry)
 *    - Do NOT trust an old version gate while offline (treat as unknown, block with retry)
 *    - If saved copy had maintenance=false and valid version -> 'ok' (app continues with saved display copy)
 * 3. Offline with NO saved copy (first install, offline):
 *    - 'offline_blocked' with reason 'no_config'
 */
export function determineGatingState({
  config,
  isLiveFetchSuccessful,
  hasSavedCopy,
  installedVersion = APP_VERSION,
  userAcceptedTerms = null,
  userAcceptedPrivacy = null,
}: {
  config: PublicConfig | null;
  isLiveFetchSuccessful: boolean;
  hasSavedCopy: boolean;
  installedVersion?: string;
  userAcceptedTerms?: string | null;
  userAcceptedPrivacy?: string | null;
}): GatingDecision {
  // Scenario A: Live fetch succeeded from server
  if (isLiveFetchSuccessful && config) {
    if (config.maintenance?.enabled) {
      return {
        status: 'maintenance',
        message: config.maintenance.message || DEFAULT_PUBLIC_CONFIG.maintenance.message,
      };
    }

    if (
      config.version_gating?.min_supported_version &&
      compareSemver(installedVersion, config.version_gating.min_supported_version) < 0
    ) {
      return {
        status: 'update_required',
        minVersion: config.version_gating.min_supported_version,
        forceUpdateUrl: config.version_gating.force_update_url,
      };
    }

    const activeTerms = config.legal?.active_terms_version || '1.0';
    const activePrivacy = config.legal?.active_privacy_version || '1.0';

    if (userAcceptedTerms && compareSemver(userAcceptedTerms, activeTerms) < 0) {
      return {
        status: 'consent_required',
        termsVersion: activeTerms,
        privacyVersion: activePrivacy,
      };
    }

    if (userAcceptedPrivacy && compareSemver(userAcceptedPrivacy, activePrivacy) < 0) {
      return {
        status: 'consent_required',
        termsVersion: activeTerms,
        privacyVersion: activePrivacy,
      };
    }

    return { status: 'ok' };
  }

  // Scenario B: Offline / Network failure
  if (!hasSavedCopy || !config) {
    // First install offline: no configuration saved
    return { status: 'offline_blocked', reason: 'no_config' };
  }

  // Saved copy exists on device:
  // "do NOT trust a saved maintenance=true or an old version gate while offline (treat as unknown, show 'Retry')"
  if (config.maintenance?.enabled) {
    return { status: 'offline_blocked', reason: 'untrusted_maintenance' };
  }

  if (
    config.version_gating?.min_supported_version &&
    compareSemver(installedVersion, config.version_gating.min_supported_version) < 0
  ) {
    return { status: 'offline_blocked', reason: 'untrusted_version' };
  }

  // Saved copy is clean; proceed in offline mode with saved copy
  return { status: 'ok' };
}
