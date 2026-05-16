'use strict';
module.exports = {
  authenticate: (req, _res, next) => next(),
  authorize: () => (_req, _res, next) => next(),
  checkInternal: (req, _res, next) => { req.isInternal = false; next(); },
  ROLES: {
    SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN', HR_MANAGER: 'HR_MANAGER',
    PAYROLL_OFFICER: 'PAYROLL_OFFICER', LINE_MANAGER: 'LINE_MANAGER', EMPLOYEE: 'EMPLOYEE',
  },
};
