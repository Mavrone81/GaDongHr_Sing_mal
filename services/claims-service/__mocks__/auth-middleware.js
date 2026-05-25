'use strict';
// Stub for /app/shared/auth-middleware used in Jest test environment.
module.exports = {
  authenticate: (req, _res, next) => { req.user = req.user || { sub: 'admin-001', email: 'admin@test.com', role: 'FINANCE_ADMIN' }; next(); },
  authorize: () => (_req, _res, next) => next(),
  authorizeSelfOrRole: () => (_req, _res, next) => next(),
  ROLES: {
    SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN', HR_MANAGER: 'HR_MANAGER',
    PAYROLL_OFFICER: 'PAYROLL_OFFICER', FINANCE_ADMIN: 'FINANCE_ADMIN',
    LINE_MANAGER: 'LINE_MANAGER', EMPLOYEE: 'EMPLOYEE',
  },
};
