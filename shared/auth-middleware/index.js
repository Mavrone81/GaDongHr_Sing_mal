'use strict';

/**
 * JWT RS256 verification middleware + RBAC helpers
 * Used by all EzyHRM microservices via the shared lib
 */

const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

let _publicKey = null;

function getPublicKey() {
  if (_publicKey) return _publicKey;
  const keyPath = process.env.JWT_PUBLIC_KEY_PATH || path.join(__dirname, '../../certs/public.pem');
  if (!fs.existsSync(keyPath)) {
    throw new Error(`JWT public key not found at: ${keyPath}`);
  }
  _publicKey = fs.readFileSync(keyPath, 'utf8');
  return _publicKey;
}

/**
 * Express middleware: verify JWT bearer token
 */
function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, getPublicKey(), { algorithms: ['RS256'] });
    req.user = payload;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
}

/**
 * RBAC middleware factory: allow only specified roles
 * Usage: router.get('/admin', authenticate, authorize('super_admin', 'hr_admin'), handler)
 */
function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    const userRole = req.user.role;
    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: `Role '${userRole}' is not permitted to access this resource. Required: ${allowedRoles.join(', ')}`,
      });
    }
    next();
  };
}

/**
 * Self-access guard: employee can only access their own records,
 * unless they are a privileged role
 */
function authorizeSelfOrRole(paramName, ...privilegedRoles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    const targetId = req.params[paramName];
    const userId = req.user.employeeId || req.user.sub;
    if (userId === targetId || privilegedRoles.includes(req.user.role)) {
      return next();
    }
    return res.status(403).json({ error: 'You can only access your own records' });
  };
}

const ROLES = {
  SUPER_ADMIN: 'super_admin',
  HR_ADMIN: 'hr_admin',
  HR_MANAGER: 'hr_manager',
  PAYROLL_OFFICER: 'payroll_officer',
  RECRUITER: 'recruiter',
  TRAINING_MANAGER: 'training_manager',
  LINE_MANAGER: 'line_manager',
  EMPLOYEE: 'employee',
  FINANCE_ADMIN: 'finance_admin',
  IT_ADMIN: 'it_admin',
};

module.exports = { authenticate, authorize, authorizeSelfOrRole, ROLES };
