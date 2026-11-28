import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import {
  PublicConfig,
  DEFAULT_PUBLIC_CONFIG,
  GatingDecision,
  loadSavedPublicConfig,
  savePublicConfig,
  fetchPublicConfig,
  getAcceptedConsentVersions,
  saveAcceptedConsentVersions,
  determineGatingState,
} from './publicConfig';
import { APP_VERSION } from './constants';
import { disconnectSocket } from '../socket';
import { api } from '../api/client';

export interface PublicConfigContextType {
  config: PublicConfig;
  isLoading: boolean;
  isOffline: boolean;
  hasSavedCopy: boolean;
  gatingState: GatingDecision;
  refetch: () => Promise<void>;
  acceptUpdatedConsent: (termsVersion: string, privacyVersion: string) => Promise<void>;
  triggerUpdateRequired: (minVersion?: string, forceUpdateUrl?: string) => void;
  triggerMaintenance: (message?: string) => void;
}

const PublicConfigContext = createContext<PublicConfigContextType | undefined>(undefined);

// Listeners for external triggers (e.g. from API 426 / 503 or socket events)
let externalTriggerUpdateRequired: ((minVersion?: string, forceUpdateUrl?: string) => void) | null = null;
let externalTriggerMaintenance: ((message?: string) => void) | null = null;

export function triggerGlobalUpdateRequired(minVersion?: string, forceUpdateUrl?: string) {
  if (externalTriggerUpdateRequired) {
    externalTriggerUpdateRequired(minVersion, forceUpdateUrl);
  }
}

export function triggerGlobalMaintenance(message?: string) {
  if (externalTriggerMaintenance) {
    externalTriggerMaintenance(message);
  }
}

export function PublicConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<PublicConfig>(DEFAULT_PUBLIC_CONFIG);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isOffline, setIsOffline] = useState<boolean>(false);
  const [hasSavedCopy, setHasSavedCopy] = useState<boolean>(false);
  const [userConsent, setUserConsent] = useState<{
    acceptedTerms: string | null;
    acceptedPrivacy: string | null;
  }>({ acceptedTerms: null, acceptedPrivacy: null });

  // Forced runtime overrides from socket/api (e.g. mid-session 426 or 503)
  const [runtimeOverride, setRuntimeOverride] = useState<GatingDecision | null>(null);

  const isMountedRef = useRef(true);

  // Wire global trigger functions
  useEffect(() => {
    externalTriggerUpdateRequired = (minVersion, forceUpdateUrl) => {
      setRuntimeOverride({
        status: 'update_required',
        minVersion: minVersion || config.version_gating.min_supported_version,
        forceUpdateUrl: forceUpdateUrl || config.version_gating.force_update_url,
      });
    };

    externalTriggerMaintenance = (message) => {
      // Disconnect socket on maintenance
      disconnectSocket();
      setRuntimeOverride({
        status: 'maintenance',
        message: message || config.maintenance.message || DEFAULT_PUBLIC_CONFIG.maintenance.message,
      });
    };

    return () => {
      externalTriggerUpdateRequired = null;
      externalTriggerMaintenance = null;
    };
  }, [config]);

  // Main fetch & synchronize logic
  const loadConfig = useCallback(async (isInitial = false) => {
    let saved: PublicConfig | null = null;
    let savedConsent = { acceptedTerms: null as string | null, acceptedPrivacy: null as string | null };

    if (isInitial) {
      saved = await loadSavedPublicConfig();
      savedConsent = await getAcceptedConsentVersions();
      if (saved && isMountedRef.current) {
        setConfig(saved);
        setHasSavedCopy(true);
      }
      if (isMountedRef.current) {
        setUserConsent(savedConsent);
      }
    }

    try {
      // 5 second timeout with no HTTP cache
      const fresh = await fetchPublicConfig(5000);
      if (isMountedRef.current) {
        setConfig(fresh);
        setIsOffline(false);
        setHasSavedCopy(true);
        setRuntimeOverride(null); // clear runtime override on fresh server state
      }
    } catch {
      if (isMountedRef.current) {
        setIsOffline(true);
      }
    } finally {
      if (isMountedRef.current && isInitial) {
        setIsLoading(false);
      }
    }
  }, []);

  // Initial load on launch
  useEffect(() => {
    isMountedRef.current = true;
    loadConfig(true);

    return () => {
      isMountedRef.current = false;
    };
  }, [loadConfig]);

  // AppState change listener (refetch when returning to foreground)
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        loadConfig(false);
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      subscription.remove();
    };
  }, [loadConfig]);

  // Periodic 5-minute background refresh while open
  useEffect(() => {
    const interval = setInterval(() => {
      loadConfig(false);
    }, 5 * 60 * 1000);

    return () => clearInterval(interval);
  }, [loadConfig]);

  // Record acceptance of updated terms and privacy versions
  const acceptUpdatedConsent = async (termsVersion: string, privacyVersion: string) => {
    // 1. Save locally
    await saveAcceptedConsentVersions(termsVersion, privacyVersion);
    setUserConsent({ acceptedTerms: termsVersion, acceptedPrivacy: privacyVersion });

    // 2. Sync to server if authenticated
    try {
      await api.put('/user/consent', { terms_version: termsVersion, privacy_version: privacyVersion });
    } catch {
      // Local acceptance still persists
    }
  };

  // Compute current gating decision
  const computedGating: GatingDecision = runtimeOverride
    ? runtimeOverride
    : determineGatingState({
        config,
        isLiveFetchSuccessful: !isOffline,
        hasSavedCopy,
        installedVersion: APP_VERSION,
        userAcceptedTerms: userConsent.acceptedTerms,
        userAcceptedPrivacy: userConsent.acceptedPrivacy,
      });

  // If maintenance is active, disconnect socket
  useEffect(() => {
    if (computedGating.status === 'maintenance') {
      disconnectSocket();
    }
  }, [computedGating.status]);

  return (
    <PublicConfigContext.Provider
      value={{
        config,
        isLoading,
        isOffline,
        hasSavedCopy,
        gatingState: computedGating,
        refetch: () => loadConfig(false),
        acceptUpdatedConsent,
        triggerUpdateRequired: (minVersion, forceUpdateUrl) => {
          setRuntimeOverride({
            status: 'update_required',
            minVersion: minVersion || config.version_gating.min_supported_version,
            forceUpdateUrl: forceUpdateUrl || config.version_gating.force_update_url,
          });
        },
        triggerMaintenance: (message) => {
          disconnectSocket();
          setRuntimeOverride({
            status: 'maintenance',
            message: message || config.maintenance.message,
          });
        },
      }}
    >
      {children}
    </PublicConfigContext.Provider>
  );
}

export function usePublicConfig(): PublicConfigContextType {
  const context = useContext(PublicConfigContext);
  if (!context) {
    throw new Error('usePublicConfig must be used within a PublicConfigProvider');
  }
  return context;
}
