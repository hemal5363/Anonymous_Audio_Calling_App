/**
 * Application Configuration
 * Server address is strictly read only from EXPO_PUBLIC_API_URL.
 * No fallback to local loopback or private LAN addresses.
 */
export const API_URL: string = process.env.EXPO_PUBLIC_API_URL || '';

export * from './constants';
export * from './publicConfig';
