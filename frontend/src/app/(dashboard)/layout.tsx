'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import NotificationBell from '@/components/NotificationBell';
import FloatingAssistant from '@/components/FloatingAssistant';
import TrialBanner from '@/components/TrialBanner';
import GaDongLogo from '@/components/GaDongLogo';
import CommandPalette from '@/components/CommandPalette';
import { Icon, Badge, type IconName } from '@/components/ui';

// ─── RBAC Navigation Matrix — Section 2, GaDongHR_RBAC_Workflow_Reference.pdf ──
// SA = Superadmin (full, unrestricted access to ALL modules)
interface NavItem {
  name: string;
  path: string;
  icon: IconName;
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
    color: 'text-accent',
    items: [
      { name: 'Dashboard',     path: '/',               icon: 'home' },
      { name: 'Notifications', path: '/notifications',  icon: 'bell' },
    ]
  },
  {
    group: 'WORKFORCE',
    color: 'text-accent',
    items: [
      { name: 'Employees',   path: '/employees',           icon: 'users' },
      { name: 'Recruitment', path: '/recruitment',         icon: 'briefcase' },
      { name: 'Attendance',  path: '/attendance/registry', icon: 'clock' },
      { name: 'Leave',       path: '/leave/registry',      icon: 'calendar' },
      { name: 'Claims',      path: '/claims/registry',     icon: 'receipt' },
      { name: 'Movements',   path: '/movements',           icon: 'shuffle' },
      { name: 'Performance', path: '/performance',         icon: 'award' },
      { name: 'Training',    path: '/training',            icon: 'graduation' },
      { name: 'Offboarding', path: '/offboarding',         icon: 'userMinus' },
    ]
  },
  {
    group: 'EMPLOYEE',
    color: 'text-accent',
    items: [
      { name: 'My Attendance', path: '/attendance',          icon: 'clock' },
      { name: 'My Schedule',   path: '/attendance/schedule', icon: 'calendar' },
      { name: 'My Leave',      path: '/leave',               icon: 'calendar' },
      { name: 'My Claims',     path: '/claims',              icon: 'receipt' },
      { name: 'My Training',   path: '/training?view=me',            icon: 'graduation' },
      { name: 'My Appraisal',  path: '/performance?view=me',         icon: 'award' },
      { name: 'My Payslips',   path: '/payroll/me',          icon: 'wallet' },
      { name: 'My Documents',  path: '/documents',           icon: 'file' },
      { name: 'My Benefits',   path: '/benefits',            icon: 'gift' },
      { name: 'My Cases',      path: '/hr-cases',            icon: 'scale' },
      { name: 'My Loans',       path: '/loans',              icon: 'dollar' },
      { name: 'My Surveys',     path: '/surveys',             icon: 'clipboard' },
    ]
  },
  {
    group: 'FINANCIAL',
    color: 'text-accent',
    items: [
      { name: 'Payroll',  path: '/payroll',  icon: 'wallet', badge: 'Action' },
      { name: 'Benefits', path: '/benefits', icon: 'gift' },
      { name: 'Loans',    path: '/loans',    icon: 'dollar' },
      { name: 'Assets',   path: '/assets',   icon: 'grid' },
    ]
  },
  {
    group: 'COMPLIANCE',
    color: 'text-highlight',
    items: [
      { name: 'Reports',     path: '/reports',           icon: 'chart' },
      { name: 'Analytics',   path: '/reports/analytics', icon: 'chart' },
      { name: 'Documents',   path: '/documents',         icon: 'file' },
      { name: 'HR Cases',    path: '/hr-cases',          icon: 'scale' },
      { name: 'Surveys',     path: '/surveys',           icon: 'clipboard' },
      { name: 'Succession',  path: '/succession',        icon: 'users' },
    ]
  },
  {
    group: 'ADMINISTRATION',
    color: 'text-accent',
    items: [
      { name: 'Tenancy & Config',   path: '/settings',          icon: 'settings' },
      { name: 'User Management',    path: '/settings/users',    icon: 'user' },
      { name: 'Role & Permissions', path: '/settings/roles',    icon: 'key' },
      { name: 'Security (SSO/MFA)', path: '/settings/security', icon: 'shield' },
      { name: 'Audit Logs',         path: '/settings/audit',    icon: 'list' },
      { name: 'Statutory Tables',   path: '/settings/rates',    icon: 'list' },
      { name: 'API & Webhooks',     path: '/settings/api',      icon: 'key' },
      { name: 'PDPA Compliance',    path: '/settings/pdpa',     icon: 'shield' },
      { name: 'System Overrides',   path: '/settings/overrides',icon: 'sliders' },
    ]
  },
  {
    group: 'SUPPORT',
    color: 'text-muted',
    items: [
      { name: 'Support Inbox', path: '/support/admin', icon: 'lifeBuoy' },
    ]
  },
];

// HR Admin nav
const HR_ADMIN_NAV: NavGroup[] = [
  { group: 'COMMAND',    color: 'text-accent',  items: [{ name: 'Dashboard', path: '/', icon: 'home' }, { name: 'Notifications', path: '/notifications', icon: 'bell' }] },
  { group: 'WORKFORCE',  color: 'text-accent',    items: [
    { name: 'Employees',   path: '/employees',           icon: 'users' },
    { name: 'Recruitment', path: '/recruitment',         icon: 'briefcase' },
    { name: 'Attendance',  path: '/attendance/registry', icon: 'clock' },
    { name: 'Leave',       path: '/leave/registry',      icon: 'calendar' },
    { name: 'Claims',      path: '/claims/registry',     icon: 'receipt' },
    { name: 'Movements',   path: '/movements',           icon: 'shuffle' },
    { name: 'Performance', path: '/performance',         icon: 'award' },
    { name: 'Training',    path: '/training',            icon: 'graduation' },
  ]},
  { group: 'EMPLOYEE',   color: 'text-accent',     items: [
    { name: 'My Attendance', path: '/attendance',          icon: 'clock' },
    { name: 'My Schedule',   path: '/attendance/schedule', icon: 'calendar' },
    { name: 'My Leave',      path: '/leave',               icon: 'calendar' },
    { name: 'My Claims',     path: '/claims',              icon: 'receipt' },
    { name: 'My Training',   path: '/training?view=me',            icon: 'graduation' },
    { name: 'My Appraisal',  path: '/performance?view=me',         icon: 'award' },
    { name: 'My Payslips',   path: '/payroll/me',          icon: 'wallet' },
    { name: 'My Documents',  path: '/documents',           icon: 'file' },
    { name: 'My Benefits',   path: '/benefits',            icon: 'gift' },
    { name: 'My Cases',      path: '/hr-cases',            icon: 'scale' },
    { name: 'My Loans',       path: '/loans',              icon: 'dollar' },
    { name: 'My Surveys',     path: '/surveys',             icon: 'clipboard' },
  ]},
  { group: 'FINANCIAL',  color: 'text-accent', items: [
    { name: 'Payroll',  path: '/payroll',  icon: 'wallet' },
    { name: 'Benefits', path: '/benefits', icon: 'gift' },
    { name: 'Loans',    path: '/loans',    icon: 'dollar' },
  ]},
  { group: 'COMPLIANCE', color: 'text-highlight',   items: [
    { name: 'Reports',    path: '/reports',           icon: 'chart' },
    { name: 'Analytics',  path: '/reports/analytics', icon: 'chart' },
    { name: 'Documents',  path: '/documents',         icon: 'file' },
    { name: 'HR Cases',   path: '/hr-cases',          icon: 'scale' },
    { name: 'Surveys',    path: '/surveys',           icon: 'clipboard' },
    { name: 'Succession', path: '/succession',        icon: 'users' },
  ]},
  { group: 'ADMIN',      color: 'text-accent',  items: [{ name: 'User Management', path: '/settings/users', icon: 'user' }] },
  { group: 'SUPPORT',   color: 'text-muted',   items: [{ name: 'Support Inbox', path: '/support/admin', icon: 'lifeBuoy' }] },
];

// Payroll Officer nav
const PAYROLL_OFFICER_NAV: NavGroup[] = [
  { group: 'COMMAND',    color: 'text-accent',  items: [{ name: 'Dashboard', path: '/', icon: 'home' }, { name: 'Notifications', path: '/notifications', icon: 'bell' }] },
  { group: 'WORKFORCE',  color: 'text-accent',    items: [
    { name: 'Employees',  path: '/employees',           icon: 'users' },
    { name: 'Attendance', path: '/attendance/registry', icon: 'clock' },
    { name: 'Leave',      path: '/leave/registry',      icon: 'calendar' },
    { name: 'Claims',     path: '/claims/registry',     icon: 'receipt' },
  ]},
  { group: 'EMPLOYEE',   color: 'text-accent',     items: [
    { name: 'My Attendance', path: '/attendance',          icon: 'clock' },
    { name: 'My Schedule',   path: '/attendance/schedule', icon: 'calendar' },
    { name: 'My Leave',      path: '/leave',               icon: 'calendar' },
    { name: 'My Claims',     path: '/claims',              icon: 'receipt' },
    { name: 'My Training',   path: '/training?view=me',            icon: 'graduation' },
    { name: 'My Appraisal',  path: '/performance?view=me',         icon: 'award' },
    { name: 'My Payslips',   path: '/payroll/me',          icon: 'wallet' },
    { name: 'My Documents',  path: '/documents',           icon: 'file' },
    { name: 'My Benefits',   path: '/benefits',            icon: 'gift' },
    { name: 'My Cases',      path: '/hr-cases',            icon: 'scale' },
    { name: 'My Loans',       path: '/loans',              icon: 'dollar' },
    { name: 'My Surveys',     path: '/surveys',             icon: 'clipboard' },
  ]},
  { group: 'FINANCIAL',  color: 'text-accent', items: [
    { name: 'Payroll', path: '/payroll', icon: 'wallet', badge: 'Action' },
  ]},
  { group: 'COMPLIANCE', color: 'text-highlight',   items: [
    { name: 'Reports', path: '/reports', icon: 'chart' },
  ]},
  { group: 'SUPPORT',   color: 'text-muted',   items: [
    { name: 'Help & Support', path: '/support', icon: 'lifeBuoy' },
  ]},
];

// General ADMIN nav — HR-adjacent oversight without payroll or sensitive data
const ADMIN_NAV: NavGroup[] = [
  { group: 'COMMAND',    color: 'text-accent',  items: [{ name: 'Dashboard', path: '/', icon: 'home' }, { name: 'Notifications', path: '/notifications', icon: 'bell' }] },
  { group: 'WORKFORCE',  color: 'text-accent',    items: [
    { name: 'Employees',  path: '/employees',           icon: 'users' },
    { name: 'Attendance', path: '/attendance/registry', icon: 'clock' },
    { name: 'Leave',      path: '/leave/registry',      icon: 'calendar' },
    { name: 'Claims',     path: '/claims/registry',     icon: 'receipt' },
  ]},
  { group: 'EMPLOYEE',   color: 'text-accent',     items: [
    { name: 'My Attendance', path: '/attendance',          icon: 'clock' },
    { name: 'My Schedule',   path: '/attendance/schedule', icon: 'calendar' },
    { name: 'My Leave',      path: '/leave',               icon: 'calendar' },
    { name: 'My Claims',     path: '/claims',              icon: 'receipt' },
    { name: 'My Training',   path: '/training?view=me',            icon: 'graduation' },
    { name: 'My Documents',  path: '/documents',           icon: 'file' },
    { name: 'My Benefits',   path: '/benefits',            icon: 'gift' },
    { name: 'My Cases',      path: '/hr-cases',            icon: 'scale' },
    { name: 'My Loans',       path: '/loans',              icon: 'dollar' },
    { name: 'My Surveys',     path: '/surveys',             icon: 'clipboard' },
  ]},
  { group: 'COMPLIANCE', color: 'text-highlight',   items: [{ name: 'Reports', path: '/reports', icon: 'chart' }] },
  { group: 'SUPPORT',    color: 'text-muted',   items: [{ name: 'Help & Support', path: '/support', icon: 'lifeBuoy' }] },
];

// IT Admin nav — user/role/settings + asset oversight
const IT_ADMIN_NAV: NavGroup[] = [
  { group: 'COMMAND',        color: 'text-accent', items: [{ name: 'Dashboard', path: '/', icon: 'home' }, { name: 'Notifications', path: '/notifications', icon: 'bell' }] },
  { group: 'ADMINISTRATION', color: 'text-accent', items: [
    { name: 'User Management',    path: '/settings/users',    icon: 'user' },
    { name: 'Role & Permissions', path: '/settings/roles',    icon: 'key' },
    { name: 'Security (SSO/MFA)', path: '/settings/security', icon: 'shield' },
    { name: 'Audit Logs',         path: '/settings/audit',    icon: 'list' },
    { name: 'Tenancy & Config',   path: '/settings',          icon: 'settings' },
  ]},
  { group: 'ASSETS',         color: 'text-accent', items: [{ name: 'Assets', path: '/assets', icon: 'grid' }] },
  { group: 'COMPLIANCE',     color: 'text-highlight',   items: [{ name: 'Reports', path: '/reports', icon: 'chart' }] },
  { group: 'EMPLOYEE',       color: 'text-accent',     items: [
    { name: 'My Attendance', path: '/attendance', icon: 'clock' },
    { name: 'My Leave',      path: '/leave',      icon: 'calendar' },
    { name: 'My Documents',  path: '/documents',  icon: 'file' },
    { name: 'My Benefits',   path: '/benefits',   icon: 'gift' },
    { name: 'My Cases',      path: '/hr-cases',   icon: 'scale' },
    { name: 'My Loans',       path: '/loans',              icon: 'dollar' },
    { name: 'My Surveys',     path: '/surveys',             icon: 'clipboard' },
  ]},
];

// Finance Admin nav — claims approval + payroll visibility + financial reports
const FINANCE_ADMIN_NAV: NavGroup[] = [
  { group: 'COMMAND',    color: 'text-accent',   items: [{ name: 'Dashboard', path: '/', icon: 'home' }, { name: 'Notifications', path: '/notifications', icon: 'bell' }] },
  { group: 'FINANCIAL',  color: 'text-accent',  items: [
    { name: 'Claims',  path: '/claims/registry', icon: 'receipt' },
    { name: 'Payroll', path: '/payroll',         icon: 'wallet' },
    { name: 'Loans',   path: '/loans',           icon: 'dollar' },
    { name: 'Assets',  path: '/assets',          icon: 'grid' },
  ]},
  { group: 'COMPLIANCE', color: 'text-highlight',    items: [{ name: 'Reports', path: '/reports', icon: 'chart' }] },
  { group: 'EMPLOYEE',   color: 'text-accent',      items: [
    { name: 'My Attendance', path: '/attendance',          icon: 'clock' },
    { name: 'My Schedule',   path: '/attendance/schedule', icon: 'calendar' },
    { name: 'My Leave',      path: '/leave',               icon: 'calendar' },
    { name: 'My Claims',     path: '/claims',              icon: 'receipt' },
    { name: 'My Payslips',   path: '/payroll/me',          icon: 'wallet' },
    { name: 'My Documents',  path: '/documents',           icon: 'file' },
    { name: 'My Benefits',   path: '/benefits',            icon: 'gift' },
    { name: 'My Cases',      path: '/hr-cases',            icon: 'scale' },
    { name: 'My Loans',       path: '/loans',              icon: 'dollar' },
    { name: 'My Surveys',     path: '/surveys',             icon: 'clipboard' },
  ]},
];

// Line Manager nav — team approvals + scheduling
const LINE_MANAGER_NAV: NavGroup[] = [
  { group: 'COMMAND',     color: 'text-accent', items: [{ name: 'Dashboard', path: '/', icon: 'home' }, { name: 'Notifications', path: '/notifications', icon: 'bell' }] },
  { group: 'TEAM',        color: 'text-accent',   items: [
    { name: 'Team Leave',       path: '/leave/registry',      icon: 'calendar' },
    { name: 'Team Claims',      path: '/claims/registry',     icon: 'receipt' },
    { name: 'Team Attendance',  path: '/attendance/registry', icon: 'clock' },
    { name: 'Shift Scheduler',  path: '/attendance/schedule', icon: 'calendar' },
    { name: 'Assets',           path: '/assets',              icon: 'grid' },
    { name: 'Team Succession',  path: '/succession/my-team',  icon: 'users' },
  ]},
  { group: 'EMPLOYEE',    color: 'text-accent',    items: [
    { name: 'My Attendance', path: '/attendance',          icon: 'clock' },
    { name: 'My Schedule',   path: '/attendance/schedule', icon: 'calendar' },
    { name: 'My Leave',      path: '/leave',               icon: 'calendar' },
    { name: 'My Claims',     path: '/claims',              icon: 'receipt' },
    { name: 'My Training',   path: '/training?view=me',            icon: 'graduation' },
    { name: 'My Appraisal',  path: '/performance?view=me',         icon: 'award' },
    { name: 'My Payslips',   path: '/payroll/me',          icon: 'wallet' },
    { name: 'My Documents',  path: '/documents',           icon: 'file' },
    { name: 'My Benefits',   path: '/benefits',            icon: 'gift' },
    { name: 'My Cases',      path: '/hr-cases',            icon: 'scale' },
    { name: 'My Loans',       path: '/loans',              icon: 'dollar' },
    { name: 'My Surveys',     path: '/surveys',             icon: 'clipboard' },
  ]},
];

// Recruiter nav — ATS/recruitment only + self-service
const RECRUITER_NAV: NavGroup[] = [
  { group: 'COMMAND',     color: 'text-accent', items: [{ name: 'Dashboard', path: '/', icon: 'home' }, { name: 'Notifications', path: '/notifications', icon: 'bell' }] },
  { group: 'RECRUITMENT', color: 'text-accent',   items: [
    { name: 'Recruitment', path: '/recruitment', icon: 'briefcase' },
    { name: 'Employees',   path: '/employees',   icon: 'users' },
  ]},
  { group: 'EMPLOYEE',    color: 'text-accent',    items: [
    { name: 'My Attendance', path: '/attendance',          icon: 'clock' },
    { name: 'My Leave',      path: '/leave',               icon: 'calendar' },
    { name: 'My Claims',     path: '/claims',              icon: 'receipt' },
    { name: 'My Training',   path: '/training?view=me',            icon: 'graduation' },
    { name: 'My Payslips',   path: '/payroll/me',          icon: 'wallet' },
    { name: 'My Documents',  path: '/documents',           icon: 'file' },
    { name: 'My Benefits',   path: '/benefits',            icon: 'gift' },
    { name: 'My Cases',      path: '/hr-cases',            icon: 'scale' },
    { name: 'My Loans',       path: '/loans',              icon: 'dollar' },
    { name: 'My Surveys',     path: '/surveys',             icon: 'clipboard' },
  ]},
];

// Training Manager nav — training oversight (training-specific perms still pending in seed)
const TRAINING_MANAGER_NAV: NavGroup[] = [
  { group: 'COMMAND',  color: 'text-accent',   items: [{ name: 'Dashboard', path: '/', icon: 'home' }, { name: 'Notifications', path: '/notifications', icon: 'bell' }] },
  { group: 'TRAINING', color: 'text-ink',   items: [
    { name: 'Training',  path: '/training',  icon: 'graduation' },
    { name: 'Employees', path: '/employees', icon: 'users' },
  ]},
  { group: 'COMPLIANCE', color: 'text-highlight',  items: [{ name: 'Reports', path: '/reports', icon: 'chart' }] },
  { group: 'EMPLOYEE', color: 'text-accent',      items: [
    { name: 'My Attendance', path: '/attendance', icon: 'clock' },
    { name: 'My Leave',      path: '/leave',      icon: 'calendar' },
    { name: 'My Training',   path: '/training?view=me',   icon: 'graduation' },
    { name: 'My Payslips',   path: '/payroll/me', icon: 'wallet' },
    { name: 'My Documents',  path: '/documents',  icon: 'file' },
    { name: 'My Benefits',   path: '/benefits',   icon: 'gift' },
    { name: 'My Cases',      path: '/hr-cases',   icon: 'scale' },
    { name: 'My Loans',       path: '/loans',              icon: 'dollar' },
    { name: 'My Surveys',     path: '/surveys',             icon: 'clipboard' },
  ]},
];

// Employee ESS nav — default inherited role for all employees
const EMPLOYEE_NAV: NavGroup[] = [
  { group: 'OVERVIEW',  color: 'text-accent',  items: [{ name: 'Dashboard', path: '/', icon: 'home' }, { name: 'Notifications', path: '/notifications', icon: 'bell' }] },
  { group: 'EMPLOYEE',  color: 'text-accent',     items: [
    { name: 'My Attendance', path: '/attendance',          icon: 'clock' },
    { name: 'My Schedule',   path: '/attendance/schedule', icon: 'calendar' },
    { name: 'My Leave',      path: '/leave',               icon: 'calendar' },
    { name: 'My Claims',     path: '/claims',              icon: 'receipt' },
    { name: 'My Training',   path: '/training?view=me',            icon: 'graduation' },
    { name: 'My Appraisal',  path: '/performance?view=me',         icon: 'award' },
    { name: 'My Documents',  path: '/documents',           icon: 'file' },
    { name: 'My Benefits',   path: '/benefits',            icon: 'gift' },
    { name: 'My Cases',      path: '/hr-cases',            icon: 'scale' },
    { name: 'My Loans',       path: '/loans',              icon: 'dollar' },
    { name: 'My Surveys',     path: '/surveys',             icon: 'clipboard' },
  ]},
  { group: 'PAYSLIPS',  color: 'text-accent', items: [
    { name: 'My Payslips', path: '/payroll/me', icon: 'wallet' },
  ]},
  { group: 'SUPPORT',   color: 'text-muted',   items: [
    { name: 'Staff Directory', path: '/staff',   icon: 'user' },
    { name: 'Help & Support',  path: '/support', icon: 'lifeBuoy' },
  ]},
];

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN:      'Super admin',
  ADMIN:            'Admin',
  IT_ADMIN:         'IT admin',
  HR_ADMIN:         'HR admin',
  HR_MANAGER:       'HR manager',
  PAYROLL_OFFICER:  'Payroll officer',
  FINANCE_ADMIN:    'Finance admin',
  RECRUITER:        'Recruiter',
  TRAINING_MANAGER: 'Training manager',
  LINE_MANAGER:     'Line manager',
  EMPLOYEE:         'Employee',
};

// The RBAC matrices above keep their internal group keys; this is what the
// sidebar prints for each (sentence case, plain words — the redesign IA).
const GROUP_LABELS: Record<string, string> = {
  COMMAND: 'Overview', OVERVIEW: 'Overview', WORKFORCE: 'Workforce', EMPLOYEE: 'My workspace',
  FINANCIAL: 'Money', PAYSLIPS: 'Money', COMPLIANCE: 'Compliance', ADMINISTRATION: 'Administration',
  ADMIN: 'Administration', SUPPORT: 'Support', TEAM: 'Team', RECRUITMENT: 'Recruitment',
  TRAINING: 'Training', ASSETS: 'Assets',
};

function getNavGroups(role: string, _email: string, cached: boolean) {
  const r = role.toUpperCase();
  if (r === 'SUPER_ADMIN' || cached) return SUPER_ADMIN_NAV;
  if (r === 'HR_ADMIN')         return HR_ADMIN_NAV;
  if (r === 'HR_MANAGER')       return HR_ADMIN_NAV;
  if (r === 'PAYROLL_OFFICER')  return PAYROLL_OFFICER_NAV;
  if (r === 'ADMIN')            return ADMIN_NAV;
  if (r === 'IT_ADMIN')         return IT_ADMIN_NAV;
  if (r === 'FINANCE_ADMIN')    return FINANCE_ADMIN_NAV;
  if (r === 'LINE_MANAGER')     return LINE_MANAGER_NAV;
  if (r === 'RECRUITER')        return RECRUITER_NAV;
  if (r === 'TRAINING_MANAGER') return TRAINING_MANAGER_NAV;
  return EMPLOYEE_NAV;
}

// Bottom bar on phones: the first four of these the role can reach, then "More".
const BOTTOM_BAR_ORDER = ['/', '/attendance', '/leave', '/claims', '/payroll/me', '/employees', '/payroll', '/notifications'];

function titleCase(seg: string) {
  return seg.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Track the ?view=me flag so the dual /training & /performance nav items
  // (admin "Training"/"Performance" vs "My Training"/"My Appraisal") highlight correctly.
  const [isMyView, setIsMyView] = useState(false);
  useEffect(() => { setIsMyView(typeof window !== 'undefined' && window.location.search.includes('view=me')); }, [pathname]);
  const router = useRouter();
  const { user, loading, logout } = useAuth();

  // SECURITY (M-07): role and admin status are sourced exclusively from the
  // live `user` object returned by /auth/me. The prior pattern wrote the
  // role into localStorage as a "resilient cache" — anyone with browser dev
  // tools could flip those keys and have the UI surface admin nav. The
  // server still enforces RBAC, but rendering admin-only chrome to a
  // non-admin is itself an information disclosure.
  useEffect(() => {
    // One-time migration: clean any stale cache from previous build.
    if (typeof window !== 'undefined') {
      localStorage.removeItem('gadonghr_admin_confirmed');
      localStorage.removeItem('gadonghr_user_role');
    }
  }, []);

  const liveRole  = (user?.role  || '').toUpperCase().trim();
  const isSuperAdmin = liveRole === 'SUPER_ADMIN';

  // Redirect unauthenticated users to login
  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login');
    }
  }, [loading, user]);

  // Navigation loading overlay — shown when user clicks a sidebar link
  const [isNavigating, setIsNavigating] = useState(false);
  const [navTarget, setNavTarget] = useState('');
  useEffect(() => {
    // Pathname changed → destination page has mounted, hide overlay
    setIsNavigating(false);
  }, [pathname]);

  // Mobile sidebar drawer state
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Auto-close drawer on route change
  useEffect(() => { setSidebarOpen(false); }, [pathname]);

  // ⌘K palette + user menu
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen((v) => !v); }
      if (e.key === 'Escape') { setMenuOpen(false); setSidebarOpen(false); }
    };
    const onClick = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onClick); };
  }, []);
  useEffect(() => { setMenuOpen(false); }, [pathname]);

  const effectiveRole = liveRole;
  const roleLabel = ROLE_LABELS[effectiveRole] || ROLE_LABELS['EMPLOYEE'];

  const navGroups = getNavGroups(effectiveRole, '', isSuperAdmin);
  const flatNav = navGroups.flatMap((g) => g.items.map((it) => ({ ...it, group: GROUP_LABELS[g.group] || titleCase(g.group.toLowerCase()) })));

  const isItemActive = (item: NavItem) => {
    const itemBase = item.path.split('?')[0];
    const itemMy = item.path.includes('view=me');
    const dual = itemBase === '/training' || itemBase === '/performance';
    const baseMatch = pathname === itemBase || (itemBase !== '/' && pathname.startsWith(itemBase));
    return baseMatch && (!dual || itemMy === isMyView);
  };

  // Breadcrumb from the path: the matching nav item's name where there is
  // one, otherwise the segment in sentence case.
  const crumbs = (() => {
    const segs = pathname.split('/').filter(Boolean);
    if (!segs.length) return ['Dashboard'];
    return segs.map((_, i) => {
      const p = '/' + segs.slice(0, i + 1).join('/');
      const hit = flatNav.find((it) => it.path.split('?')[0] === p);
      return hit ? hit.name : titleCase(segs[i]);
    });
  })();

  const bottomBar = BOTTOM_BAR_ORDER
    .map((p) => flatNav.find((it) => it.path === p))
    .filter((it): it is NonNullable<typeof it> => Boolean(it))
    .slice(0, 4);

  const initials = (user?.name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || (isSuperAdmin ? 'SA' : 'U');

  const doLogout = () => {
    localStorage.removeItem('gadonghr_admin_confirmed');
    localStorage.removeItem('gadonghr_user_role');
    logout();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-9 h-9 border-[3px] border-rule border-t-accent animate-spin rounded-full" />
          <p className="text-sm text-muted">Signing you in…</p>
        </div>
      </div>
    );
  }

  const navLink = (item: NavItem, onNavigate?: () => void) => {
    const isActive = isItemActive(item);
    return (
      <Link
        key={item.path}
        href={item.path}
        aria-current={isActive ? 'page' : undefined}
        onClick={() => {
          onNavigate?.();
          if (!isActive) { setIsNavigating(true); setNavTarget(item.name); }
        }}
        className={`flex items-center gap-[11px] h-[38px] px-3 rounded-control text-[13.5px] transition-colors ${
          isActive ? 'bg-tint text-accent font-bold' : 'text-muted font-medium hover:bg-page hover:text-ink'
        }`}
      >
        <Icon name={item.icon} size={17} className={isActive ? 'text-accent' : 'text-faint'} />
        <span className="flex-1 truncate">{item.name}</span>
        {item.badge && <Badge tone="brass">{item.badge}</Badge>}
      </Link>
    );
  };

  const sidebarBody = (
    <>
      <div className="flex items-center gap-2.5 px-2 pt-1 pb-3">
        <GaDongLogo variant="light" markSize={30} className="min-w-0" />
      </div>
      <nav className="flex-1 overflow-y-auto custom-scrollbar -mx-1 px-1" aria-label="Main">
        {navGroups.map((group) => (
          <div key={group.group} className="flex flex-col gap-px">
            <div className="px-3 pt-3 pb-1.5 text-xs font-bold uppercase tracking-[0.06em] text-faint">
              {GROUP_LABELS[group.group] || titleCase(group.group.toLowerCase())}
            </div>
            {group.items.map((item) => navLink(item))}
          </div>
        ))}
      </nav>
      <div className="flex items-center gap-2.5 pt-3 mt-2 px-2 border-t border-rule">
        <div className="w-8 h-8 rounded-full bg-accent text-on-accent flex items-center justify-center text-xs font-bold shrink-0">{initials}</div>
        <div className="flex flex-col min-w-0">
          <div className="text-[13px] font-bold text-ink truncate">{user?.name || (isSuperAdmin ? 'Administrator' : 'User')}</div>
          <div className="text-xs text-muted truncate">{roleLabel}</div>
        </div>
      </div>
    </>
  );

  return (
    <div className="flex h-screen bg-page font-sans overflow-hidden relative">
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} items={flatNav} />

      {/* Navigation loading overlay */}
      {isNavigating && (
        <div className="fixed inset-0 z-[60] pointer-events-none">
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-accent/20 overflow-hidden">
            <div className="h-full bg-accent w-3/5" style={{ animation: 'navprogress 1.2s ease-in-out infinite' }} />
          </div>
          <div className="absolute inset-y-0 left-0 lg:left-60 right-0 flex flex-col items-center justify-center gap-3 bg-page/70 backdrop-blur-[2px]">
            <div className="w-8 h-8 border-[3px] border-rule border-t-accent animate-spin rounded-full" />
            {navTarget && <p className="text-[13px] text-muted">Opening {navTarget}…</p>}
          </div>
        </div>
      )}

      {/* Mobile drawer. The same sidebar body renders twice (drawer below lg,
          static aside at lg+); each is display:none at the other breakpoint,
          so keep the lg:hidden / hidden lg:flex pair together. */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-ink/40 lg:hidden" onClick={() => setSidebarOpen(false)} aria-hidden="true" />
      )}
      <aside
        className={`w-60 bg-paper border-r border-rule flex flex-col z-50 shrink-0 fixed inset-y-0 left-0 px-3 pt-[18px] pb-3.5 transition-transform duration-200 lg:hidden ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-hidden={!sidebarOpen}
      >
        {sidebarBody}
      </aside>

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-60 bg-paper border-r border-rule flex-col shrink-0 px-3 pt-[18px] pb-3.5">
        {sidebarBody}
      </aside>

      {/* ── MAIN ─────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-[60px] bg-paper border-b border-rule px-4 lg:px-8 flex items-center justify-between sticky top-0 z-30 shrink-0 gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden w-9 h-9 -ml-2 flex items-center justify-center rounded-control text-muted hover:bg-page"
              aria-label="Open navigation menu"
            >
              <Icon name="menu" size={20} />
            </button>
            <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[13.5px] min-w-0">
              {crumbs.map((c, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <Icon name="chevronRight" size={14} className="text-faint" />}
                  <span className={`truncate ${i === crumbs.length - 1 ? 'text-ink font-bold' : 'text-muted font-medium'}`}>{c}</span>
                </React.Fragment>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-2 lg:gap-4 shrink-0">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="hidden md:flex items-center gap-2.5 h-10 w-[300px] px-3 rounded-control bg-page border border-rule text-muted hover:border-accent text-left"
              aria-label="Search or jump to a page"
            >
              <Icon name="search" size={16} />
              <span className="flex-1 text-[13.5px] text-faint">Search or jump to…</span>
              <span className="text-xs px-1.5 py-0.5 border border-rule rounded text-faint">⌘K</span>
            </button>
            <button type="button" onClick={() => setPaletteOpen(true)} className="md:hidden w-9 h-9 flex items-center justify-center rounded-control text-muted hover:bg-page" aria-label="Search">
              <Icon name="search" size={19} />
            </button>
            <NotificationBell />
            <div ref={menuRef} className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                className="w-9 h-9 rounded-full bg-accent text-on-accent flex items-center justify-center text-xs font-bold"
                aria-label="Account menu"
                aria-expanded={menuOpen}
              >
                {initials}
              </button>
              {menuOpen && (
                <div role="menu" aria-label="Account" className="absolute right-0 top-11 w-64 bg-paper border border-rule rounded-card shadow-card z-50 overflow-hidden">
                  <div className="px-4 py-3 border-b border-rule">
                    <div className="text-sm font-bold text-ink truncate">{user?.name || 'User'}</div>
                    <div className="text-xs text-muted truncate">{user?.email || ''}</div>
                    <div className="mt-1.5"><Badge tone={isSuperAdmin ? 'accent' : 'neutral'}>{roleLabel}</Badge></div>
                  </div>
                  <Link role="menuitem" href="/settings" className="flex items-center gap-2.5 px-4 h-10 text-sm text-ink hover:bg-page"><Icon name="settings" size={16} className="text-muted" />Settings</Link>
                  <button role="menuitem" type="button" onClick={doLogout} className="w-full flex items-center gap-2.5 px-4 h-10 text-sm text-ink hover:bg-page text-left"><Icon name="logout" size={16} className="text-muted" />Sign out</button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto custom-scrollbar bg-page pb-16 lg:pb-0">
          <TrialBanner />
          <div className="max-w-[1400px] mx-auto px-4 py-5 sm:px-6 lg:px-8 lg:py-[26px]">
            {children}
          </div>
        </main>

        {/* Phone bottom bar */}
        <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 h-16 bg-paper border-t border-rule grid grid-cols-5" aria-label="Quick navigation">
          {bottomBar.map((item) => {
            const on = isItemActive(item);
            return (
              <Link key={item.path} href={item.path} aria-current={on ? 'page' : undefined} className={`flex flex-col items-center justify-center gap-1 text-xs font-semibold ${on ? 'text-accent' : 'text-muted'}`}>
                <Icon name={item.icon} size={20} />
                <span className="truncate max-w-full px-1">{item.name.replace(/^My /, '')}</span>
              </Link>
            );
          })}
          <button type="button" onClick={() => setSidebarOpen(true)} className="flex flex-col items-center justify-center gap-1 text-xs font-semibold text-muted">
            <Icon name="more" size={20} />
            <span>More</span>
          </button>
        </nav>
      </div>
      <FloatingAssistant />
    </div>
  );
}
