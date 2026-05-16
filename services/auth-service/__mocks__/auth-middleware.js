'use strict';
module.exports = {
  authenticate: (req, _res, next) => {
    req.user = { sub: 'admin-001', email: 'admin@test.com', role: 'HR_ADMIN' };
    next();
  },
  authorize: () => (_req, _res, next) => next(),
  ROLES: {
    SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN', HR_MANAGER: 'HR_MANAGER',
    LINE_MANAGER: 'LINE_MANAGER', EMPLOYEE: 'EMPLOYEE', PAYROLL_OFFICER: 'PAYROLL_OFFICER',
  },
};
