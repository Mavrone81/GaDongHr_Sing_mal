/**
 * Endpoint manifest for the RBAC permission-boundary matrix.
 *
 * For each protected endpoint we record:
 *   - method + path (URL templated as `{var}` so we can substitute fixtures)
 *   - one of:
 *       requirePerm:  string  (e.g., 'leave:approve') — must be in user.permissions
 *       requireRole:  Role[]                          — role string must be in this list
 *
 * Each test case calls the endpoint with a forged JWT for each of 11 roles
 * and asserts the response code (200/201/204 vs 403).
 *
 * NOT exhaustive — covers the money-path endpoints across every module.
 * Add rows as new authorize() calls land.
 */

import { Role } from './roles';

export type ExpectedStatus = 'allowed' | 'denied';

export interface EndpointSpec {
  id: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;             // gateway path, e.g. '/api/leave/applications'
  // The gate: either a permission code (matches user.permissions) OR a list of roles.
  requirePerm?: string;
  requireRole?: Role[];
  // For POST/PUT/PATCH bodies — sent only when allowed. Body errors aren't asserted here.
  body?: () => Record<string, unknown> | FormData;
  // Allowed status codes (default: 200/201/204; we accept any 2xx OR 400 for body-validation
  // failures since RBAC passed before the validator caught a bad body).
  allowedStatuses?: number[];
  // Status when denied (default 403).
  deniedStatus?: number;
  // Skip the role-allowed assertion (only verify role-denied) — useful when the endpoint
  // requires extra state (e.g. an existing record) that the RBAC test shouldn't depend on.
  skipAllowedAssertion?: boolean;
}

export const ENDPOINTS: EndpointSpec[] = [
  // ── AUTH / Users ──
  { id: 'list-users',           method: 'GET',    path: '/api/users',                 requirePerm: 'user:manage' },
  { id: 'list-roles',           method: 'GET',    path: '/api/roles',                 requirePerm: 'role:manage' },
  { id: 'org-settings-general', method: 'GET',    path: '/api/auth/org-settings/general', requireRole: ['SUPER_ADMIN', 'IT_ADMIN'] },

  // ── Employees ──
  { id: 'list-employees',       method: 'GET',    path: '/api/employees',             requirePerm: 'employee:view' },
  { id: 'list-employees-active',method: 'GET',    path: '/api/employees?isActive=true&limit=10', requirePerm: 'employee:view' },

  // ── Leave ──
  { id: 'list-leave-types',     method: 'GET',    path: '/api/leave/types',           requirePerm: 'leave:view' },
  { id: 'list-leave-apps',      method: 'GET',    path: '/api/leave/applications?limit=5', requirePerm: 'leave:view' },
  { id: 'create-leave-type',    method: 'POST',   path: '/api/leave/types',
    requireRole: ['SUPER_ADMIN', 'HR_ADMIN'],
    body: () => ({ code: `T${Date.now()}`, name: 'Test Type', annualEntitlement: 1 }),
    allowedStatuses: [200, 201, 400], skipAllowedAssertion: true },

  // ── Payroll ──
  { id: 'list-payroll-runs',    method: 'GET',    path: '/api/payroll/runs',          requirePerm: 'payroll:view' },

  // ── Claims ──
  { id: 'list-claims',          method: 'GET',    path: '/api/claims',                requirePerm: 'claims:view' },

  // ── Attendance ──
  { id: 'admin-attendance',     method: 'GET',    path: '/api/attendance/admin/records?date=2026-05-21',
    requireRole: ['SUPER_ADMIN', 'HR_ADMIN', 'HR_MANAGER', 'PAYROLL_OFFICER'] },
  { id: 'list-locations',       method: 'GET',    path: '/api/attendance/locations',  requirePerm: 'attendance:manage' },
  { id: 'list-shifts',          method: 'GET',    path: '/api/attendance/shifts',     requirePerm: 'roster:view' },

  // ── Recruitment ──
  { id: 'list-jobs',            method: 'GET',    path: '/api/recruitment/jobs',      requirePerm: 'recruitment:view' },

  // ── Assets ──
  { id: 'list-assets',          method: 'GET',    path: '/api/assets',                requirePerm: 'asset:view' },
  { id: 'create-asset',         method: 'POST',   path: '/api/assets',
    requireRole: ['SUPER_ADMIN', 'HR_ADMIN', 'IT_ADMIN'],
    body: () => ({ name: `Test asset ${Date.now()}`, category: 'LAPTOP', serialNo: `SN${Date.now()}` }),
    allowedStatuses: [200, 201, 400], skipAllowedAssertion: true },

  // ── Reports ──
  { id: 'list-reports',         method: 'GET',    path: '/api/reports/types',         requirePerm: 'report:view' },

  // ── Training ──
  { id: 'list-training',        method: 'GET',    path: '/api/training/programs',     requireRole: ['SUPER_ADMIN', 'HR_ADMIN', 'HR_MANAGER', 'TRAINING_MANAGER', 'EMPLOYEE'] },

  // ── Performance ──
  { id: 'list-performance',     method: 'GET',    path: '/api/performance/cycles',    requireRole: ['SUPER_ADMIN', 'HR_ADMIN', 'HR_MANAGER'] },

  // ── Support ──
  { id: 'list-support-tickets', method: 'GET',    path: '/api/support/tickets',       requireRole: ['SUPER_ADMIN', 'HR_ADMIN', 'HR_MANAGER'] },
];
