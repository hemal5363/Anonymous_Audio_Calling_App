import React, { createContext, useState, useEffect, useCallback } from 'react';
import { apiClient } from '../api/client.js';
import { API_ENDPOINTS } from '../api/endpoints.js';

export const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setTokenState] = useState(() => apiClient.getToken());
  const [admin, setAdminState] = useState(() => {
    try {
      const saved = localStorage.getItem('admin_user');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(false);

  // Sync token changes to apiClient and localStorage
  const setAuthData = useCallback((newToken, newAdmin) => {
    apiClient.setToken(newToken);
    setTokenState(newToken);

    if (newAdmin) {
      try {
        localStorage.setItem('admin_user', JSON.stringify(newAdmin));
      } catch {}
      setAdminState(newAdmin);
    } else {
      try {
        localStorage.removeItem('admin_user');
      } catch {}
      setAdminState(null);
    }
  }, []);

  const login = useCallback(
    async ({ email, password, totp_code }) => {
      setLoading(true);
      try {
        const data = await apiClient.post(API_ENDPOINTS.LOGIN, {
          email,
          password,
          totp_code: totp_code || undefined,
        });

        // Backend response format: { admin: { id, email, role }, token: "eyJhbGci..." }
        const authToken = data.token;
        const adminUser = data.admin;

        setAuthData(authToken, adminUser);
        return { success: true, data };
      } catch (error) {
        return { success: false, error };
      } finally {
        setLoading(false);
      }
    },
    [setAuthData]
  );

  const logout = useCallback(() => {
    setAuthData(null, null);
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.href = '/login';
    }
  }, [setAuthData]);

  const value = {
    token,
    admin,
    isAuthenticated: Boolean(token),
    loading,
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
