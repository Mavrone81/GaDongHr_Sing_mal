'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import EmployeeDashboard from '@/components/dashboard/EmployeeDashboard';
import ManagementDashboard from '@/components/dashboard/ManagementDashboard';

export default function DashboardPage() {
  const { user, loading } = useAuth();
  const [cachedAdmin, setCachedAdmin] = useState(false);

  useEffect(() => {
    // Check localStorage for resilient admin detection
    const stored = localStorage.getItem('ezyhrm_admin_confirmed');
    if (stored === '1') setCachedAdmin(true);

    // If user is confirmed admin, cache it
    if (user) {
      const email = (user.email || '').toLowerCase().trim();
      const role = (user.role || '').toUpperCase().trim();
      if (
        role === 'SUPER_ADMIN' || role === 'HR_ADMIN' || role === 'ADMIN' ||
        email === 'admin@ezyhrm.sg' || email === 'admin@hrms.com'
      ) {
        localStorage.setItem('ezyhrm_admin_confirmed', '1');
        setCachedAdmin(true);
      }
    }
  }, [user]);

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

  // BULLETPROOF ADMIN CHECK: Live API + localStorage cache
  const normalizedEmail = (user?.email || '').toLowerCase().trim();
  const isAdmin =
    user?.role === 'SUPER_ADMIN' ||
    user?.role === 'ADMIN' ||
    user?.role === 'HR_ADMIN' ||
    user?.role === 'HR_MANAGER' ||
    normalizedEmail === 'admin@ezyhrm.sg' ||
    normalizedEmail === 'admin@hrms.com' ||
    cachedAdmin;

  // Toggle between Executive Intelligence and Employee Workspace
  return isAdmin ? <ManagementDashboard /> : <EmployeeDashboard />;
}
