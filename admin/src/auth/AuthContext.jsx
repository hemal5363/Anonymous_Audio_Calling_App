import React, { createContext, useState, useEffect, useCallback } from 'react';
import { apiClient } from '../api/client.js';
import { API_ENDPOINTS } from '../api/endpoints.js';

export const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // Access token and admin user profile are kept strictly in memory
  const [token, setToken] = useState(null);
  const [admin, setAdmin] = useState(null);
  const [loading, setLoading] = useState(false);

  // Sync state when apiClient intercepts a 401 Unauthorized response
  useEffect(() => {
    const unsubscribe = apiClient.onUnauthorized(() => {
      setToken(null);
      setAdmin(null);
    });
    return unsubscribe;
  }, []);

  const login = useCallback(async ({ email, password, totp_code }) => {
    setLoading(true);
    try {
      const data = await apiClient.post(API_ENDPOINTS.LOGIN, {
        email,
        password,
        totp_code: totp_code ? String(totp_code).trim() : undefined,
      });

      // Backend response format: { admin: { id, email, role }, token: "eyJhbGci..." }
      const authToken = data.token;
      const adminUser = data.admin;

      // Keep token strictly in memory
      apiClient.setToken(authToken);
      setToken(authToken);
      setAdmin(adminUser);

      return { success: true, data };
    } catch (error) {
      return { success: false, error };
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    // Purge in-memory credentials immediately
    apiClient.clearToken();
    setToken(null);
    setAdmin(null);
  }, []);

  const value = {
    token,
    admin,
    isAuthenticated: Boolean(token && admin),
    loading,
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
