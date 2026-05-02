'use strict';

/**
 * JWT RS256 verification middleware + RBAC helpers
 * Used by all Vorkhive microservices via the shared lib
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
 * RBAC middleware factory: allow specified roles OR permissions
 * Usage: 
 *   router.get('/payroll', authenticate, authorize('payroll:view'), handler)
 *   router.get('/admin', authenticate, authorize('SUPER_ADMIN'), handler)
 */
function authorize(...allowed) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    
    const userRole = req.user.role;
    const userPerms = req.user.permissions || [];

    // Allow if role is explicitly in list OR if permission is in list
    const hasAccess = allowed.some(item => 
      item === userRole || userPerms.includes(item)
    );

    if (!hasAccess) {
      return res.status(403).json({
        error: 'Forbidden',
        message: `You do not have the required role or permission. Required one of: ${allowed.join(', ')}`,
      });
    }
    next();
  };
}

/**
 * Self-access guard: employee can only access their own records,
 * unless they are a privileged role OR have a specific permission.
 */
function authorizeSelfOrRole(paramName, ...allowedItems) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    
    const targetId = req.params[paramName];
    const userId = req.user.employeeId || req.user.sub;
    const userRole = req.user.role;
    const userPerms = req.user.permissions || [];

    // Allow if target is SELF, OR role is in list, OR any listed permission is in user perms
    const isSelf = userId === targetId;
    const isPrivileged = allowedItems.some(item => 
      item === userRole || userPerms.includes(item)
    );

    if (isSelf || isPrivileged) {
      return next();
    }
    
    return res.status(403).json({ 
      error: 'Forbidden',
      message: 'You can only access your own records or you lack the required permission.' 
    });
  };
}

const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  HR_ADMIN: 'HR_ADMIN',
  HR_MANAGER: 'HR_MANAGER',
  PAYROLL_OFFICER: 'PAYROLL_OFFICER',
  RECRUITER: 'RECRUITER',
  TRAINING_MANAGER: 'TRAINING_MANAGER',
  LINE_MANAGER: 'LINE_MANAGER',
  EMPLOYEE: 'EMPLOYEE',
  FINANCE_ADMIN: 'FINANCE_ADMIN',
  IT_ADMIN: 'IT_ADMIN',
};

module.exports = { authenticate, authorize, authorizeSelfOrRole, ROLES };
