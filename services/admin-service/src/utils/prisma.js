'use strict';
// Platform control-plane DB (hrms_admin). NOT tenant-scoped — no extension.
const { PrismaClient } = require('@prisma/client');
module.exports = new PrismaClient();
