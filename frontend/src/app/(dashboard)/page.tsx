'use client';

import React, { useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import EmployeeDashboard from '@/components/dashboard/EmployeeDashboard';
import ManagementDashboard from '@/components/dashboard/ManagementDashboard';

export default function DashboardPage() {
  const { user, loading } = useAuth();

  // SECURITY (M-07): one-time migration — drop the legacy
  // 'gadonghr_admin_confirmed' cache key so a stale value cannot influence
  // the management-vs-employee dashboard branch.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('gadonghr_admin_confirmed');
    }
  }, []);

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center bg-page">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-[3px] border-rule border-t-accent animate-spin rounded-full" />
          <p className="text-sm text-muted">Loading your dashboard…</p>
        </div>
      </div>
    );
  }

  // Admin dashboard branch — based on server-verified role only.
  const isAdmin =
    user?.role === 'SUPER_ADMIN' ||
    user?.role === 'ADMIN' ||
    user?.role === 'HR_ADMIN' ||
    user?.role === 'HR_MANAGER';

  return isAdmin ? <ManagementDashboard /> : <EmployeeDashboard />;
}
