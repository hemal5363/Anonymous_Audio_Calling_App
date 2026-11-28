import { API_URL } from '../config';
import { APP_VERSION } from '../config/constants';
import { tokenStorage } from '../auth/tokenStorage';
import {
  triggerGlobalUpdateRequired,
  triggerGlobalMaintenance,
} from '../config/PublicConfigContext';

export interface ApiError {
  statusCode: number;
  error: string;
  message: string;
  timestamp?: string;
  path?: string;
}

export class ApiException extends Error {
  statusCode: number;
  error: string;
  payload?: any;

  constructor(message: string, statusCode: number, error: string, payload?: any) {
    super(message);
    this.name = 'ApiException';
    this.statusCode = statusCode;
    this.error = error;
    this.payload = payload;
  }
}

// Global hook triggered when token refresh fails completely (user must log in again)
let onUnauthorizedCallback: (() => void) | null = null;

export function setOnUnauthorizedCallback(cb: (() => void) | null) {
  onUnauthorizedCallback = cb;
}

export async function handleSessionExpired(): Promise<void> {
  await tokenStorage.clearTokens();
  if (onUnauthorizedCallback) {
    onUnauthorizedCallback();
  }
}

let isRefreshing = false;
let refreshSubscribers: ((newToken: string | null) => void)[] = [];

function subscribeTokenRefresh(cb: (newToken: string | null) => void) {
  refreshSubscribers.push(cb);
}

function onRefreshed(newToken: string | null) {
  refreshSubscribers.forEach((cb) => cb(newToken));
  refreshSubscribers = [];
}

/**
 * Attempts to exchange stored refresh token for a new access token
 */
async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = await tokenStorage.getRefreshToken();
  if (!refreshToken) {
    await handleSessionExpired();
    return null;
  }

  try {
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-App-Version': APP_VERSION,
      },
      body: JSON.stringify({ refreshToken }),
    });

    if (!res.ok) {
      await handleSessionExpired();
      return null;
    }

    const data = await res.json();
    if (data.accessToken) {
      if (data.refreshToken) {
        await tokenStorage.setTokens(data.accessToken, data.refreshToken);
      } else {
        await tokenStorage.setAccessToken(data.accessToken);
      }
      return data.accessToken;
    }

    await handleSessionExpired();
    return null;
  } catch (err) {
    await handleSessionExpired();
    return null;
  }
}

/**
 * Core HTTP Request dispatcher with automatic Bearer token injection and 401 refresh retry
 */
export async function apiClient<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = endpoint.startsWith('http') ? endpoint : `${API_URL}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-App-Version': APP_VERSION,
    ...(options.headers as Record<string, string>),
  };

  // Attach access token if present
  const accessToken = await tokenStorage.getAccessToken();
  if (accessToken && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  let response = await fetch(url, {
    ...options,
    headers,
  });

  // Handle 401 Unauthorized by attempting a token refresh
  if (response.status === 401 && !endpoint.includes('/auth/login') && !endpoint.includes('/auth/refresh')) {
    if (!isRefreshing) {
      isRefreshing = true;
      const newToken = await refreshAccessToken();
      isRefreshing = false;
      onRefreshed(newToken);

      if (newToken) {
        headers['Authorization'] = `Bearer ${newToken}`;
        response = await fetch(url, {
          ...options,
          headers,
        });
      }
    } else {
      // Wait for existing refresh to complete
      const retryToken = await new Promise<string | null>((resolve) => {
        subscribeTokenRefresh((token) => resolve(token));
      });

      if (retryToken) {
        headers['Authorization'] = `Bearer ${retryToken}`;
        response = await fetch(url, {
          ...options,
          headers,
        });
      }
    }
  }

  const contentType = response.headers.get('content-type');
  const isJson = contentType && contentType.includes('application/json');
  const body = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    // Intercept 426 Upgrade Required for version gating
    if (response.status === 426) {
      const minVer = isJson && body ? body.min_version : undefined;
      const forceUrl = isJson && body ? body.force_update_url : undefined;
      triggerGlobalUpdateRequired(minVer, forceUrl);
    }

    // Intercept 503 Service Unavailable for maintenance mode
    if (response.status === 503) {
      const maintMsg = isJson && body ? body.message : undefined;
      triggerGlobalMaintenance(maintMsg);
    }

    const errorMsg =
      (isJson && body && (body.message || body.error)) ||
      `Request failed with status ${response.status}`;
    const errorType = (isJson && body && body.error) || 'ApiError';

    throw new ApiException(
      typeof errorMsg === 'string' ? errorMsg : JSON.stringify(errorMsg),
      response.status,
      errorType,
      body
    );
  }

  return body as T;
}

export const api = {
  get: <T>(endpoint: string, options?: RequestInit) =>
    apiClient<T>(endpoint, { ...options, method: 'GET' }),
  post: <T>(endpoint: string, data?: any, options?: RequestInit) =>
    apiClient<T>(endpoint, {
      ...options,
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    }),
  put: <T>(endpoint: string, data?: any, options?: RequestInit) =>
    apiClient<T>(endpoint, {
      ...options,
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    }),
  patch: <T>(endpoint: string, data?: any, options?: RequestInit) =>
    apiClient<T>(endpoint, {
      ...options,
      method: 'PATCH',
      body: data ? JSON.stringify(data) : undefined,
    }),
  delete: <T>(endpoint: string, options?: RequestInit) =>
    apiClient<T>(endpoint, { ...options, method: 'DELETE' }),
};
