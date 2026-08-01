'use strict';
module.exports = {
  authenticate: (req, _res, next) => {
    // tenantId mirrors a real access token (signed at auth.routes.js:300).
    // Routes that scope by tenant read it, so omitting it here would let a
    // missing scope check pass unnoticed in tests.
    req.user = { sub: 'admin-001', email: 'admin@test.com', role: 'HR_ADMIN', tenantId: 'ten-1' };
    next();
  },
  authorize: () => (_req, _res, next) => next(),
  ROLES: {
    SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN', HR_MANAGER: 'HR_MANAGER',
    LINE_MANAGER: 'LINE_MANAGER', EMPLOYEE: 'EMPLOYEE', PAYROLL_OFFICER: 'PAYROLL_OFFICER',
  },
};
