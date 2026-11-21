/**
 * Admin API Client Helper
 * 
 * Automatically attaches the stored admin token to every outgoing request.
 * If any request returns a 401 Unauthorized, it purges the local session and
 * immediately redirects the administrator to the login page.
 */

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

class ApiClient {
  constructor(baseUrl = BASE_URL) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
  }

  /**
   * Retrieve active admin JWT token from localStorage
   */
  getToken() {
    try {
      return localStorage.getItem('admin_token') || null;
    } catch {
      return null;
    }
  }

  /**
   * Set admin JWT token in localStorage
   */
  setToken(token) {
    try {
      if (token) {
        localStorage.setItem('admin_token', token);
      } else {
        localStorage.removeItem('admin_token');
      }
    } catch {
      // Ignore storage write errors (e.g. private browsing mode)
    }
  }

  /**
   * Clear admin session and redirect to login page
   */
  handleUnauthorized() {
    try {
      localStorage.removeItem('admin_token');
      localStorage.removeItem('admin_user');
    } catch {
      // Ignore
    }

    // Only redirect if not already on the login page
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      const redirectUrl = `/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`;
      window.location.href = redirectUrl;
    }
  }

  /**
   * Core request dispatcher with automatic auth headers and 401 interceptor
   */
  async request(endpoint, options = {}) {
    const url = endpoint.startsWith('http') ? endpoint : `${this.baseUrl}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;

    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    // Attach admin token if available
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
      // Network failure or rethrown HTTP error
      if (error.statusCode === 401) {
        throw error;
      }
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
