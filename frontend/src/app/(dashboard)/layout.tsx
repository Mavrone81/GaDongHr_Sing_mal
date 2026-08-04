'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import NotificationBell from '@/components/NotificationBell';
import FloatingAssistant from '@/components/FloatingAssistant';
import TrialBanner from '@/components/TrialBanner';
import { GaDongMark } from '@/components/GaDongLogo';

// ─── RBAC Navigation Matrix — Section 2, GaDongHR_RBAC_Workflow_Reference.pdf ──
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
    color: 'text-accent',
    items: [
      { name: 'Dashboard',     path: '/',               icon: '⬡' },
      { name: 'Notifications', path: '/notifications',  icon: '◍' },
    ]
  },
  {
    group: 'WORKFORCE',
    color: 'text-accent',
    items: [
      { name: 'Employees',   path: '/employees',           icon: '◈' },
      { name: 'Recruitment', path: '/recruitment',         icon: '◇' },
      { name: 'Attendance',  path: '/attendance/registry', icon: '◉' },
      { name: 'Leave',       path: '/leave/registry',      icon: '◌' },
      { name: 'Claims',      path: '/claims/registry',     icon: '◫' },
      { name: 'Movements',   path: '/movements',           icon: '↹' },
      { name: 'Performance', path: '/performance',         icon: '▣' },
      { name: 'Training',    path: '/training',            icon: '◑' },
      { name: 'Offboarding', path: '/offboarding',         icon: '◐' },
    ]
  },
  {
    group: 'EMPLOYEE',
    color: 'text-accent',
    items: [
      { name: 'My Attendance', path: '/attendance',          icon: '◉' },
      { name: 'My Schedule',   path: '/attendance/schedule', icon: '▦' },
      { name: 'My Leave',      path: '/leave',               icon: '◌' },
      { name: 'My Claims',     path: '/claims',              icon: '◫' },
      { name: 'My Training',   path: '/training?view=me',            icon: '◑' },
      { name: 'My Appraisal',  path: '/performance?view=me',         icon: '▣' },
      { name: 'My Payslips',   path: '/payroll/me',          icon: '◆' },
      { name: 'My Documents',  path: '/documents',           icon: '◭' },
      { name: 'My Benefits',   path: '/benefits',            icon: '⊕' },
      { name: 'My Cases',      path: '/hr-cases',            icon: '⚖' },
      { name: 'My Loans',       path: '/loans',              icon: '$' },
      { name: 'My Surveys',     path: '/surveys',             icon: '◊' },
    ]
  },
  {
    group: 'FINANCIAL',
    color: 'text-accent',
    items: [
      { name: 'Payroll',  path: '/payroll',  icon: '◆', badge: 'Action' },
      { name: 'Benefits', path: '/benefits', icon: '⊕' },
      { name: 'Loans',    path: '/loans',    icon: '$' },
      { name: 'Assets',   path: '/assets',   icon: '◧' },
    ]
  },
  {
    group: 'COMPLIANCE',
    color: 'text-highlight',
    items: [
      { name: 'Reports',     path: '/reports',           icon: '▤' },
      { name: 'Analytics',   path: '/reports/analytics', icon: '◧' },
      { name: 'Documents',   path: '/documents',         icon: '◭' },
      { name: 'HR Cases',    path: '/hr-cases',          icon: '⚖' },
      { name: 'Surveys',     path: '/surveys',           icon: '◊' },
      { name: 'Succession',  path: '/succession',        icon: '◈' },
    ]
  },
  {
    group: 'ADMINISTRATION',
    color: 'text-accent',
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
  {
    group: 'SUPPORT',
    color: 'text-muted',
    items: [
      { name: 'Support Inbox', path: '/support/admin', icon: '◇' },
    ]
  },
];

// HR Admin nav
const HR_ADMIN_NAV: NavGroup[] = [
  { group: 'COMMAND',    color: 'text-accent',  items: [{ name: 'Dashboard', path: '/', icon: '⬡' }, { name: 'Notifications', path: '/notifications', icon: '◍' }] },
  { group: 'WORKFORCE',  color: 'text-accent',    items: [
    { name: 'Employees',   path: '/employees',           icon: '◈' },
    { name: 'Recruitment', path: '/recruitment',         icon: '◇' },
    { name: 'Attendance',  path: '/attendance/registry', icon: '◉' },
    { name: 'Leave',       path: '/leave/registry',      icon: '◌' },
    { name: 'Claims',      path: '/claims/registry',     icon: '◫' },
    { name: 'Movements',   path: '/movements',           icon: '↹' },
    { name: 'Performance', path: '/performance',         icon: '▣' },
    { name: 'Training',    path: '/training',            icon: '◑' },
  ]},
  { group: 'EMPLOYEE',   color: 'text-accent',     items: [
    { name: 'My Attendance', path: '/attendance',          icon: '◉' },
    { name: 'My Schedule',   path: '/attendance/schedule', icon: '▦' },
    { name: 'My Leave',      path: '/leave',               icon: '◌' },
    { name: 'My Claims',     path: '/claims',              icon: '◫' },
    { name: 'My Training',   path: '/training?view=me',            icon: '◑' },
    { name: 'My Appraisal',  path: '/performance?view=me',         icon: '▣' },
    { name: 'My Payslips',   path: '/payroll/me',          icon: '◆' },
    { name: 'My Documents',  path: '/documents',           icon: '◭' },
    { name: 'My Benefits',   path: '/benefits',            icon: '⊕' },
    { name: 'My Cases',      path: '/hr-cases',            icon: '⚖' },
    { name: 'My Loans',       path: '/loans',              icon: '$' },
    { name: 'My Surveys',     path: '/surveys',             icon: '◊' },
  ]},
  { group: 'FINANCIAL',  color: 'text-accent', items: [
    { name: 'Payroll',  path: '/payroll',  icon: '◆' },
    { name: 'Benefits', path: '/benefits', icon: '⊕' },
    { name: 'Loans',    path: '/loans',    icon: '$' },
  ]},
  { group: 'COMPLIANCE', color: 'text-highlight',   items: [
    { name: 'Reports',    path: '/reports',           icon: '▤' },
    { name: 'Analytics',  path: '/reports/analytics', icon: '◧' },
    { name: 'Documents',  path: '/documents',         icon: '◭' },
    { name: 'HR Cases',   path: '/hr-cases',          icon: '⚖' },
    { name: 'Surveys',    path: '/surveys',           icon: '◊' },
    { name: 'Succession', path: '/succession',        icon: '◈' },
  ]},
  { group: 'ADMIN',      color: 'text-accent',  items: [{ name: 'User Management', path: '/settings/users', icon: '◪' }] },
  { group: 'SUPPORT',   color: 'text-muted',   items: [{ name: 'Support Inbox', path: '/support/admin', icon: '◇' }] },
];

// Payroll Officer nav
const PAYROLL_OFFICER_NAV: NavGroup[] = [
  { group: 'COMMAND',    color: 'text-accent',  items: [{ name: 'Dashboard', path: '/', icon: '⬡' }, { name: 'Notifications', path: '/notifications', icon: '◍' }] },
  { group: 'WORKFORCE',  color: 'text-accent',    items: [
    { name: 'Employees',  path: '/employees',           icon: '◈' },
    { name: 'Attendance', path: '/attendance/registry', icon: '◉' },
    { name: 'Leave',      path: '/leave/registry',      icon: '◌' },
    { name: 'Claims',     path: '/claims/registry',     icon: '◫' },
  ]},
  { group: 'EMPLOYEE',   color: 'text-accent',     items: [
    { name: 'My Attendance', path: '/attendance',          icon: '◉' },
    { name: 'My Schedule',   path: '/attendance/schedule', icon: '▦' },
    { name: 'My Leave',      path: '/leave',               icon: '◌' },
    { name: 'My Claims',     path: '/claims',              icon: '◫' },
    { name: 'My Training',   path: '/training?view=me',            icon: '◑' },
    { name: 'My Appraisal',  path: '/performance?view=me',         icon: '▣' },
    { name: 'My Payslips',   path: '/payroll/me',          icon: '◆' },
    { name: 'My Documents',  path: '/documents',           icon: '◭' },
    { name: 'My Benefits',   path: '/benefits',            icon: '⊕' },
    { name: 'My Cases',      path: '/hr-cases',            icon: '⚖' },
    { name: 'My Loans',       path: '/loans',              icon: '$' },
    { name: 'My Surveys',     path: '/surveys',             icon: '◊' },
  ]},
  { group: 'FINANCIAL',  color: 'text-accent', items: [
    { name: 'Payroll', path: '/payroll', icon: '◆', badge: 'Action' },
  ]},
  { group: 'COMPLIANCE', color: 'text-highlight',   items: [
    { name: 'Reports', path: '/reports', icon: '▤' },
  ]},
  { group: 'SUPPORT',   color: 'text-muted',   items: [
    { name: 'Help & Support', path: '/support', icon: '◇' },
  ]},
];

// General ADMIN nav — HR-adjacent oversight without payroll or sensitive data
const ADMIN_NAV: NavGroup[] = [
  { group: 'COMMAND',    color: 'text-accent',  items: [{ name: 'Dashboard', path: '/', icon: '⬡' }, { name: 'Notifications', path: '/notifications', icon: '◍' }] },
  { group: 'WORKFORCE',  color: 'text-accent',    items: [
    { name: 'Employees',  path: '/employees',           icon: '◈' },
    { name: 'Attendance', path: '/attendance/registry', icon: '◉' },
    { name: 'Leave',      path: '/leave/registry',      icon: '◌' },
    { name: 'Claims',     path: '/claims/registry',     icon: '◫' },
  ]},
  { group: 'EMPLOYEE',   color: 'text-accent',     items: [
    { name: 'My Attendance', path: '/attendance',          icon: '◉' },
    { name: 'My Schedule',   path: '/attendance/schedule', icon: '▦' },
    { name: 'My Leave',      path: '/leave',               icon: '◌' },
    { name: 'My Claims',     path: '/claims',              icon: '◫' },
    { name: 'My Training',   path: '/training?view=me',            icon: '◑' },
    { name: 'My Documents',  path: '/documents',           icon: '◭' },
    { name: 'My Benefits',   path: '/benefits',            icon: '⊕' },
    { name: 'My Cases',      path: '/hr-cases',            icon: '⚖' },
    { name: 'My Loans',       path: '/loans',              icon: '$' },
    { name: 'My Surveys',     path: '/surveys',             icon: '◊' },
  ]},
  { group: 'COMPLIANCE', color: 'text-highlight',   items: [{ name: 'Reports', path: '/reports', icon: '▤' }] },
  { group: 'SUPPORT',    color: 'text-muted',   items: [{ name: 'Help & Support', path: '/support', icon: '◇' }] },
];

// IT Admin nav — user/role/settings + asset oversight
const IT_ADMIN_NAV: NavGroup[] = [
  { group: 'COMMAND',        color: 'text-accent', items: [{ name: 'Dashboard', path: '/', icon: '⬡' }, { name: 'Notifications', path: '/notifications', icon: '◍' }] },
  { group: 'ADMINISTRATION', color: 'text-accent', items: [
    { name: 'User Management',    path: '/settings/users',    icon: '◪' },
    { name: 'Role & Permissions', path: '/settings/roles',    icon: '◧' },
    { name: 'Security (SSO/MFA)', path: '/settings/security', icon: '◰' },
    { name: 'Audit Logs',         path: '/settings/audit',    icon: '▤' },
    { name: 'Tenancy & Config',   path: '/settings',          icon: '◎' },
  ]},
  { group: 'ASSETS',         color: 'text-accent', items: [{ name: 'Assets', path: '/assets', icon: '◧' }] },
  { group: 'COMPLIANCE',     color: 'text-highlight',   items: [{ name: 'Reports', path: '/reports', icon: '▤' }] },
  { group: 'EMPLOYEE',       color: 'text-accent',     items: [
    { name: 'My Attendance', path: '/attendance', icon: '◉' },
    { name: 'My Leave',      path: '/leave',      icon: '◌' },
    { name: 'My Documents',  path: '/documents',  icon: '◭' },
    { name: 'My Benefits',   path: '/benefits',   icon: '⊕' },
    { name: 'My Cases',      path: '/hr-cases',   icon: '⚖' },
    { name: 'My Loans',       path: '/loans',              icon: '$' },
    { name: 'My Surveys',     path: '/surveys',             icon: '◊' },
  ]},
];

// Finance Admin nav — claims approval + payroll visibility + financial reports
const FINANCE_ADMIN_NAV: NavGroup[] = [
  { group: 'COMMAND',    color: 'text-accent',   items: [{ name: 'Dashboard', path: '/', icon: '⬡' }, { name: 'Notifications', path: '/notifications', icon: '◍' }] },
  { group: 'FINANCIAL',  color: 'text-accent',  items: [
    { name: 'Claims',  path: '/claims/registry', icon: '◫' },
    { name: 'Payroll', path: '/payroll',         icon: '◆' },
    { name: 'Loans',   path: '/loans',           icon: '$' },
    { name: 'Assets',  path: '/assets',          icon: '◧' },
  ]},
  { group: 'COMPLIANCE', color: 'text-highlight',    items: [{ name: 'Reports', path: '/reports', icon: '▤' }] },
  { group: 'EMPLOYEE',   color: 'text-accent',      items: [
    { name: 'My Attendance', path: '/attendance',          icon: '◉' },
    { name: 'My Schedule',   path: '/attendance/schedule', icon: '▦' },
    { name: 'My Leave',      path: '/leave',               icon: '◌' },
    { name: 'My Claims',     path: '/claims',              icon: '◫' },
    { name: 'My Payslips',   path: '/payroll/me',          icon: '◆' },
    { name: 'My Documents',  path: '/documents',           icon: '◭' },
    { name: 'My Benefits',   path: '/benefits',            icon: '⊕' },
    { name: 'My Cases',      path: '/hr-cases',            icon: '⚖' },
    { name: 'My Loans',       path: '/loans',              icon: '$' },
    { name: 'My Surveys',     path: '/surveys',             icon: '◊' },
  ]},
];

// Line Manager nav — team approvals + scheduling
const LINE_MANAGER_NAV: NavGroup[] = [
  { group: 'COMMAND',     color: 'text-accent', items: [{ name: 'Dashboard', path: '/', icon: '⬡' }, { name: 'Notifications', path: '/notifications', icon: '◍' }] },
  { group: 'TEAM',        color: 'text-accent',   items: [
    { name: 'Team Leave',       path: '/leave/registry',      icon: '◌' },
    { name: 'Team Claims',      path: '/claims/registry',     icon: '◫' },
    { name: 'Team Attendance',  path: '/attendance/registry', icon: '◉' },
    { name: 'Shift Scheduler',  path: '/attendance/schedule', icon: '▦' },
    { name: 'Assets',           path: '/assets',              icon: '◧' },
    { name: 'Team Succession',  path: '/succession/my-team',  icon: '◈' },
  ]},
  { group: 'EMPLOYEE',    color: 'text-accent',    items: [
    { name: 'My Attendance', path: '/attendance',          icon: '◉' },
    { name: 'My Schedule',   path: '/attendance/schedule', icon: '▦' },
    { name: 'My Leave',      path: '/leave',               icon: '◌' },
    { name: 'My Claims',     path: '/claims',              icon: '◫' },
    { name: 'My Training',   path: '/training?view=me',            icon: '◑' },
    { name: 'My Appraisal',  path: '/performance?view=me',         icon: '▣' },
    { name: 'My Payslips',   path: '/payroll/me',          icon: '◆' },
    { name: 'My Documents',  path: '/documents',           icon: '◭' },
    { name: 'My Benefits',   path: '/benefits',            icon: '⊕' },
    { name: 'My Cases',      path: '/hr-cases',            icon: '⚖' },
    { name: 'My Loans',       path: '/loans',              icon: '$' },
    { name: 'My Surveys',     path: '/surveys',             icon: '◊' },
  ]},
];

// Recruiter nav — ATS/recruitment only + self-service
const RECRUITER_NAV: NavGroup[] = [
  { group: 'COMMAND',     color: 'text-accent', items: [{ name: 'Dashboard', path: '/', icon: '⬡' }, { name: 'Notifications', path: '/notifications', icon: '◍' }] },
  { group: 'RECRUITMENT', color: 'text-accent',   items: [
    { name: 'Recruitment', path: '/recruitment', icon: '◇' },
    { name: 'Employees',   path: '/employees',   icon: '◈' },
  ]},
  { group: 'EMPLOYEE',    color: 'text-accent',    items: [
    { name: 'My Attendance', path: '/attendance',          icon: '◉' },
    { name: 'My Leave',      path: '/leave',               icon: '◌' },
    { name: 'My Claims',     path: '/claims',              icon: '◫' },
    { name: 'My Training',   path: '/training?view=me',            icon: '◑' },
    { name: 'My Payslips',   path: '/payroll/me',          icon: '◆' },
    { name: 'My Documents',  path: '/documents',           icon: '◭' },
    { name: 'My Benefits',   path: '/benefits',            icon: '⊕' },
    { name: 'My Cases',      path: '/hr-cases',            icon: '⚖' },
    { name: 'My Loans',       path: '/loans',              icon: '$' },
    { name: 'My Surveys',     path: '/surveys',             icon: '◊' },
  ]},
];

// Training Manager nav — training oversight (training-specific perms still pending in seed)
const TRAINING_MANAGER_NAV: NavGroup[] = [
  { group: 'COMMAND',  color: 'text-accent',   items: [{ name: 'Dashboard', path: '/', icon: '⬡' }, { name: 'Notifications', path: '/notifications', icon: '◍' }] },
  { group: 'TRAINING', color: 'text-ink',   items: [
    { name: 'Training',  path: '/training',  icon: '◑' },
    { name: 'Employees', path: '/employees', icon: '◈' },
  ]},
  { group: 'COMPLIANCE', color: 'text-highlight',  items: [{ name: 'Reports', path: '/reports', icon: '▤' }] },
  { group: 'EMPLOYEE', color: 'text-accent',      items: [
    { name: 'My Attendance', path: '/attendance', icon: '◉' },
    { name: 'My Leave',      path: '/leave',      icon: '◌' },
    { name: 'My Training',   path: '/training?view=me',   icon: '◑' },
    { name: 'My Payslips',   path: '/payroll/me', icon: '◆' },
    { name: 'My Documents',  path: '/documents',  icon: '◭' },
    { name: 'My Benefits',   path: '/benefits',   icon: '⊕' },
    { name: 'My Cases',      path: '/hr-cases',   icon: '⚖' },
    { name: 'My Loans',       path: '/loans',              icon: '$' },
    { name: 'My Surveys',     path: '/surveys',             icon: '◊' },
  ]},
];

// Employee ESS nav — default inherited role for all employees
const EMPLOYEE_NAV: NavGroup[] = [
  { group: 'OVERVIEW',  color: 'text-accent',  items: [{ name: 'Dashboard', path: '/', icon: '⬡' }, { name: 'Notifications', path: '/notifications', icon: '◍' }] },
  { group: 'EMPLOYEE',  color: 'text-accent',     items: [
    { name: 'My Attendance', path: '/attendance',          icon: '◉' },
    { name: 'My Schedule',   path: '/attendance/schedule', icon: '▦' },
    { name: 'My Leave',      path: '/leave',               icon: '◌' },
    { name: 'My Claims',     path: '/claims',              icon: '◫' },
    { name: 'My Training',   path: '/training?view=me',            icon: '◑' },
    { name: 'My Appraisal',  path: '/performance?view=me',         icon: '▣' },
    { name: 'My Documents',  path: '/documents',           icon: '◭' },
    { name: 'My Benefits',   path: '/benefits',            icon: '⊕' },
    { name: 'My Cases',      path: '/hr-cases',            icon: '⚖' },
    { name: 'My Loans',       path: '/loans',              icon: '$' },
    { name: 'My Surveys',     path: '/surveys',             icon: '◊' },
  ]},
  { group: 'PAYSLIPS',  color: 'text-accent', items: [
    { name: 'My Payslips', path: '/payroll/me', icon: '◆' },
  ]},
  { group: 'SUPPORT',   color: 'text-muted',   items: [
    { name: 'Staff Directory', path: '/staff',   icon: '◈' },
    { name: 'Help & Support',  path: '/support', icon: '◇' },
  ]},
];

const ROLE_LABELS: Record<string, { label: string; color: string; dot: string }> = {
  SUPER_ADMIN:      { label: 'Super Admin',      color: 'text-accent', dot: 'bg-accent' },
  ADMIN:            { label: 'Admin',            color: 'text-accent', dot: 'bg-accent' },
  IT_ADMIN:         { label: 'IT Admin',         color: 'text-ink',    dot: 'bg-ink'    },
  HR_ADMIN:         { label: 'HR Admin',         color: 'text-accent', dot: 'bg-accent' },
  HR_MANAGER:       { label: 'HR Manager',       color: 'text-accent',   dot: 'bg-accent'   },
  PAYROLL_OFFICER:  { label: 'Payroll Officer',  color: 'text-accent',dot: 'bg-accent'},
  FINANCE_ADMIN:    { label: 'Finance Admin',    color: 'text-accent',   dot: 'bg-accent'   },
  RECRUITER:        { label: 'Recruiter',        color: 'text-highlight',  dot: 'bg-highlight'  },
  TRAINING_MANAGER: { label: 'Training Mgr',     color: 'text-highlight', dot: 'bg-highlight' },
  LINE_MANAGER:     { label: 'Line Manager',     color: 'text-accent',    dot: 'bg-accent'    },
  EMPLOYEE:         { label: 'Employee',         color: 'text-muted',  dot: 'bg-muted'  },
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

  const authErrorBanner = null;

  const effectiveRole = liveRole;
  const roleInfo = ROLE_LABELS[effectiveRole] || ROLE_LABELS['EMPLOYEE'];

  const navGroups = getNavGroups(effectiveRole, '', isSuperAdmin);

  // Page title from path
  const getPageTitle = () => {
    const seg = pathname.split('/').filter(Boolean);
    if (!seg.length) return 'Command Centre';
    return seg[seg.length - 1].replace(/-/g, ' ').replace(/\//g, ' › ').toUpperCase();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-shadow flex items-center justify-center">
        <div className="flex flex-col items-center gap-6">
          <div className="relative w-16 h-16">
            <div className="absolute inset-0 border-4 border-accent/20 border-t-accent animate-spin rounded-full"></div>
            <div className="absolute inset-3 border-4 border-rule border-t-accent animate-spin [animation-direction:reverse] [animation-duration:0.6s] rounded-full"></div>
          </div>
          <p className="text-[10px] font-black text-muted uppercase tracking-[0.4em] animate-pulse">Authenticating Identity...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-paper font-sans overflow-hidden selection:bg-accent selection:text-accent relative">
      {authErrorBanner}

      {/* Navigation loading overlay */}
      {isNavigating && (
        <div className="fixed inset-0 z-[60] pointer-events-none">
          {/* Thin progress bar at top */}
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-accent/20 overflow-hidden">
            <div className="h-full bg-accent w-3/5" style={{ animation: 'navprogress 1.2s ease-in-out infinite' }} />
          </div>
          {/* Content area overlay with destination label */}
          <div className="absolute inset-y-0 left-0 lg:left-64 right-0 flex flex-col items-center justify-center gap-4 bg-paper/80 backdrop-blur-[2px]">
            <div className="flex flex-col items-center gap-3">
              <div className="relative w-10 h-10">
                <div className="absolute inset-0 border-[3px] border-accent border-t-accent animate-spin rounded-full" />
                <div className="absolute inset-[5px] border-[2px] border-rule border-t-accent animate-spin [animation-direction:reverse] [animation-duration:0.5s] rounded-full" />
              </div>
              {navTarget && (
                <p className="text-[9px] font-black text-muted uppercase tracking-[0.35em]">
                  Loading {navTarget}…
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-shadow backdrop- lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── SIDEBAR ─────────────────────────────────────────────────────────── */}
      <aside
        className={`w-64 bg-[#0a1628] flex flex-col z-50 shrink-0 fixed lg:relative inset-y-0 left-0 transition-transform duration-300 lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Brand */}
        <div className="relative px-5 pt-5 pb-4 border-b border-paper/5 flex items-center gap-3">
          <GaDongMark size={34} stroke="#ffffff" accent="#cda64c" className="shrink-0" />
          <div className="flex flex-col min-w-0">
            <span className="font-black text-paper tracking-[0.18em] uppercase text-sm leading-none">GaDongHR</span>
            <span className="text-[8px] font-black text-gold-400/80 mt-1 tracking-[0.25em] uppercase truncate">CRM · HR · Payroll</span>
          </div>
        </div>

        {/* Role badge */}
        <div className="relative mx-3 mt-3">
          <div className={`px-3 py-2 border flex items-center gap-2.5 ${
            isSuperAdmin
              ? 'bg-accent/10 border-accent/20'
              : 'bg-paper/3 border-paper/6'
          }`}>
            <div className={`w-1.5 h-1.5 shrink-0 ${roleInfo.dot} ${isSuperAdmin ? 'animate-pulse' : ''}`} />
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
                <div className="flex-1 h-px bg-paper/5" />
              </div>
              {/* Items */}
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const itemBase = item.path.split('?')[0];
                  const itemMy = item.path.includes('view=me');
                  const dual = itemBase === '/training' || itemBase === '/performance';
                  const baseMatch = pathname === itemBase || (itemBase !== '/' && pathname.startsWith(itemBase));
                  const isActive = baseMatch && (!dual || itemMy === isMyView);
                  return (
                    <Link
                      key={item.path}
                      href={item.path}
                      onClick={() => {
                        if (!isActive) {
                          setIsNavigating(true);
                          setNavTarget(item.name);
                        }
                      }}
                      className={`flex items-center gap-2.5 px-3 py-2.5 text-[11px] font-bold tracking-wide transition-all duration-200 group relative ${
                        isActive
                          ? 'border-l-2 border-accent bg-paper/5 text-paper'
                          : 'text-muted hover:bg-paper/5 hover:text-paper'
                      }`}
                    >
                      {isActive && (
                        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-paper/60" />
                      )}
                      <span className={`text-xs shrink-0 w-5 text-center transition-colors ${isActive ? 'text-paper' : 'text-muted group-hover:text-accent'}`}>
                        {item.icon}
                      </span>
                      <span className="flex-1 truncate">{item.name}</span>
                      {item.badge && (
                        <span className="text-[7px] font-black px-1.5 py-0.5 bg-highlight text-ink uppercase tracking-wide shrink-0">
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
        <div className="relative p-3 border-t border-paper/5">
          <div className="flex items-center gap-2.5 p-3 bg-paper/4 border border-paper/6 mb-2 cursor-default">
            <div className={`w-8 h-8 flex items-center justify-center text-[10px] font-black shrink-0 ${
              isSuperAdmin ? 'bg-accent/30 text-accent' : 'bg-paper/10 text-paper'
            }`}>
              {user?.name?.substring(0, 2).toUpperCase() || (isSuperAdmin ? 'SA' : 'U')}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold text-paper truncate">
                {user?.name || (isSuperAdmin ? 'Administrator' : 'User')}
              </p>
              <p className="text-[8px] text-muted truncate mt-0.5 uppercase tracking-wider">
                {user?.email || ''}
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              localStorage.removeItem('gadonghr_admin_confirmed');
              localStorage.removeItem('gadonghr_user_role');
              logout();
            }}
            className="w-full py-2 text-[8px] font-black text-muted hover:text-ink transition-all uppercase tracking-[0.3em] border border-rule hover:bg-ink/5 hover:border-ink/20 active:scale-95"
          >
            ⬡ Terminate Session
          </button>
        </div>
      </aside>

      {/* ── MAIN CONTENT ─────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="h-14 bg-paper border-b border-rule px-4 lg:px-8 flex items-center justify-between sticky top-0 z-30 shrink-0">
          <div className="flex items-center gap-3 lg:gap-4 min-w-0">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden w-9 h-9 flex items-center justify-center hover:bg-paper active:bg-muted transition-all"
              aria-label="Open navigation menu"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-muted">
                <line x1="4" y1="6" x2="20" y2="6"/>
                <line x1="4" y1="12" x2="20" y2="12"/>
                <line x1="4" y1="18" x2="20" y2="18"/>
              </svg>
            </button>
            <div className="hidden lg:block w-0.5 h-5 bg-accent" />
            <h2 className="text-[11px] font-black text-ink uppercase tracking-[0.25em] truncate">{getPageTitle()}</h2>
            {isSuperAdmin && (
              <span className="hidden sm:inline text-[7px] font-black px-2.5 py-1 bg-accent text-accent border border-accent uppercase tracking-widest shrink-0">
                Super Admin · Full Access
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 lg:gap-5 shrink-0">
            <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 bg-paper border border-rule">
              <div className="w-1.5 h-1.5 bg-accent animate-pulse" />
              <span className="text-[8px] font-black text-muted uppercase tracking-widest">System: <span className="text-accent">Online</span></span>
            </div>
            <div className="hidden lg:block h-4 w-px bg-muted" />
            <NotificationBell />
            <div className="hidden lg:block h-4 w-px bg-muted" />
            {/* Brand lockup on the light top bar — cream-background JPEG */}
            <img
              src="/gadonghr-logo.jpg"
              alt="GaDongHR — CRM · HR · Payroll"
              className="hidden lg:block h-7 w-auto"
            />
            <div className="hidden lg:flex flex-col items-end">
              <p className="text-[8px] font-black text-muted uppercase tracking-[0.15em] leading-none">v1.1.0</p>
              <p className="text-[7px] font-bold text-gold-500 mt-0.5 uppercase tracking-widest leading-none">SG Compliance</p>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto custom-scrollbar bg-paper">
          <TrialBanner />
          <div className="max-w-[1500px] mx-auto p-3 sm:p-4 lg:p-8">
            {children}
          </div>
        </main>
      </div>
      <FloatingAssistant />
    </div>
  );
}
