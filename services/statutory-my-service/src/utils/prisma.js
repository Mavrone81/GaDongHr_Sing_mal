'use strict';

// No tenant-scoping extension here, unlike every other service's prisma.js.
// These tables are global by design (ENT-004) — national statutory figures with
// no tenantId to scope by. Adding the extension would look consistent and be
// wrong: it would try to filter on a column that does not exist.
const { PrismaClient } = require('@prisma/client');

module.exports = new PrismaClient();
