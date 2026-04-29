'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';

// ─── RBAC Navigation Matrix — Section 2, EzyHRM_RBAC_Workflow_Reference.pdf ──
// SA = Superadmin (full, unrestricted access to ALL modules)
interface NavItem {
  name: string;
  path: string;
  icon: string;
  badge?: string;
}

interface NavGroup {
  group: string;
  color: string;
  items: NavItem[];
}

const SUPER_ADMIN_NAV: NavGroup[] = [
  {
    group: 'COMMAND',
    color: 'text-indigo-500',
    items: [
      { name: 'Dashboard', path: '/', icon: '⬡' },
    ]
  },
  {
    group: 'WORKFORCE',
    color: 'text-blue-400',
    items: [
      { name: 'Employees',     path: '/employees',    icon: '◈' },
      { name: 'Recruitment',   path: '/recruitment',  icon: '◇' },
      { name: 'Attendance',    path: '/attendance',   icon: '◉' },
      { name: 'Performance',   path: '/performance',  icon: '▣' },
      { name: 'Training',      path: '/training',     icon: '◑' },
      { name: 'Offboarding',   path: '/offboarding',  icon: '◐' },
    ]
  },
  {
    group: 'FINANCIAL',
    color: 'text-emerald-400',
    items: [
      { name: 'Payroll',       path: '/payroll',      icon: '◆', badge: 'Action' },
      { name: 'Leave',         path: '/leave',        icon: '◌' },
      { name: 'Claims',        path: '/claims',       icon: '◫' },
      { name: 'Assets',        path: '/assets',       icon: '◧' },
    ]
  },
  {
    group: 'COMPLIANCE',
    color: 'text-amber-400',
    items: [
      { name: 'Reports',       path: '/reports',      icon: '▤' },
    ]
  },
  {
    group: 'ADMINISTRATION',
    color: 'text-violet-400',
    items: [
      { name: 'Tenancy & Config',    path: '/settings',        icon: '◎' },
      { name: 'User Management',     path: '/settings/users',  icon: '◪' },
      { name: 'Role & Permissions',  path: '/settings/roles',  icon: '◧' },
      { name: 'Security (SSO/MFA)',  path: '/settings/security', icon: '◰' },
      { name: 'Audit Logs',          path: '/settings/audit',  icon: '▤' },
      { name: 'Statutory Tables',    path: '/settings/rates',  icon: '▦' },
      { name: 'API & Webhooks',      path: '/settings/api',    icon: '◱' },
      { name: 'PDPA Compliance',     path: '/settings/pdpa',   icon: '▩' },
      { name: 'System Overrides',    path: '/settings/overrides', icon: '◒' },
    ]
  },
];

// HR Admin nav (Y = Full access per matrix)
const HR_ADMIN_NAV: NavGroup[] = [
  { group: 'COMMAND',    color: 'text-indigo-500', items: [{ name: 'Dashboard', path: '/', icon: '⬡' }] },
  { group: 'WORKFORCE',  color: 'text-blue-400',   items: [
    { name: 'Employees', path: '/employees', icon: '◈' },
    { name: 'Recruitment', path: '/recruitment', icon: '◇' },
    { name: 'Attendance', path: '/attendance', icon: '◉' },
    { name: 'Performance', path: '/performance', icon: '▣' },
    { name: 'Training', path: '/training', icon: '◑' },
  ]},
  { group: 'FINANCIAL',  color: 'text-emerald-400', items: [
    { name: 'Payroll', path: '/payroll', icon: '◆' },
    { name: 'Leave', path: '/leave', icon: '◌' },
    { name: 'Claims', path: '/claims', icon: '◫' },
  ]},
  { group: 'COMPLIANCE', color: 'text-amber-400',  items: [{ name: 'Reports', path: '/reports', icon: '▤' }] },
  { group: 'ADMIN',      color: 'text-violet-400',  items: [{ name: 'User Management', path: '/settings/users', icon: '◪' }] },
];

// Payroll Officer nav (full payroll access, limited HR)
const PAYROLL_OFFICER_NAV: NavGroup[] = [
  { group: 'COMMAND',    color: 'text-indigo-500', items: [{ name: 'Dashboard', path: '/', icon: '⬡' }] },
  { group: 'WORKFORCE',  color: 'text-blue-400',   items: [
    { name: 'Employees',  path: '/employees',  icon: '◈' },
    { name: 'Attendance', path: '/attendance', icon: '◉' },
  ]},
  { group: 'FINANCIAL',  color: 'text-emerald-400', items: [
    { name: 'Payroll',  path: '/payroll',  icon: '◆', badge: 'Action' },
    { name: 'Leave',    path: '/leave',    icon: '◌' },
    { name: 'Claims',   path: '/claims',   icon: '◫' },
  ]},
  { group: 'COMPLIANCE', color: 'text-amber-400', items: [
    { name: 'Reports', path: '/reports', icon: '▤' },
  ]},
];

// Employee ESS nav (own records only)
const EMPLOYEE_NAV: NavGroup[] = [
  { group: 'MY WORKSPACE', color: 'text-indigo-400', items: [{ name: 'Dashboard', path: '/', icon: '⬡' }] },
  { group: 'SELF SERVICE', color: 'text-blue-400',   items: [
    { name: 'My Leave',      path: '/leave',      icon: '◌' },
    { name: 'My Claims',     path: '/claims',     icon: '◫' },
    { name: 'My Payslips',   path: '/payroll',    icon: '◆' },
    { name: 'My Attendance', path: '/attendance', icon: '◉' },
  ]},
  { group: 'SUPPORT', color: 'text-slate-400', items: [
    { name: 'Staff Directory', path: '/staff',   icon: '◈' },
    { name: 'Help & Support',  path: '/support', icon: '◇' },
  ]},
];

const ROLE_LABELS: Record<string, { label: string; color: string; dot: string }> = {
  SUPER_ADMIN:      { label: 'Super Admin',      color: 'text-indigo-300', dot: 'bg-indigo-500' },
  HR_ADMIN:         { label: 'HR Admin',          color: 'text-violet-300', dot: 'bg-violet-500' },
  HR_MANAGER:       { label: 'HR Manager',        color: 'text-blue-300',   dot: 'bg-blue-500'   },
  PAYROLL_OFFICER:  { label: 'Payroll Officer',   color: 'text-emerald-300',dot: 'bg-emerald-500'},
  RECRUITER:        { label: 'Recruiter',         color: 'text-amber-300',  dot: 'bg-amber-500'  },
  TRAINING_MANAGER: { label: 'Training Mgr',      color: 'text-orange-300', dot: 'bg-orange-500' },
  LINE_MANAGER:     { label: 'Line Manager',      color: 'text-sky-300',    dot: 'bg-sky-500'    },
  FINANCE_ADMIN:    { label: 'Finance Admin',     color: 'text-teal-300',   dot: 'bg-teal-500'   },
  IT_ADMIN:         { label: 'IT Admin',          color: 'text-red-300',    dot: 'bg-red-500'    },
  EMPLOYEE:         { label: 'Employee',          color: 'text-slate-400',  dot: 'bg-slate-600'  },
};

function getNavGroups(role: string, email: string, cached: boolean) {
  const r = role.toUpperCase();
  const e = email.toLowerCase();
  if (r === 'SUPER_ADMIN' || e === 'admin@ezyhrm.sg' || e === 'admin@hrms.com' || cached) return SUPER_ADMIN_NAV;
  if (r === 'HR_ADMIN' || r === 'ADMIN') return HR_ADMIN_NAV;
  if (r === 'HR_MANAGER') return HR_ADMIN_NAV;
  if (r === 'PAYROLL_OFFICER') return PAYROLL_OFFICER_NAV;
  return EMPLOYEE_NAV;
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, loading, logout } = useAuth();

  // Lazy-init from localStorage so first render shows correct nav immediately
  const [cachedAdmin, setCachedAdmin] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('ezyhrm_admin_confirmed') === '1';
  });

  useEffect(() => {
    if (!user) return;
    const email = (user.email || '').toLowerCase().trim();
    const role = (user.role || '').toUpperCase().trim();
    const isAdmin =
      role === 'SUPER_ADMIN' || role === 'HR_ADMIN' || role === 'ADMIN' ||
      email === 'admin@ezyhrm.sg' || email === 'admin@hrms.com';
    if (isAdmin) {
      localStorage.setItem('ezyhrm_admin_confirmed', '1');
      localStorage.setItem('ezyhrm_user_role', role === 'SUPER_ADMIN' || email === 'admin@ezyhrm.sg' || email === 'admin@hrms.com' ? 'SUPER_ADMIN' : role);
      setCachedAdmin(true);
    }
  }, [user]);

  const liveEmail = (user?.email || '').toLowerCase().trim();
  const liveRole  = (user?.role  || '').toUpperCase().trim();
  const isSuperAdmin = liveRole === 'SUPER_ADMIN' || liveEmail === 'admin@ezyhrm.sg' || liveEmail === 'admin@hrms.com' || cachedAdmin;

  // VISUAL DIAGNOSTIC BANNER IF USER IS NULL AFTER LOADING
  const authErrorBanner = !loading && !user ? (
    <div className="absolute top-0 left-0 w-full z-[999] bg-red-600 text-white p-4 font-bold text-center text-xs animate-pulse shadow-2xl">
      CRITICAL ERROR: AuthContext failed to fetch user identity from /auth/me. Network or CORS failure occurred. Check browser console!
    </div>
  ) : null;

  const cachedRole = typeof window !== 'undefined' ? (localStorage.getItem('ezyhrm_user_role') || '') : '';
  const effectiveRole = liveRole || cachedRole;
  const roleInfo = ROLE_LABELS[effectiveRole] || ROLE_LABELS['EMPLOYEE'];

  const navGroups = getNavGroups(effectiveRole, liveEmail, cachedAdmin);

  // Page title from path
  const getPageTitle = () => {
    const seg = pathname.split('/').filter(Boolean);
    if (!seg.length) return 'Command Centre';
    return seg[seg.length - 1].replace(/-/g, ' ').replace(/\//g, ' › ').toUpperCase();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-6">
          <div className="relative w-16 h-16">
            <div className="absolute inset-0 border-4 border-indigo-600/20 border-t-indigo-600 rounded-full animate-spin"></div>
            <div className="absolute inset-3 border-4 border-slate-800 border-t-indigo-400/40 rounded-full animate-spin [animation-direction:reverse] [animation-duration:0.6s]"></div>
          </div>
          <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.4em] animate-pulse">Authenticating Identity...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-100 font-sans overflow-hidden selection:bg-indigo-100 selection:text-indigo-900 relative">
      {authErrorBanner}

      {/* ── SIDEBAR ─────────────────────────────────────────────────────────── */}
      <aside className="w-72 bg-slate-950 flex flex-col border-r border-slate-900/50 z-50 shadow-2xl shadow-black/50 shrink-0">

        {/* Brand */}
        <div className="px-6 py-5 border-b border-slate-900 flex items-center gap-3.5 group cursor-default relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-indigo-600/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
          <div className="w-10 h-10 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-xl shadow-indigo-500/30 group-hover:scale-110 transition-transform duration-500 shrink-0">
            <span className="font-black text-white text-base italic">E</span>
          </div>
          <div className="flex flex-col">
            <span className="font-black text-white tracking-[0.12em] text-sm leading-none">EzyHRM</span>
            <span className="text-[8px] font-black text-indigo-400/60 mt-1.5 tracking-[0.3em] uppercase">Enterprise v2 · SG Compliance</span>
          </div>
        </div>

        {/* SA Identity Badge */}
        {isSuperAdmin && (
          <div className="mx-4 mt-4 px-4 py-2.5 bg-indigo-600/10 border border-indigo-600/20 rounded-2xl flex items-center gap-3">
            <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-pulse shrink-0" />
            <span className="text-[8px] font-black text-indigo-400 uppercase tracking-[0.3em] leading-tight">Full System Access · All Modules</span>
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-5 custom-scrollbar">
          {navGroups.map((group) => (
            <div key={group.group}>
              {/* Group label */}
              <div className="flex items-center gap-2 px-3 mb-1.5">
                <span className={`text-[7px] font-black uppercase tracking-[0.35em] ${group.color}`}>{group.group}</span>
                <div className="flex-1 h-px bg-slate-900" />
              </div>
              {/* Items */}
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const isActive = pathname === item.path ||
                    (item.path !== '/' && pathname.startsWith(item.path));
                  return (
                    <Link
                      key={item.path}
                      href={item.path}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-[10px] font-black tracking-[0.12em] transition-all duration-200 group relative overflow-hidden ${
                        isActive
                          ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20'
                          : 'text-slate-500 hover:bg-slate-900 hover:text-slate-100'
                      }`}
                    >
                      <span className={`text-sm shrink-0 transition-colors ${isActive ? 'text-white' : 'text-slate-700 group-hover:text-indigo-400'}`}>
                        {item.icon}
                      </span>
                      <span className="flex-1 truncate">{item.name}</span>
                      {item.badge && (
                        <span className="text-[7px] font-black px-1.5 py-0.5 bg-amber-500 text-slate-950 rounded-full uppercase tracking-wider shrink-0">
                          {item.badge}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* User Footer */}
        <div className="p-3 border-t border-slate-900/80">
          <div className="flex items-center gap-3 p-3 rounded-2xl bg-slate-900/50 border border-slate-800/40 mb-2 group hover:border-slate-700 transition-all cursor-default">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-[10px] font-black border shrink-0 ${
              isSuperAdmin ? 'bg-indigo-600/20 border-indigo-600/30 text-indigo-300' : 'bg-slate-800 border-slate-700 text-slate-400'
            }`}>
              {user?.name?.substring(0, 2).toUpperCase() || (isSuperAdmin ? 'SA' : 'ID')}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-black text-slate-100 truncate uppercase tracking-wider">
                {user?.name || (isSuperAdmin ? 'System Administrator' : 'User')}
              </p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <div className={`w-1 h-1 rounded-full shrink-0 ${roleInfo.dot}`} />
                <p className={`text-[8px] font-black uppercase tracking-widest truncate ${roleInfo.color}`}>
                  {roleInfo.label}
                </p>
              </div>
            </div>
          </div>
          <button
            onClick={() => {
              localStorage.removeItem('ezyhrm_admin_confirmed');
              localStorage.removeItem('ezyhrm_user_role');
              logout();
            }}
            className="w-full py-2 text-[8px] font-black text-slate-600 hover:text-red-400 transition-all uppercase tracking-[0.3em] border border-slate-900 rounded-xl hover:bg-red-500/5 hover:border-red-500/20 active:scale-95"
          >
            ⬡ Terminate Session
          </button>
        </div>
      </aside>

      {/* ── MAIN CONTENT ─────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="h-14 bg-white border-b border-slate-200 px-8 flex items-center justify-between sticky top-0 z-40 shadow-sm shrink-0">
          <div className="flex items-center gap-4">
            <div className="w-0.5 h-5 bg-indigo-600 rounded-full" />
            <h2 className="text-[11px] font-black text-slate-900 uppercase tracking-[0.25em]">{getPageTitle()}</h2>
            {isSuperAdmin && (
              <span className="hidden sm:inline text-[7px] font-black px-2.5 py-1 bg-indigo-50 text-indigo-600 border border-indigo-100 rounded-full uppercase tracking-widest">
                Super Admin · Full Access
              </span>
            )}
          </div>
          <div className="flex items-center gap-5">
            <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-50 border border-slate-100">
              <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_5px_rgba(16,185,129,0.5)]" />
              <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">System: <span className="text-emerald-600">Online</span></span>
            </div>
            <div className="h-4 w-px bg-slate-200" />
            <div className="flex flex-col items-end">
              <p className="text-[8px] font-black text-slate-700 uppercase tracking-[0.15em] leading-none">v1.1.0</p>
              <p className="text-[7px] font-bold text-slate-300 mt-0.5 uppercase tracking-widest leading-none">SG Compliance</p>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto p-6 lg:p-8 custom-scrollbar bg-slate-50">
          <div className="max-w-[1500px] mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
