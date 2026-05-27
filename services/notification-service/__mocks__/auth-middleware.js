'use strict';
let _currentUser = { sub: 'user-001', role: 'HR_ADMIN' };
const setUser = u => { _currentUser = { ..._currentUser, ...u }; };

module.exports = {
  authenticate: (req, _res, next) => { req.user = _currentUser; next(); },
  authorize: (...roles) => (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  },
  ROLES: {
    SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN', HR_MANAGER: 'HR_MANAGER',
    LINE_MANAGER: 'LINE_MANAGER', EMPLOYEE: 'EMPLOYEE', PAYROLL_OFFICER: 'PAYROLL_OFFICER',
    RECRUITER: 'RECRUITER', IT_ADMIN: 'IT_ADMIN',
  },
  _setUser: setUser,
};
