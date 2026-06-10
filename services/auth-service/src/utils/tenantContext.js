'use strict';

// Request-scoped tenant context. The auto-scoping Prisma extension (prisma.js)
// reads the current tenantId from here to inject `where: { tenantId }` on reads
// and `tenantId` on creates — so isolation is the DEFAULT and a forgotten
// `where` clause can't leak across tenants.
const { AsyncLocalStorage } = require('async_hooks');

// Fixed id of the "Default" tenant that owns all pre-multitenancy data.
const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';

const als = new AsyncLocalStorage();

// Models (Prisma model names) that carry a `tenantId` column and must be scoped.
// Global/indirect models (Permission, RolePermission, RefreshToken, Tenant) are
// intentionally excluded.
const TENANT_SCOPED_MODELS = new Set([
  'User', 'Role', 'OrgSetting', 'AuditLog', 'OtpToken', 'Subscription', 'CompanyProfile',
]);

// Run `fn` inside a fresh context carrying `tenantId` (may be undefined for
// public/unauthenticated requests — those are not auto-scoped).
function run(tenantId, fn) {
  return als.run({ tenantId, bypass: false }, fn);
}

// Deliberately run WITHOUT tenant scoping — for cross-tenant lookups that must
// precede tenant resolution (e.g. login finding a user by email across tenants)
// and for the backfill/seed scripts. Use sparingly.
function runUnscoped(fn) {
  return als.run({ tenantId: undefined, bypass: true }, fn);
}

function getTenantId() {
  const s = als.getStore();
  return s ? s.tenantId : undefined;
}

function setTenantId(tenantId) {
  const s = als.getStore();
  if (s) s.tenantId = tenantId;
}

function isBypassed() {
  const s = als.getStore();
  return !!(s && s.bypass);
}

module.exports = {
  DEFAULT_TENANT_ID,
  als,
  run,
  runUnscoped,
  getTenantId,
  setTenantId,
  isBypassed,
  TENANT_SCOPED_MODELS,
};
