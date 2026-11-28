import Constants from 'expo-constants';

/**
 * Fixed Technical Constants (Invariants & Policies)
 * These values are architectural invariants and never configured dynamically.
 */
export const BILLING_CURRENCY = 'INR' as const;
export const MIN_REGISTRATION_AGE = 18 as const;

/**
 * Installed application version from Expo configuration
 */
export const APP_VERSION: string =
  Constants.expoConfig?.version ||
  Constants.manifest2?.extra?.expoClient?.version ||
  '1.0.0';

/**
 * Numerically compares two SemVer strings (major.minor.patch).
 * Handles multi-digit components correctly (e.g. 1.10.0 > 1.9.0).
 *
 * @returns -1 if v1 < v2, 0 if v1 === v2, 1 if v1 > v2
 */
export function compareSemver(v1?: string | null, v2?: string | null): number {
  if (!v1 && !v2) return 0;
  if (!v1) return -1;
  if (!v2) return 1;

  // Strip pre-release or build metadata (e.g. "1.0.0-beta.1" -> "1.0.0")
  const clean1 = v1.split('-')[0].split('+')[0].trim();
  const clean2 = v2.split('-')[0].split('+')[0].trim();

  const parts1 = clean1.split('.').map((p) => {
    const num = parseInt(p, 10);
    return isNaN(num) ? 0 : num;
  });
  const parts2 = clean2.split('.').map((p) => {
    const num = parseInt(p, 10);
    return isNaN(num) ? 0 : num;
  });

  const maxLen = Math.max(parts1.length, parts2.length, 3);
  for (let i = 0; i < maxLen; i++) {
    const n1 = parts1[i] || 0;
    const n2 = parts2[i] || 0;
    if (n1 > n2) return 1;
    if (n1 < n2) return -1;
  }

  return 0;
}
