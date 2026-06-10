'use strict';

// Tenant-scoped Prisma client. The shared extension auto-injects where:{tenantId}
// on reads and tenantId on creates for every model that has a tenantId field —
// see shared/tenant-context. Defensive: if the shared module is mocked (unit
// tests) applyTenantScope may be absent, so fall back to the raw client.
const { PrismaClient, Prisma } = require('@prisma/client');
const tc = require('/app/shared/tenant-context');
const applyTenantScope = (tc && typeof tc.applyTenantScope === 'function')
  ? tc.applyTenantScope
  : ((base) => base);

module.exports = applyTenantScope(new PrismaClient(), Prisma);
