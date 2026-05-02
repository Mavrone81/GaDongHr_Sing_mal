'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';

// ─── RBAC Navigation Matrix — Section 2, Vorkhive_RBAC_Workflow_Reference.pdf ──
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
    color: 'text-indigo-400',
    items: [
      { name: 'Dashboard', path: '/', icon: '⬡' },
    ]
  },
  {
    group: 'WORKFORCE',
    color: 'text-blue-400',
    items: [
      { name: 'Employees',   path: '/employees',           icon: '◈' },
      { name: 'Recruitment', path: '/recruitment',         icon: '◇' },
      { name: 'Attendance',  path: '/attendance/registry', icon: '◉' },
      { name: 'Leave',       path: '/leave/registry',      icon: '◌' },
      { name: 'Claims',      path: '/claims/registry',     icon: '◫' },
      { name: 'Performance', path: '/performance',         icon: '▣' },
      { name: 'Training',    path: '/training',            icon: '◑' },
      { name: 'Offboarding', path: '/offboarding',         icon: '◐' },
    ]
  },
  {
    group: 'EMPLOYEE',
    color: 'text-sky-400',
    items: [
      { name: 'My Attendance', path: '/attendance', icon: '◉' },
      { name: 'My Leave',      path: '/leave',      icon: '◌' },
      { name: 'My Claims',     path: '/claims',     icon: '◫' },
    ]
  },
  {
    group: 'FINANCIAL',
    color: 'text-emerald-400',
    items: [
      { name: 'Payroll', path: '/payroll', icon: '◆', badge: 'Action' },
      { name: 'Assets',  path: '/assets',  icon: '◧' },
    ]
  },
  {
    group: 'COMPLIANCE',
    color: 'text-amber-400',
    items: [
      { name: 'Reports', path: '/reports', icon: '▤' },
    ]
  },
  {
    group: 'ADMINISTRATION',
    color: 'text-violet-400',
    items: [
      { name: 'Tenancy & Config',   path: '/settings',          icon: '◎' },
      { name: 'User Management',    path: '/settings/users',    icon: '◪' },
      { name: 'Role & Permissions', path: '/settings/roles',    icon: '◧' },
      { name: 'Security (SSO/MFA)', path: '/settings/security', icon: '◰' },
      { name: 'Audit Logs',         path: '/settings/audit',    icon: '▤' },
      { name: 'Statutory Tables',   path: '/settings/rates',    icon: '▦' },
      { name: 'API & Webhooks',     path: '/settings/api',      icon: '◱' },
      { name: 'PDPA Compliance',    path: '/settings/pdpa',     icon: '▩' },
      { name: 'System Overrides',   path: '/settings/overrides',icon: '◒' },
    ]
  },
];

// HR Admin nav
const HR_ADMIN_NAV: NavGroup[] = [
  { group: 'COMMAND',    color: 'text-indigo-400',  items: [{ name: 'Dashboard', path: '/', icon: '⬡' }] },
  { group: 'WORKFORCE',  color: 'text-blue-400',    items: [
    { name: 'Employees',   path: '/employees',           icon: '◈' },
    { name: 'Recruitment', path: '/recruitment',         icon: '◇' },
    { name: 'Attendance',  path: '/attendance/registry', icon: '◉' },
    { name: 'Leave',       path: '/leave/registry',      icon: '◌' },
    { name: 'Claims',      path: '/claims/registry',     icon: '◫' },
    { name: 'Performance', path: '/performance',         icon: '▣' },
    { name: 'Training',    path: '/training',            icon: '◑' },
  ]},
  { group: 'EMPLOYEE',   color: 'text-sky-400',     items: [
    { name: 'My Attendance', path: '/attendance', icon: '◉' },
    { name: 'My Leave',      path: '/leave',      icon: '◌' },
    { name: 'My Claims',     path: '/claims',     icon: '◫' },
  ]},
  { group: 'FINANCIAL',  color: 'text-emerald-400', items: [
    { name: 'Payroll', path: '/payroll', icon: '◆' },
  ]},
  { group: 'COMPLIANCE', color: 'text-amber-400',   items: [{ name: 'Reports', path: '/reports', icon: '▤' }] },
  { group: 'ADMIN',      color: 'text-violet-400',  items: [{ name: 'User Management', path: '/settings/users', icon: '◪' }] },
];

// Payroll Officer nav
const PAYROLL_OFFICER_NAV: NavGroup[] = [
  { group: 'COMMAND',    color: 'text-indigo-400',  items: [{ name: 'Dashboard', path: '/', icon: '⬡' }] },
  { group: 'WORKFORCE',  color: 'text-blue-400',    items: [
    { name: 'Employees',  path: '/employees',           icon: '◈' },
    { name: 'Attendance', path: '/attendance/registry', icon: '◉' },
    { name: 'Leave',      path: '/leave/registry',      icon: '◌' },
    { name: 'Claims',     path: '/claims/registry',     icon: '◫' },
  ]},
  { group: 'EMPLOYEE',   color: 'text-sky-400',     items: [
    { name: 'My Attendance', path: '/attendance', icon: '◉' },
    { name: 'My Leave',      path: '/leave',      icon: '◌' },
    { name: 'My Claims',     path: '/claims',     icon: '◫' },
  ]},
  { group: 'FINANCIAL',  color: 'text-emerald-400', items: [
    { name: 'Payroll', path: '/payroll', icon: '◆', badge: 'Action' },
  ]},
  { group: 'COMPLIANCE', color: 'text-amber-400',   items: [
    { name: 'Reports', path: '/reports', icon: '▤' },
  ]},
];

// Employee ESS nav — default inherited role for all employees
const EMPLOYEE_NAV: NavGroup[] = [
  { group: 'OVERVIEW',  color: 'text-indigo-400',  items: [{ name: 'Dashboard', path: '/', icon: '⬡' }] },
  { group: 'EMPLOYEE',  color: 'text-sky-400',     items: [
    { name: 'My Attendance', path: '/attendance', icon: '◉' },
    { name: 'My Leave',      path: '/leave',      icon: '◌' },
    { name: 'My Claims',     path: '/claims',     icon: '◫' },
  ]},
  { group: 'PAYSLIPS',  color: 'text-emerald-400', items: [
    { name: 'My Payslips', path: '/payroll', icon: '◆' },
  ]},
  { group: 'SUPPORT',   color: 'text-slate-400',   items: [
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
  if (r === 'SUPER_ADMIN' || e === 'admin@vorkhive.sg' || e === 'admin@hrms.com' || cached) return SUPER_ADMIN_NAV;
  if (r === 'HR_ADMIN' || r === 'ADMIN') return HR_ADMIN_NAV;
  if (r === 'HR_MANAGER') return HR_ADMIN_NAV;
  if (r === 'PAYROLL_OFFICER') return PAYROLL_OFFICER_NAV;
  return EMPLOYEE_NAV;
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading, logout } = useAuth();

  // Lazy-init from localStorage so first render shows correct nav immediately
  const [cachedAdmin, setCachedAdmin] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('vorkhive_admin_confirmed') === '1';
  });

  useEffect(() => {
    if (!user) return;
    const email = (user.email || '').toLowerCase().trim();
    const role = (user.role || '').toUpperCase().trim();
    const isAdmin =
      role === 'SUPER_ADMIN' || role === 'HR_ADMIN' || role === 'ADMIN' ||
      email === 'admin@vorkhive.sg' || email === 'admin@hrms.com';
    if (isAdmin) {
      localStorage.setItem('vorkhive_admin_confirmed', '1');
      localStorage.setItem('vorkhive_user_role', role === 'SUPER_ADMIN' || email === 'admin@vorkhive.sg' || email === 'admin@hrms.com' ? 'SUPER_ADMIN' : role);
      setCachedAdmin(true);
    }
  }, [user]);

  const liveEmail = (user?.email || '').toLowerCase().trim();
  const liveRole  = (user?.role  || '').toUpperCase().trim();
  const isSuperAdmin = liveRole === 'SUPER_ADMIN' || liveEmail === 'admin@vorkhive.sg' || liveEmail === 'admin@hrms.com' || cachedAdmin;

  // Redirect unauthenticated users to login
  useEffect(() => {
    if (!loading && !user && !cachedAdmin) {
      router.replace('/login');
    }
  }, [loading, user, cachedAdmin]);

  const authErrorBanner = null;

  const cachedRole = typeof window !== 'undefined' ? (localStorage.getItem('vorkhive_user_role') || '') : '';
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
      <aside className="w-64 bg-[#0a0f1e] flex flex-col z-50 shadow-2xl shadow-black/60 shrink-0 relative">
        {/* Subtle gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-b from-indigo-950/20 via-transparent to-indigo-950/10 pointer-events-none" />

        {/* Brand */}
        <div className="relative px-5 pt-5 pb-4 border-b border-white/5 flex items-center gap-3">
          <div className="w-9 h-9 bg-gradient-to-br from-indigo-500 to-indigo-700 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/40 shrink-0">
            <span className="font-black text-white text-sm italic">V</span>
          </div>
          <div className="flex flex-col min-w-0">
            <span className="font-black text-white tracking-wider text-sm leading-none">Vorkhive</span>
            <span className="text-[8px] font-bold text-indigo-400/50 mt-1 tracking-widest uppercase truncate">SG Compliance · v2</span>
          </div>
        </div>

        {/* Role badge */}
        <div className="relative mx-3 mt-3">
          <div className={`px-3 py-2 rounded-xl border flex items-center gap-2.5 ${
            isSuperAdmin
              ? 'bg-indigo-600/10 border-indigo-500/20'
              : 'bg-white/3 border-white/6'
          }`}>
            <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${roleInfo.dot} ${isSuperAdmin ? 'animate-pulse' : ''}`} />
            <span className={`text-[9px] font-black uppercase tracking-widest truncate ${roleInfo.color}`}>
              {isSuperAdmin ? 'Full System Access' : roleInfo.label}
            </span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="relative flex-1 overflow-y-auto py-3 px-2.5 space-y-4 custom-scrollbar mt-1">
          {navGroups.map((group) => (
            <div key={group.group}>
              {/* Group label */}
              <div className="flex items-center gap-2 px-2 mb-1">
                <span className={`text-[7.5px] font-black uppercase tracking-[0.3em] ${group.color} opacity-70`}>{group.group}</span>
                <div className="flex-1 h-px bg-white/5" />
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
                      className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[11px] font-bold tracking-wide transition-all duration-200 group relative ${
                        isActive
                          ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/25'
                          : 'text-slate-400 hover:bg-white/5 hover:text-slate-100'
                      }`}
                    >
                      {isActive && (
                        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-white/60 rounded-full" />
                      )}
                      <span className={`text-xs shrink-0 w-5 text-center transition-colors ${isActive ? 'text-white' : 'text-slate-600 group-hover:text-indigo-400'}`}>
                        {item.icon}
                      </span>
                      <span className="flex-1 truncate">{item.name}</span>
                      {item.badge && (
                        <span className="text-[7px] font-black px-1.5 py-0.5 bg-amber-400 text-slate-900 rounded-md uppercase tracking-wide shrink-0">
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
        <div className="relative p-3 border-t border-white/5">
          <div className="flex items-center gap-2.5 p-3 rounded-xl bg-white/4 border border-white/6 mb-2 cursor-default">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-black shrink-0 ${
              isSuperAdmin ? 'bg-indigo-600/30 text-indigo-200' : 'bg-white/10 text-slate-300'
            }`}>
              {user?.name?.substring(0, 2).toUpperCase() || (isSuperAdmin ? 'SA' : 'U')}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold text-slate-200 truncate">
                {user?.name || (isSuperAdmin ? 'Administrator' : 'User')}
              </p>
              <p className="text-[8px] text-slate-500 truncate mt-0.5 uppercase tracking-wider">
                {user?.email || ''}
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              localStorage.removeItem('vorkhive_admin_confirmed');
              localStorage.removeItem('vorkhive_user_role');
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
