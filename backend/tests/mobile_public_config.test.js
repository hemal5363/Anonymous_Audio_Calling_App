/**
 * Mobile Public Configuration & Gating Unit Tests (Jest)
 * Verifies SemVer comparison, configuration shape validation,
 * offline logic, and gating decisions.
 */

// Implementation mirroring mobile/src/config/constants.ts
function compareSemver(v1, v2) {
  const p1 = (v1 || '0').split('.').map((x) => parseInt(x, 10) || 0);
  const p2 = (v2 || '0').split('.').map((x) => parseInt(x, 10) || 0);
  const maxLen = Math.max(p1.length, p2.length);
  for (let i = 0; i < maxLen; i++) {
    const num1 = p1[i] ?? 0;
    const num2 = p2[i] ?? 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}

// Implementation mirroring mobile/src/config/publicConfig.ts
function validatePublicConfig(data) {
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

function determineGatingState({
  isOnline,
  config,
  savedConfig,
  currentAppVersion = '1.0.0',
  userAcceptedTerms = null,
  userAcceptedPrivacy = null,
}) {
  if (!isOnline) {
    if (!savedConfig) {
      return { status: 'offline_blocked', reason: 'no_config' };
    }
    if (savedConfig.maintenance?.enabled) {
      return { status: 'offline_blocked', reason: 'untrusted_maintenance' };
    }
    const minVer = savedConfig.version_gating?.min_supported_version;
    if (minVer && compareSemver(currentAppVersion, minVer) < 0) {
      return { status: 'offline_blocked', reason: 'untrusted_version' };
    }
    return { status: 'ok' };
  }

  if (!config) {
    return { status: 'offline_blocked', reason: 'no_config' };
  }

  if (config.maintenance?.enabled) {
    return {
      status: 'maintenance',
      message: config.maintenance.message || 'Platform is under maintenance.',
    };
  }

  const minSupported = config.version_gating?.min_supported_version;
  if (minSupported && compareSemver(currentAppVersion, minSupported) < 0) {
    return {
      status: 'update_required',
      minVersion: minSupported,
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

const mockValidConfig = {
  maintenance: {
    enabled: false,
    message: 'Maintenance ongoing',
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
    currency: 'INR',
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
    min_registration_age: 18,
  },
};

describe('Mobile Public Config & Gating Engine', () => {
  describe('1. SemVer Version Comparison', () => {
    test('1.10.0 is greater than 1.9.0', () => {
      expect(compareSemver('1.10.0', '1.9.0')).toBe(1);
    });

    test('1.0.0 equals 1.0.0', () => {
      expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
    });

    test('1.0.1 is less than 1.0.2', () => {
      expect(compareSemver('1.0.1', '1.0.2')).toBe(-1);
    });

    test('2.0.0 is greater than 1.99.99', () => {
      expect(compareSemver('2.0.0', '1.99.99')).toBe(1);
    });

    test('handles two-part or single-part version strings gracefully', () => {
      expect(compareSemver('1.1', '1.1.0')).toBe(0);
      expect(compareSemver('2', '1.9.9')).toBe(1);
    });
  });

  describe('2. Config Parsing and Shape Validation', () => {
    test('validates a complete, correctly formed public config response', () => {
      expect(validatePublicConfig(mockValidConfig)).toBe(true);
    });

    test('rejects null or non-object payloads', () => {
      expect(validatePublicConfig(null)).toBe(false);
      expect(validatePublicConfig(undefined)).toBe(false);
      expect(validatePublicConfig('string')).toBe(false);
      expect(validatePublicConfig(123)).toBe(false);
    });

    test('rejects config missing maintenance field or invalid enabled type', () => {
      const invalid = { ...mockValidConfig, maintenance: { enabled: 'false' } };
      expect(validatePublicConfig(invalid)).toBe(false);
    });

    test('rejects config missing version gating fields', () => {
      const invalid = { ...mockValidConfig, version_gating: {} };
      expect(validatePublicConfig(invalid)).toBe(false);
    });

    test('rejects config with invalid monetization mode', () => {
      const invalid = {
        ...mockValidConfig,
        monetization: { ...mockValidConfig.monetization, mode: 'crypto' },
      };
      expect(validatePublicConfig(invalid)).toBe(false);
    });

    test('rejects config missing legal urls', () => {
      const invalid = { ...mockValidConfig, legal: { active_terms_version: '1.0' } };
      expect(validatePublicConfig(invalid)).toBe(false);
    });
  });

  describe('3. Offline Logic and Invariants', () => {
    test('first install offline (no saved config) is blocked with reason no_config', () => {
      const state = determineGatingState({
        isOnline: false,
        config: null,
        savedConfig: null,
        currentAppVersion: '1.0.0',
      });
      expect(state.status).toBe('offline_blocked');
      expect(state.reason).toBe('no_config');
    });

    test('offline with clean saved copy is allowed (status ok)', () => {
      const state = determineGatingState({
        isOnline: false,
        config: null,
        savedConfig: mockValidConfig,
        currentAppVersion: '1.0.0',
      });
      expect(state.status).toBe('ok');
    });

    test('offline with saved maintenance=true is untrusted and blocked (untrusted_maintenance)', () => {
      const maintenanceSaved = {
        ...mockValidConfig,
        maintenance: { enabled: true, message: 'Server down' },
      };
      const state = determineGatingState({
        isOnline: false,
        config: null,
        savedConfig: maintenanceSaved,
        currentAppVersion: '1.0.0',
      });
      expect(state.status).toBe('offline_blocked');
      expect(state.reason).toBe('untrusted_maintenance');
    });

    test('offline with saved old version gating is untrusted and blocked (untrusted_version)', () => {
      const outdatedSaved = {
        ...mockValidConfig,
        version_gating: {
          min_supported_version: '2.0.0',
          force_update_url: 'https://store',
        },
      };
      const state = determineGatingState({
        isOnline: false,
        config: null,
        savedConfig: outdatedSaved,
        currentAppVersion: '1.0.0',
      });
      expect(state.status).toBe('offline_blocked');
      expect(state.reason).toBe('untrusted_version');
    });
  });

  describe('4. Gating Decisions (Online)', () => {
    test('maintenance mode takes highest precedence when enabled', () => {
      const maintConfig = {
        ...mockValidConfig,
        maintenance: { enabled: true, message: 'Emergency maintenance underway' },
      };
      const state = determineGatingState({
        isOnline: true,
        config: maintConfig,
        savedConfig: mockValidConfig,
        currentAppVersion: '1.0.0',
      });
      expect(state.status).toBe('maintenance');
      expect(state.message).toBe('Emergency maintenance underway');
    });

    test('force update takes precedence over legal consent when version is unsupported', () => {
      const updateConfig = {
        ...mockValidConfig,
        version_gating: {
          min_supported_version: '1.10.0',
          force_update_url: 'https://play.google.com/store/apps/details?id=com.hemal.anonaudiocall',
        },
      };
      const state = determineGatingState({
        isOnline: true,
        config: updateConfig,
        savedConfig: mockValidConfig,
        currentAppVersion: '1.9.0',
      });
      expect(state.status).toBe('update_required');
      expect(state.minVersion).toBe('1.10.0');
      expect(state.forceUpdateUrl).toContain('play.google.com');
    });

    test('consent required when user accepted terms version is older than active terms version', () => {
      const legalConfig = {
        ...mockValidConfig,
        legal: {
          ...mockValidConfig.legal,
          active_terms_version: '2.0',
          active_privacy_version: '1.0',
        },
      };
      const state = determineGatingState({
        isOnline: true,
        config: legalConfig,
        savedConfig: mockValidConfig,
        currentAppVersion: '1.0.0',
        userAcceptedTerms: '1.0',
        userAcceptedPrivacy: '1.0',
      });
      expect(state.status).toBe('consent_required');
      expect(state.termsVersion).toBe('2.0');
      expect(state.privacyVersion).toBe('1.0');
    });

    test('consent required when user accepted privacy version is older than active privacy version', () => {
      const legalConfig = {
        ...mockValidConfig,
        legal: {
          ...mockValidConfig.legal,
          active_terms_version: '1.0',
          active_privacy_version: '1.5',
        },
      };
      const state = determineGatingState({
        isOnline: true,
        config: legalConfig,
        savedConfig: mockValidConfig,
        currentAppVersion: '1.0.0',
        userAcceptedTerms: '1.0',
        userAcceptedPrivacy: '1.0',
      });
      expect(state.status).toBe('consent_required');
      expect(state.termsVersion).toBe('1.0');
      expect(state.privacyVersion).toBe('1.5');
    });

    test('returns status ok when app is current, maintenance is false, and terms are agreed', () => {
      const state = determineGatingState({
        isOnline: true,
        config: mockValidConfig,
        savedConfig: mockValidConfig,
        currentAppVersion: '1.0.0',
        userAcceptedTerms: '1.0',
        userAcceptedPrivacy: '1.0',
      });
      expect(state.status).toBe('ok');
    });
  });
});
