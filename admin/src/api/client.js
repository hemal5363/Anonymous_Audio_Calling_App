/**
 * Admin API Client Helper
 * 
 * Manages HTTP communication with the backend API.
 * Keeps the admin access token strictly IN-MEMORY.
 * Does NOT persist tokens in localStorage, sessionStorage, or URL query parameters.
 * Automatically attaches Authorization header if present.
 * If any request returns a 401 Unauthorized, it resets the in-memory token
 * and notifies active listeners to update application state.
 */

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

class ApiClient {
  constructor(baseUrl = BASE_URL) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this._inMemoryToken = null;
    this._unauthorizedListeners = new Set();
  }

  /**
   * Get active admin JWT access token from memory
   */
  getToken() {
    return this._inMemoryToken;
  }

  /**
   * Set admin JWT access token in memory only
   */
  setToken(token) {
    this._inMemoryToken = token || null;
  }

  /**
   * Clear in-memory token
   */
  clearToken() {
    this._inMemoryToken = null;
  }

  /**
   * Subscribe to 401 Unauthorized events
   */
  onUnauthorized(callback) {
    this._unauthorizedListeners.add(callback);
    return () => {
      this._unauthorizedListeners.delete(callback);
    };
  }

  /**
   * Notify subscribers on 401 Unauthorized
   */
  handleUnauthorized() {
    this.clearToken();
    for (const listener of this._unauthorizedListeners) {
      try {
        listener();
      } catch (err) {
        console.error('Error in onUnauthorized listener:', err);
      }
    }
  }

  /**
   * Core request dispatcher with automatic auth header and 401 handling
   */
  async request(endpoint, options = {}) {
    const url = endpoint.startsWith('http')
      ? endpoint
      : `${this.baseUrl}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;

    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    // Attach in-memory admin token if present
    const token = this.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const config = {
      ...options,
      headers,
    };

    // Serialize body if object and not FormData/Blob
    if (config.body && typeof config.body === 'object' && !(config.body instanceof FormData)) {
      config.body = JSON.stringify(config.body);
    }

    try {
      const response = await fetch(url, config);

      // Handle 401 Unauthorized: token expired, invalid, or revoked
      if (response.status === 401) {
        this.handleUnauthorized();
        const errorData = await response.json().catch(() => ({}));
        const err = new Error(errorData.message || 'Unauthorized: session expired or invalid credentials');
        err.statusCode = 401;
        err.error = 'Unauthorized';
        err.details = errorData;
        throw err;
      }

      // Handle 204 No Content
      if (response.status === 204) {
        return null;
      }

      const data = await response.json().catch(() => ({}));

      // Handle other non-2xx error codes
      if (!response.ok) {
        const err = new Error(data.message || `Request failed with status ${response.status}`);
        err.statusCode = response.status;
        err.error = data.error || response.statusText;
        err.details = data;
        throw err;
      }

      return data;
    } catch (error) {
      throw error;
    }
  }

  get(endpoint, options = {}) {
    return this.request(endpoint, { ...options, method: 'GET' });
  }

  post(endpoint, body, options = {}) {
    return this.request(endpoint, { ...options, method: 'POST', body });
  }

  put(endpoint, body, options = {}) {
    return this.request(endpoint, { ...options, method: 'PUT', body });
  }

  patch(endpoint, body, options = {}) {
    return this.request(endpoint, { ...options, method: 'PATCH', body });
  }

  delete(endpoint, options = {}) {
    return this.request(endpoint, { ...options, method: 'DELETE' });
  }
}

export const apiClient = new ApiClient();
export default apiClient;
