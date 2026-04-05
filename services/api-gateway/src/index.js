'use strict';
require('dotenv').config();
const express = require('express');
const proxy = require('express-http-proxy');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 4000;

// Upstream service URLs
const SERVICES = {
  auth:         process.env.AUTH_SERVICE_URL         || 'http://auth-service:4001',
  employee:     process.env.EMPLOYEE_SERVICE_URL     || 'http://employee-service:4002',
  payroll:      process.env.PAYROLL_SERVICE_URL      || 'http://payroll-service:4003',
  leave:        process.env.LEAVE_SERVICE_URL        || 'http://leave-service:4004',
  claims:       process.env.CLAIMS_SERVICE_URL       || 'http://claims-service:4005',
  recruitment:  process.env.RECRUITMENT_SERVICE_URL  || 'http://recruitment-service:4006',
  attendance:   process.env.ATTENDANCE_SERVICE_URL   || 'http://attendance-service:4007',
  offboarding:  process.env.OFFBOARDING_SERVICE_URL  || 'http://offboarding-service:4008',
  notification: process.env.NOTIFICATION_SERVICE_URL || 'http://notification-service:4009',
  reporting:    process.env.REPORTING_SERVICE_URL    || 'http://reporting-service:4010',
};

const corsOptions = { 
  origin: '*', 
  methods: ['GET','POST','PUT','DELETE','PATCH','OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-user-id', 'x-user-role', 'x-employee-id']
};
app.use(helmet());
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(morgan('combined'));

// Global rate limit: 200 req/min per IP
const globalLimiter = rateLimit({
  windowMs: 60 * 1000, max: 200,
  message: { error: 'Too many requests, please slow down' },
});
app.use(globalLimiter);

// Health check
app.get('/health', (req, res) => res.json({ service: 'api-gateway', status: 'ok', ts: new Date(), services: Object.keys(SERVICES) }));

// ── JWT Middleware (public routes bypass) ─────────────────────────────────────
const PUBLIC_ROUTES = [
  { method: 'POST', path: /^\/api\/auth\/login$/ },
  { method: 'POST', path: /^\/api\/auth\/refresh$/ },
  { method: 'GET',  path: /^\/health$/ },
];

let cachedPublicKey = null;

function jwtMiddleware(req, res, next) {
  if (req.method === 'OPTIONS') return next();

  const isPublic = PUBLIC_ROUTES.some(r => r.method === req.method && r.path.test(req.path));
  if (isPublic) return next();

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }

  try {
    if (!cachedPublicKey) {
      const keyPath = process.env.JWT_PUBLIC_KEY_PATH || path.join(__dirname, '../../../certs/public.pem');
      cachedPublicKey = fs.readFileSync(keyPath, 'utf8');
    }
    const token = authHeader.slice(7);
    const payload = jwt.verify(token, cachedPublicKey, { algorithms: ['RS256'], issuer: 'ezyhRM' });
    req.user = payload;
    req.headers['x-user-id'] = payload.sub;
    req.headers['x-user-role'] = payload.role;
    req.headers['x-employee-id'] = payload.employeeId || '';
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    return res.status(401).json({ error: 'Invalid token' });
  }
}

app.use(jwtMiddleware);

// ── Proxy Routes ─────────────────────────────────────────────────────────────
const proxyOpts = {
  proxyReqOptDecorator: (opts, srcReq) => {
    opts.headers['x-gateway'] = 'ezyhRM-gateway';
    return opts;
  },
};

app.use('/api/auth',         proxy(SERVICES.auth,         { ...proxyOpts, proxyReqPathResolver: req => req.originalUrl.replace('/api/auth', '/auth') }));
app.use('/api/employees',    proxy(SERVICES.employee,     { ...proxyOpts, proxyReqPathResolver: req => req.originalUrl.replace('/api/employees', '/employees') }));
app.use('/api/documents',    proxy(SERVICES.employee,     { ...proxyOpts, proxyReqPathResolver: req => req.originalUrl.replace('/api/documents', '/documents') }));
app.use('/api/payroll',      proxy(SERVICES.payroll,      { ...proxyOpts, proxyReqPathResolver: req => req.originalUrl.replace('/api/payroll', '/payroll') }));
app.use('/api/components',   proxy(SERVICES.payroll,      { ...proxyOpts, proxyReqPathResolver: req => req.originalUrl.replace('/api/components', '/components') }));
app.use('/api/leave',        proxy(SERVICES.leave,        { ...proxyOpts, proxyReqPathResolver: req => req.originalUrl.replace('/api/leave', '/leave') }));
app.use('/api/claims',       proxy(SERVICES.claims,       { ...proxyOpts, proxyReqPathResolver: req => req.originalUrl.replace('/api/claims', '/claims') }));
app.use('/api/recruitment',  proxy(SERVICES.recruitment,  { ...proxyOpts, proxyReqPathResolver: req => req.originalUrl.replace('/api/recruitment', '/recruitment') }));
app.use('/api/attendance',   proxy(SERVICES.attendance,   { ...proxyOpts, proxyReqPathResolver: req => req.originalUrl.replace('/api/attendance', '/attendance') }));
app.use('/api/offboarding',  proxy(SERVICES.offboarding,  { ...proxyOpts, proxyReqPathResolver: req => req.originalUrl.replace('/api/offboarding', '/offboarding') }));
app.use('/api/notifications',proxy(SERVICES.notification, { ...proxyOpts, proxyReqPathResolver: req => req.originalUrl.replace('/api/notifications', '/notifications') }));
app.use('/api/reports',      proxy(SERVICES.reporting,    { ...proxyOpts, proxyReqPathResolver: req => req.originalUrl.replace('/api/reports', '/reports') }));

app.use((err, req, res, next) => { console.error(err.message); res.status(502).json({ error: 'Gateway error', message: err.message }); });

app.listen(PORT, () => console.log(`[api-gateway] Running on port ${PORT}`));
