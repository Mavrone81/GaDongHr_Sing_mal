'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  permissions: string[];
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  hasPermission: (permission: string) => boolean;
  hasRole: (role: string) => boolean;
  login: (token: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL || `http://${hostname}:4000/api`;

  const applyUserData = (userData: any) => {
    const userEmail = (userData.email || '').toLowerCase().trim();
    const isSystemAdmin =
      userEmail === 'admin@ezyhrm.sg' ||
      userEmail === 'admin@hrms.com' ||
      userEmail === 'admin@urbanwerkz.com';

    let normalizedRole = (userData.role || 'EMPLOYEE').toUpperCase().trim();
    if (isSystemAdmin || normalizedRole === 'SUPER_ADMIN' || normalizedRole === 'ADMIN') {
      normalizedRole = 'SUPER_ADMIN';
    }

    setUser({
      id: userData.id,
      name: userData.name,
      email: userData.email,
      role: normalizedRole,
      permissions: normalizedRole === 'SUPER_ADMIN' ? [] : (userData.permissions || []),
    });
  };

  const fetchUserWithToken = async (token: string): Promise<boolean> => {
    const response = await fetch(`${apiBaseUrl}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
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
        const tokenCookie = document.cookie
          .split('; ')
          .find(row => row.startsWith('ezyhrm_token='));
        const token = tokenCookie ? tokenCookie.split('=').slice(1).join('=') : undefined;

        if (!token) return;

        const ok = await fetchUserWithToken(token);
        if (!ok) logout();
      } catch (error) {
        console.error('[AUTH] bootstrap failed:', error);
      } finally {
        setLoading(false);
      }
    };

    bootstrap();
  }, []);

  const login = async (token: string): Promise<void> => {
    document.cookie = `ezyhrm_token=${token}; path=/; max-age=3600; SameSite=Lax`;
    try {
      const ok = await fetchUserWithToken(token);
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

  const logout = () => {
    document.cookie = 'ezyhrm_token=; Max-Age=0; path=/';
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
