'use strict';

const { PrismaClient } = require('@prisma/client');
const { getTenantId, isBypassed, TENANT_SCOPED_MODELS } = require('./tenantContext');

// Operations that take a `where` we can filter by tenantId.
const WHERE_OPS = new Set([
  'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy',
  'updateMany', 'deleteMany', 'findUnique', 'findUniqueOrThrow', 'update', 'delete', 'upsert',
]);

const base = new PrismaClient();

// Auto-scoping extension: when a tenant context is active (and not explicitly
// bypassed), every read/update/delete on a tenant-scoped model is filtered by
// tenantId, and every create stamps the tenantId. This makes cross-tenant
// access impossible by default — see __tests__/tenant-isolation.test.js.
//
// Guarded: some unit tests mock @prisma/client (no `$extends`); fall back to the
// raw mock there. In real runtime `$extends` is always present.
const prisma = typeof base.$extends === 'function' ? base.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const tenantId = getTenantId();

        if (!tenantId || isBypassed() || !TENANT_SCOPED_MODELS.has(model)) {
          return query(args);
        }

        // Filter reads/updates/deletes by tenantId. Prisma (v5) accepts extra
        // non-unique filters in findUnique's `where` alongside the unique key,
        // so a mismatched-tenant lookup simply returns null.
        if (WHERE_OPS.has(operation)) {
          args = { ...args, where: { ...(args.where || {}), tenantId } };
        }

        // Stamp tenantId on creates.
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
}) : base;

module.exports = prisma;
