'use strict';

// Tenant-scoped Prisma client. The shared extension auto-injects where:{tenantId}
// on reads and tenantId on creates for every model that has a tenantId field.
// Defensive: if the shared module is mocked (unit tests), fall back to raw.
const { PrismaClient, Prisma } = require('@prisma/client');
const tc = require('/app/shared/tenant-context');
const applyTenantScope = (tc && typeof tc.applyTenantScope === 'function')
  ? tc.applyTenantScope
  : ((base) => base);

module.exports = applyTenantScope(new PrismaClient(), Prisma);
