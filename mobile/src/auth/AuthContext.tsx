import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { tokenStorage } from './tokenStorage';
import { api, setOnUnauthorizedCallback } from '../api/client';
import { connectSocket, disconnectSocket } from '../socket';
import { unregisterPushToken } from '../push/pushService';

export interface User {
  id: string;
  email?: string | null;
  phone?: string | null;
  status: string;
  is_available: boolean;
  created_at?: string;
}

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  requestOtp: (phone: string) => Promise<{ message: string; expires_in_seconds: number }>;
  verifyOtp: (phone: string, otp: string) => Promise<void>;
  logout: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  updateUser: (user: Partial<User>) => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Set up 401 unauth handler to log out user if refresh fails
  useEffect(() => {
    setOnUnauthorizedCallback(() => {
      setUser(null);
      disconnectSocket();
    });
    return () => setOnUnauthorizedCallback(null);
  }, []);

  // Check stored tokens and restore session on mount
  useEffect(() => {
    async function restoreSession() {
      try {
        const token = await tokenStorage.getAccessToken();
        if (token) {
          // Fetch current user profile
          const res = await api.get<{ user: User }>('/user/me').catch(async () => {
            // If /user/me fails, try checking token validity or fallback
            return null;
          });

          if (res?.user) {
            setUser(res.user);
            connectSocket().catch(() => {});
          } else {
            // Check if we still have tokens
            const refreshedToken = await tokenStorage.getAccessToken();
            if (refreshedToken) {
              connectSocket().catch(() => {});
            }
          }
        }
      } catch (err) {
        // Token invalid or network offline
      } finally {
        setIsLoading(false);
      }
    }

    restoreSession();
  }, []);

  const login = async (email: string, password: string) => {
    const res = await api.post<{
      user: User;
      tokens: { accessToken: string; refreshToken: string };
    }>('/auth/login', { email, password });

    await tokenStorage.setTokens(res.tokens.accessToken, res.tokens.refreshToken);
    setUser(res.user);
    await connectSocket();
  };

  const register = async (email: string, password: string) => {
    const res = await api.post<{
      user: User;
      tokens: { accessToken: string; refreshToken: string };
    }>('/auth/register', {
      email,
      password,
      confirm_age_18: true,
      terms_version: '1.0',
      privacy_version: '1.0',
    });

    await tokenStorage.setTokens(res.tokens.accessToken, res.tokens.refreshToken);
    setUser(res.user);
    await connectSocket();
  };

  const requestOtp = async (phone: string) => {
    return await api.post<{ message: string; expires_in_seconds: number }>('/auth/otp/request', {
      phone,
    });
  };

  const verifyOtp = async (phone: string, otp: string) => {
    const res = await api.post<{
      user: User;
      tokens: { accessToken: string; refreshToken: string };
    }>('/auth/otp/verify', { phone, otp });

    await tokenStorage.setTokens(res.tokens.accessToken, res.tokens.refreshToken);
    setUser(res.user);
    await connectSocket();
  };

  const logout = async () => {
    try {
      await unregisterPushToken().catch(() => {});
      const refreshToken = await tokenStorage.getRefreshToken();
      if (refreshToken) {
        await api.post('/auth/logout', { refreshToken }).catch(() => {});
      }
    } finally {
      await tokenStorage.clearTokens();
      disconnectSocket();
      setUser(null);
    }
  };

  const deleteAccount = async () => {
    try {
      await unregisterPushToken().catch(() => {});
      await api.delete('/user/account');
    } finally {
      await tokenStorage.clearTokens();
      disconnectSocket();
      setUser(null);
    }
  };

  const updateUser = (partial: Partial<User>) => {
    setUser((prev) => (prev ? { ...prev, ...partial } : null));
  };

  const refreshUser = async () => {
    try {
      const res = await api.get<{ user: User }>('/user/me');
      if (res?.user) {
        setUser(res.user);
      }
    } catch {
      // Ignore
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        register,
        requestOtp,
        verifyOtp,
        logout,
        deleteAccount,
        updateUser,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
