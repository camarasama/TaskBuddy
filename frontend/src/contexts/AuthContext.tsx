// frontend/src/contexts/AuthContext.tsx
'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { authApi, setAccessToken, getAccessToken } from '@/lib/api';

interface AuthUser {
  id: string;
  email?: string;
  firstName: string;
  lastName: string;
  role: string;
  familyId: string;
  avatarUrl?: string;
  profile?: any;
  family?: any;
}

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isParent: boolean;
  isChild: boolean;
  // M8 — Admin role flag; used by admin route guard
  isAdmin: boolean;
  login: (email: string, password: string) => Promise<void>;
  childLogin: (familyCode: string, childIdentifier: string, pin: string) => Promise<void>;
  register: (familyName: string, parent: {
    firstName: string;
    lastName: string;
    email: string;
    password: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  // Load user on mount
  useEffect(() => {
    const loadUser = async () => {
      const token = getAccessToken();
      if (!token) {
        setIsLoading(false);
        return;
      }

      try {
        const response = await authApi.me();
        if (response.data) {
          setUser(response.data.user as AuthUser);
        }
      } catch {
        setAccessToken(null);
      } finally {
        setIsLoading(false);
      }
    };

    loadUser();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const response = await authApi.login({ email, password });
    if (!response.data) {
      throw new Error('Invalid response from server');
    }
    setAccessToken(response.data.tokens.accessToken);
    setUser(response.data.user as AuthUser);

    // M8 — Redirect admin to admin dashboard, parents to parent dashboard
    if (response.data.user.role === 'admin') {
      router.push('/admin/dashboard');
    } else if (response.data.user.role === 'parent') {
      router.push('/parent/dashboard');
    } else {
      router.push('/child/dashboard');
    }
  }, [router]);

  // FIXED: Use familyCode (not familyId) to match backend schema
  const childLogin = useCallback(async (
    familyCode: string,
    childIdentifier: string,
    pin: string
  ) => {
    const response = await authApi.childLogin({ familyCode, childIdentifier, pin });
    if (!response.data) {
      throw new Error('Invalid response from server');
    }
    setAccessToken(response.data.tokens.accessToken);
    setUser(response.data.user as AuthUser);
    router.push('/child/dashboard');
  }, [router]);

  const register = useCallback(async (
    familyName: string,
    parent: {
      firstName: string;
      lastName: string;
      email: string;
      password: string;
    }
  ) => {
    const response = await authApi.register({ familyName, parent });
    if (!response.data) {
      throw new Error('Invalid response from server');
    }
    setAccessToken(response.data.tokens.accessToken);
    setUser(response.data.user as AuthUser);
    router.push('/parent/dashboard');
  }, [router]);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      setAccessToken(null);
      setUser(null);
      router.push('/');
    }
  }, [router]);

  const refreshUser = useCallback(async () => {
    try {
      const response = await authApi.me();
      if (response.data) {
        setUser(response.data.user as AuthUser);
      }
    } catch {
      // Failed to refresh, logout
      setAccessToken(null);
      setUser(null);
    }
  }, []);

  const value: AuthContextType = {
    user,
    isLoading,
    isAuthenticated: !!user,
    isParent: user?.role === 'parent',
    isChild: user?.role === 'child',
    // M8 — Admin role flag
    isAdmin: user?.role === 'admin',
    login,
    childLogin,
    register,
    logout,
    refreshUser,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}