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
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-indigo-600"></div>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] animate-pulse">Syncing Enterprise Intelligence...</p>
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
