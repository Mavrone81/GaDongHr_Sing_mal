'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { clearTokens } from '@/lib/api';

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  employeeId: string | null;
  permissions: string[];
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  hasPermission: (permission: string) => boolean;
  hasRole: (role: string) => boolean;
  login: (token: string, refreshToken?: string | null) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL || `http://${hostname}:4000/api`;

  const applyUserData = (userData: any) => {
    // Role is taken verbatim from the server. The prior email-based override
    // (admin@gadonghr.sg / admin@hrms.com → SUPER_ADMIN) was a backdoor and
    // has been removed.
    const normalizedRole = (userData.role || 'EMPLOYEE').toUpperCase().trim();

    setUser({
      id: userData.id,
      name: userData.name,
      email: userData.email,
      role: normalizedRole,
      employeeId: userData.employeeId || null,
      permissions: normalizedRole === 'SUPER_ADMIN' ? [] : (userData.permissions || []),
    });
  };

  // Post C-12 the auth cookies are HttpOnly and credentials:'include' is
  // what attaches them. We no longer read or pass a Bearer token from JS.
  const fetchCurrentUser = async (): Promise<boolean> => {
    const response = await fetch(`${apiBaseUrl}/auth/me`, {
      credentials: 'include',
    });
    if (response.ok) {
      applyUserData(await response.json());
      return true;
    }
    return false;
  };

  useEffect(() => {
    const bootstrap = async () => {
      try {
        // Just probe /auth/me with credentials — the HttpOnly cookie will
        // come along if a valid session exists. If not, the user is logged out.
        await fetchCurrentUser();
      } catch (error) {
        console.error('[AUTH] bootstrap failed:', error);
      } finally {
        setLoading(false);
      }
    };

    bootstrap();
  }, []);

  // The two token args are accepted for backwards source-compat only —
  // they are not used (the server already set HttpOnly cookies on /auth/login).
  const login = async (_token?: string, _refreshToken?: string | null): Promise<void> => {
    try {
      const ok = await fetchCurrentUser();
      if (!ok) throw new Error('Identity fetch failed');
    } finally {
      setLoading(false);
    }
  };

  const hasPermission = (permission: string) => {
    if (user?.role === 'SUPER_ADMIN') return true;
    return user?.permissions.includes(permission) || false;
  };

  const hasRole = (role: string) => {
    return user?.role === role;
  };

  const logout = async () => {
    // Invalidate server-side refresh token and clear HttpOnly cookies.
    try {
      await fetch(`${apiBaseUrl}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch { /* best-effort */ }
    clearTokens(); // also clears any stale JS-readable cookies (transition cleanup)
    setUser(null);
    router.push('/login');
  };

  return (
    <AuthContext.Provider value={{ user, loading, hasPermission, hasRole, login, logout }}>
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
