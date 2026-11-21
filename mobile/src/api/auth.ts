import { api } from './client';

export interface AuthConfig {
  mobile_login_enabled: boolean;
}

export async function getAuthConfig(): Promise<AuthConfig> {
  try {
    return await api.get<AuthConfig>('/auth/config');
  } catch {
    // If backend cannot be reached or fails, safely default to disabled
    return { mobile_login_enabled: false };
  }
}
