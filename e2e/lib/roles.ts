/**
 * Role → permission map mirrored from services/auth-service/scripts/seed-rbac.js
 *
 * The source-of-truth seed is in JS so we re-export the same set here. If you
 * change seed-rbac.js, mirror the change here (or load it dynamically — left
 * static so a single typo in tests doesn't fall back to "no perms").
 */

export const ALL_PERMISSIONS = [
  'user:manage', 'role:manage', 'settings:manage',
  'employee:view', 'employee:manage', 'employee:sensitive', 'document:manage',
  'leave:view', 'leave:approve',
  'payroll:view', 'payroll:run',
  'claims:view', 'claims:approve',
  'attendance:view', 'attendance:manage', 'roster:view', 'roster:manage',
  'recruitment:view', 'recruitment:manage',
  'asset:view', 'asset:manage',
  'offboarding:manage',
  'report:view', 'report:financial',
] as const;

export type Permission = typeof ALL_PERMISSIONS[number];

export const ROLE_PERMS: Record<string, Permission[]> = {
  SUPER_ADMIN: [...ALL_PERMISSIONS],
  ADMIN: [
    'employee:view', 'employee:manage',
    'leave:view', 'leave:approve',
    'claims:view',
    'attendance:view', 'roster:view', 'roster:manage',
    'report:view',
  ],
  IT_ADMIN: [
    'user:manage', 'role:manage', 'settings:manage',
    'employee:view',
    'asset:view', 'asset:manage',
    'report:view',
  ],
  HR_ADMIN: [
    'employee:view', 'employee:manage', 'employee:sensitive', 'document:manage',
    'leave:view', 'leave:approve',
    'payroll:view',
    'claims:view', 'claims:approve',
    'attendance:view', 'attendance:manage', 'roster:view', 'roster:manage',
    'recruitment:view', 'recruitment:manage',
    'asset:view',
    'offboarding:manage',
    'report:view', 'report:financial',
  ],
  HR_MANAGER: [
    'employee:view', 'employee:manage', 'document:manage',
    'leave:view', 'leave:approve',
    'claims:view', 'claims:approve',
    'attendance:view', 'attendance:manage', 'roster:view', 'roster:manage',
    'recruitment:view', 'recruitment:manage',
    'asset:view',
    'report:view',
  ],
  PAYROLL_OFFICER: [
    'employee:view', 'employee:sensitive',
    'payroll:view', 'payroll:run',
    'attendance:view', 'roster:view',
    'report:view', 'report:financial',
  ],
  FINANCE_ADMIN: [
    'employee:view',
    'claims:view', 'claims:approve',
    'payroll:view',
    'asset:view',
    'report:view', 'report:financial',
  ],
  LINE_MANAGER: [
    'employee:view',
    'leave:view', 'leave:approve',
    'claims:view', 'claims:approve',
    'attendance:view', 'roster:view', 'roster:manage',
    'asset:view',
  ],
  RECRUITER: [
    'employee:view',
    'recruitment:view', 'recruitment:manage',
  ],
  TRAINING_MANAGER: [
    'employee:view',
    'report:view',
  ],
  EMPLOYEE: [
    'employee:view',
    'leave:view',
    'claims:view',
    'attendance:view',
    'asset:view',
  ],
};

export type Role = keyof typeof ROLE_PERMS;

export const ALL_ROLES = Object.keys(ROLE_PERMS) as Role[];
