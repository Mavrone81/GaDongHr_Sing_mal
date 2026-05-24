'use strict';
module.exports = {
  authenticate: (req, _res, next) => {
    req.user = {
      sub: req.headers['x-user-id'] || 'admin-1',
      email: 'admin@test.com',
      role: req.headers['x-user-role'] || 'HR_ADMIN',
    };
    next();
  },
  authorize: () => (_req, _res, next) => next(),
  ROLES: {
    SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN', HR_MANAGER: 'HR_MANAGER',
    IT_ADMIN: 'IT_ADMIN', MANAGER: 'MANAGER', EMPLOYEE: 'EMPLOYEE',
  },
};
