'use strict';

let mockUser = { sub: 'admin-001', email: 'admin@test.com', role: 'HR_ADMIN', employeeId: null };
const setUser = u => { mockUser = u; };

module.exports = {
  authenticate: (req, _res, next) => { req.user = mockUser; next(); },
  authorize: () => (_req, _res, next) => next(),
  authorizeSelfOrRole: () => (_req, _res, next) => next(),
  ROLES: {
    SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN', HR_MANAGER: 'HR_MANAGER',
    LINE_MANAGER: 'LINE_MANAGER', EMPLOYEE: 'EMPLOYEE', PAYROLL_OFFICER: 'PAYROLL_OFFICER',
  },
  // Helper for tests
  __setUser: setUser,
};
