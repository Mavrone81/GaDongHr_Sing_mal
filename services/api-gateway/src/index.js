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
  asset:        process.env.ASSET_SERVICE_URL        || 'http://asset-service:4011',
  performance:  process.env.PERFORMANCE_SERVICE_URL  || 'http://performance-service:4012',
  training:     process.env.TRAINING_SERVICE_URL     || 'http://training-service:4013',
  support:      process.env.SUPPORT_SERVICE_URL      || 'http://support-service:4014',
  esign:        process.env.ESIGN_SERVICE_URL        || 'http://esign-service:4015',
  benefits:     process.env.BENEFITS_SERVICE_URL     || 'http://benefits-service:4016',
  hrCase:       process.env.HR_CASE_SERVICE_URL      || 'http://hr-case-service:4017',
  loans:        process.env.LOANS_SERVICE_URL        || 'http://loans-service:4018',
  survey:       process.env.SURVEY_SERVICE_URL       || 'http://survey-service:4019',
};

const corsOptions = { 
  origin: '*', 
  methods: ['GET','POST','PUT','DELETE','PATCH','OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-user-id', 'x-user-role', 'x-employee-id']
};
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
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
  { method: 'POST', path: /^\/api\/auth\/otp\/resend$/ },
  { method: 'GET',  path: /^\/api\/auth\/org-settings\/mfa$/ },
  { method: 'GET',  path: /^\/api\/auth\/sso\/google\/config$/ },
  { method: 'POST', path: /^\/api\/auth\/sso\/google\/callback$/ },
  { method: 'GET',  path: /^\/api\/auth\/sso\/microsoft\/config$/ },
  { method: 'POST', path: /^\/api\/auth\/sso\/microsoft\/callback$/ },
  { method: 'POST', path: /^\/api\/auth\/sso\/mfa-verify$/ },
  { method: 'GET',  path: /^\/api\/users\/invite\/.+$/ },
  { method: 'POST', path: /^\/api\/employees\/apply$/ },
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
    const payload = jwt.verify(token, cachedPublicKey, { algorithms: ['RS256'], issuer: 'vorkhive' });
    req.user = payload;
    req.headers['x-user-id'] = payload.sub;
    req.headers['x-user-role'] = payload.role;
    req.headers['x-employee-id'] = payload.employeeId || '';
    next();
  } catch (err) {
    console.error('[GATEWAY AUTH ERROR]', err.name, err.message);
    if (err.name === 'TokenExpiredError') return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    return res.status(401).json({ error: 'Invalid token' });
  }
}

app.use(jwtMiddleware);

// ── Proxy Routes ─────────────────────────────────────────────────────────────
const proxyOpts = {
  proxyReqOptDecorator: (opts, srcReq) => {
    opts.headers['x-gateway'] = 'vorkhive-gateway';
    return opts;
  },
};

app.use('/api/auth',         proxy(SERVICES.auth,         { ...proxyOpts, proxyReqPathResolver: req => req.originalUrl.replace('/api/auth', '/auth') }));
app.use('/api/users',        proxy(SERVICES.auth,         { ...proxyOpts, proxyReqPathResolver: req => req.originalUrl.replace('/api/users', '/users') }));
app.use('/api/roles',        proxy(SERVICES.auth,         { ...proxyOpts, proxyReqPathResolver: req => req.originalUrl.replace('/api/roles', '/roles') }));
app.use('/api/employees',    proxy(SERVICES.employee,     { ...proxyOpts, proxyReqPathResolver: req => req.originalUrl.replace('/api/employees', '/employees') }));
app.use('/api/documents',    proxy(SERVICES.employee,     { ...proxyOpts, proxyReqPathResolver: req => req.originalUrl.replace('/api/documents', '/documents') }));
app.use('/api/movements',    proxy(SERVICES.employee,     { ...proxyOpts, proxyReqPathResolver: req => req.originalUrl.replace('/api/movements', '/movements') }));
app.use('/api/payroll',      proxy(SERVICES.payroll,      { ...proxyOpts, proxyReqPathResolver: req => req.originalUrl.replace('/api/payroll', '/payroll') }));
app.use('/api/components',   proxy(SERVICES.payroll,      { ...proxyOpts, proxyReqPathResolver: req => req.originalUrl.replace('/api/components', '/components') }));
// Leave application creation supports multipart attachments — stream raw body
app.use('/api/leave/applications', proxy(SERVICES.leave, { ...proxyOpts, parseReqBody: false, proxyReqPathResolver: req => req.originalUrl.replace('/api/leave', '/leave') }));
app.use('/api/leave',        proxy(SERVICES.leave,        { ...proxyOpts, proxyReqPathResolver: req => req.originalUrl.replace('/api/leave', '/leave') }));
app.use('/api/claims',       proxy(SERVICES.claims,       { ...proxyOpts, proxyReqPathResolver: req => req.originalUrl.replace('/api/claims', '/claims') }));
// Resume upload route needs raw body streaming (no body parsing)
app.use('/api/recruitment/candidates/:id/resume', proxy(SERVICES.recruitment, { ...proxyOpts, parseReqBody: false, proxyReqPathResolver: req => req.originalUrl.replace('/api/recruitment', '/recruitment') }));
app.use('/api/recruitment',  proxy(SERVICES.recruitment,  { ...proxyOpts, proxyReqPathResolver: req => req.originalUrl.replace('/api/recruitment', '/recruitment') }));
app.use('/api/attendance',   proxy(SERVICES.attendance,   { ...proxyOpts, proxyReqPathResolver: req => req.originalUrl.replace('/api/attendance', '/attendance') }));
app.use('/api/offboarding',  proxy(SERVICES.offboarding,  { ...proxyOpts, proxyReqPathResolver: req => req.originalUrl.replace('/api/offboarding', '/offboarding') }));
app.use('/api/notifications',proxy(SERVICES.notification, { ...proxyOpts, proxyReqPathResolver: req => req.originalUrl.replace('/api/notifications', '/notifications') }));
app.use('/api/reports',      proxy(SERVICES.reporting,    { ...proxyOpts, proxyReqPathResolver: req => req.originalUrl.replace('/api/reports', '/reports') }));
app.use('/api/assets',       proxy(SERVICES.asset,        { ...proxyOpts, proxyReqPathResolver: req => req.originalUrl.replace('/api/assets', '/assets') }));
app.use('/api/performance',  proxy(SERVICES.performance,  { ...proxyOpts, proxyReqPathResolver: req => req.originalUrl.replace('/api/performance', '/performance') }));
app.use('/api/training',     proxy(SERVICES.training,     { ...proxyOpts, proxyReqPathResolver: req => req.originalUrl.replace('/api/training', '/training') }));
app.use('/api/support',      proxy(SERVICES.support,      { ...proxyOpts, proxyReqPathResolver: req => req.originalUrl.replace('/api/support', '/support') }));
app.use('/api/esign',        proxy(SERVICES.esign,        { ...proxyOpts, proxyReqPathResolver: req => req.originalUrl.replace('/api/esign', '/esign') }));
app.use('/api/benefits',     proxy(SERVICES.benefits,     { ...proxyOpts, proxyReqPathResolver: req => req.originalUrl.replace('/api/benefits', '/benefits') }));
app.use('/api/hr-cases',     proxy(SERVICES.hrCase,       { ...proxyOpts, proxyReqPathResolver: req => req.originalUrl.replace('/api/hr-cases', '/hr-cases') }));
app.use('/api/loans',        proxy(SERVICES.loans,        { ...proxyOpts, proxyReqPathResolver: req => req.originalUrl.replace('/api/loans', '/loans') }));
app.use('/api/surveys',      proxy(SERVICES.survey,       { ...proxyOpts, proxyReqPathResolver: req => req.originalUrl.replace('/api/surveys', '/surveys') }));

app.use((err, req, res, next) => { console.error(err.message); res.status(502).json({ error: 'Gateway error', message: err.message }); });

app.listen(PORT, () => console.log(`[api-gateway] Running on port ${PORT}`));
