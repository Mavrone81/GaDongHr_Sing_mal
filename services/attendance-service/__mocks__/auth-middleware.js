'use strict';
// Stub for /app/shared/auth-middleware used in Jest test environment.
// The real module is only available inside the Docker container.
module.exports = {
  authenticate: (req, _res, next) => next(),
  authorize: () => (_req, _res, next) => next(),
  ROLES: {
    SUPER_ADMIN: 'SUPER_ADMIN',
    HR_ADMIN: 'HR_ADMIN',
    HR_MANAGER: 'HR_MANAGER',
    PAYROLL_OFFICER: 'PAYROLL_OFFICER',
    LINE_MANAGER: 'LINE_MANAGER',
    EMPLOYEE: 'EMPLOYEE',
  },
};
