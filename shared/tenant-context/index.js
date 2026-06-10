'use strict';

// Shared multi-tenancy primitives used by every service (Phase 2).
//
// - AsyncLocalStorage carries the request's tenantId.
// - applyTenantScope() wraps a PrismaClient so every read/update/delete on a
//   tenant-scoped model is filtered by tenantId and every create stamps it —
//   making cross-tenant access impossible by default.
// - Scoped models are AUTO-DETECTED from the Prisma DMMF (any model that has a
//   `tenantId` field), so each service needs zero per-model configuration.
//
// Dependency-free (async_hooks only) so it requires no npm install / Dockerfile
// change — it ships via the existing `COPY shared /app/shared`.
const { AsyncLocalStorage } = require('async_hooks');

// Fixed id of the "Default" tenant that owns all pre-multitenancy data.
const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';

const als = new AsyncLocalStorage();

const WHERE_OPS = new Set([
  'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy',
  'updateMany', 'deleteMany', 'findUnique', 'findUniqueOrThrow', 'update', 'delete', 'upsert',
]);

// Establish a fresh context. tenantId may be undefined (public/unauthenticated
// or internal service calls) — those are not auto-scoped. The store is mutable
// so `setTenant` (called from the auth middleware once the JWT is verified) can
// populate it after this wrapper has been installed.
function run(tenantId, fn) {
  return als.run({ tenantId, bypass: false }, fn);
}

// Deliberately bypass tenant scoping (cross-tenant lookups, seeds, backfills).
function runUnscoped(fn) {
  return als.run({ tenantId: undefined, bypass: true }, fn);
}

function getTenantId() {
  const s = als.getStore();
  return s ? s.tenantId : undefined;
}

function setTenant(tenantId) {
  const s = als.getStore();
  if (s) s.tenantId = tenantId;
}

function isBypassed() {
  const s = als.getStore();
  return !!(s && s.bypass);
}

// Express middleware: install a (mutable) tenant context for the request. Place
// it before the routes. The auth middleware fills in the tenantId after it
// verifies the JWT.
function tenantContextMiddleware(req, res, next) {
  als.run({ tenantId: undefined, bypass: false }, () => next());
}

// Wrap a PrismaClient with the auto-scoping extension. Falls back to the raw
// client when $extends is unavailable (mocked unit tests).
function applyTenantScope(base, Prisma) {
  if (!base || typeof base.$extends !== 'function') return base;

  let scoped = new Set();
  try {
    const models = (Prisma && Prisma.dmmf && Prisma.dmmf.datamodel && Prisma.dmmf.datamodel.models) || [];
    scoped = new Set(models.filter((m) => m.fields.some((f) => f.name === 'tenantId')).map((m) => m.name));
  } catch { /* no DMMF → scope nothing (safe no-op) */ }

  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const tenantId = getTenantId();
          if (!tenantId || isBypassed() || !scoped.has(model)) {
            return query(args);
          }
          if (WHERE_OPS.has(operation)) {
            args = { ...args, where: { ...(args.where || {}), tenantId } };
          }
          if (operation === 'create') {
            args = { ...args, data: { ...(args.data || {}), tenantId } };
          } else if (operation === 'createMany') {
            const rows = Array.isArray(args.data) ? args.data : [args.data];
            args = { ...args, data: rows.map((d) => ({ ...d, tenantId })) };
          } else if (operation === 'upsert') {
            args = { ...args, create: { ...(args.create || {}), tenantId } };
          }
          return query(args);
        },
      },
    },
  });
}

module.exports = {
  DEFAULT_TENANT_ID,
  als,
  run,
  runUnscoped,
  getTenantId,
  setTenant,
  isBypassed,
  tenantContextMiddleware,
  applyTenantScope,
};
