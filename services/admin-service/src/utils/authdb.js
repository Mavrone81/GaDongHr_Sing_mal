'use strict';
// Raw pg pool to the auth-service DB (hrms_auth) so the control plane can
// list/suspend/extend tenants + read subscriptions without crossing the tenant
// request path. Read/write here deliberately bypasses tenant scoping.
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.AUTH_DATABASE_URL });
module.exports = pool;
