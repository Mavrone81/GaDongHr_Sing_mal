'use strict';
require('dotenv').config();
const express = require('express');
const proxy = require('express-http-proxy');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
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
  assistant:    process.env.ASSISTANT_SERVICE_URL    || 'http://assistant-service:4020',
};

// Explicit origin allowlist (CORS_ORIGINS is a comma-separated list of URLs).
// Previously this was `origin: '*'` and announced trust-headers (x-user-id /
// x-user-role / x-employee-id) in `allowedHeaders` — which let any browser
// page craft a request setting those identity headers. The gateway sets them
// server-side from the verified JWT (see jwtMiddleware), so they must never
// be acceptable from a client.
const corsAllowlist = (process.env.CORS_ORIGINS ||
  'http://localhost:8081,http://localhost:3000')
  .split(',').map(s => s.trim()).filter(Boolean);

const corsOptions = {
  origin(origin, cb) {
    // No Origin header (same-origin / curl / server-to-server) is allowed.
    if (!origin) return cb(null, true);
    if (corsAllowlist.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS: origin ${origin} not in allowlist`));
  },
  credentials: true,
  methods: ['GET','POST','PUT','DELETE','PATCH','OPTIONS'],
  // Only the standard request headers. Identity headers (x-user-id, x-user-role,
  // x-employee-id) are NEVER accepted from the client — they are stamped by the
  // gateway after JWT verification.
  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(cookieParser());

// Defence in depth: strip any client-supplied identity headers BEFORE they
// can be read by downstream services. jwtMiddleware overwrites them with the
// JWT-derived values; this protects the brief window before that runs.
app.use((req, _res, next) => {
  delete req.headers['x-user-id'];
  delete req.headers['x-user-role'];
  delete req.headers['x-employee-id'];
  next();
});
app.use(morgan('combined'));

// Global rate limit: 200 req/min per IP. Tunable via GATEWAY_RATELIMIT_MAX
// so the nightly E2E suite (which exceeds 200/min by design) can relax it.
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number.parseInt(process.env.GATEWAY_RATELIMIT_MAX || '200', 10),
  message: { error: 'Too many requests, please slow down' },
});
app.use(globalLimiter);

// Health check
app.get('/health', (req, res) => res.json({ service: 'api-gateway', status: 'ok', ts: new Date(), services: Object.keys(SERVICES) }));

// ── JWT Middleware (public routes bypass) ─────────────────────────────────────
const PUBLIC_ROUTES = [
  { method: 'POST', path: /^\/api\/auth\/login$/ },
  { method: 'POST', path: /^\/api\/tenants\/register$/ },
  { method: 'POST', path: /^\/api\/auth\/refresh$/ },
  { method: 'POST', path: /^\/api\/auth\/forgot-password$/ },
  { method: 'POST', path: /^\/api\/auth\/reset-password$/ },
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

  // Accept the JWT from either the Authorization header (legacy / non-browser
  // clients) or the HttpOnly vorkhive_token cookie (browser clients post C-12).
  const authHeader = req.headers['authorization'];
  const cookieToken = req.cookies?.vorkhive_token;
  let token = null;
  if (authHeader && authHeader.startsWith('Bearer ')) token = authHeader.slice(7);
  else if (cookieToken) token = cookieToken;

  if (!token) {
    return res.status(401).json({ error: 'Missing Authorization header or auth cookie' });
  }

  try {
    if (!cachedPublicKey) {
      const keyPath = process.env.JWT_PUBLIC_KEY_PATH || path.join(__dirname, '../../../certs/public.pem');
      cachedPublicKey = fs.readFileSync(keyPath, 'utf8');
    }
    const payload = jwt.verify(token, cachedPublicKey, { algorithms: ['RS256'], issuer: 'vorkhive' });
    // SSO-pending tokens have no `role` claim; downstream services reject them
    // via the shared auth-middleware. Block them here at the gateway too so
    // we never forward an `x-user-role: undefined` header (which crashes
    // express-http-proxy with "Invalid value 'undefined' for header").
    if (payload?.sso_pending === true) {
      return res.status(401).json({ error: 'SSO pending token is not accepted on protected endpoints' });
    }
    if (!payload.role) {
      return res.status(401).json({ error: 'Token is missing role claim' });
    }
    req.user = payload;
    req.headers['x-user-id'] = payload.sub;
    req.headers['x-user-role'] = payload.role;
    req.headers['x-employee-id'] = payload.employeeId || '';
    // Always forward the JWT as an Authorization header downstream, even when
    // the gateway received it as a cookie. Downstream services authenticate
    // only via the Authorization header (the existing pattern).
    if (!authHeader && cookieToken) req.headers['authorization'] = `Bearer ${cookieToken}`;
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
  // Downstream services each run a permissive `cors()` that emits
  // `Access-Control-Allow-Origin: *`. Proxied back to the browser, that wildcard
  // overrides the gateway's per-origin header and — combined with
  // `Access-Control-Allow-Credentials: true` — is rejected by browsers for any
  // credentialed request (the spec forbids `*` with credentials). That silently
  // broke cookie-based /auth/me from the SPA. express-http-proxy rebuilds the
  // client response headers from the downstream set, so the gateway's own
  // cors() header doesn't survive the proxy — we must re-assert it here. The
  // gateway is the sole CORS authority: drop the downstream CORS headers and
  // set the correct per-origin, credentialed ones for allowlisted origins.
  userResHeaderDecorator(headers, userReq) {
    delete headers['access-control-allow-origin'];
    delete headers['access-control-allow-credentials'];
    delete headers['access-control-allow-methods'];
    delete headers['access-control-allow-headers'];
    delete headers['access-control-expose-headers'];
    const origin = userReq.headers.origin;
    if (origin && corsAllowlist.includes(origin)) {
      headers['access-control-allow-origin'] = origin;
      headers['access-control-allow-credentials'] = 'true';
      headers['vary'] = headers['vary'] ? `${headers['vary']}, Origin` : 'Origin';
    }
    return headers;
  },
};

app.use('/api/auth',         proxy(SERVICES.auth,         { ...proxyOpts, proxyReqPathResolver: req => req.originalUrl.replace('/api/auth', '/auth') }));
app.use('/api/users',        proxy(SERVICES.auth,         { ...proxyOpts, proxyReqPathResolver: req => req.originalUrl.replace('/api/users', '/users') }));
app.use('/api/roles',        proxy(SERVICES.auth,         { ...proxyOpts, proxyReqPathResolver: req => req.originalUrl.replace('/api/roles', '/roles') }));
app.use('/api/tenants',      proxy(SERVICES.auth,         { ...proxyOpts, proxyReqPathResolver: req => req.originalUrl.replace('/api/tenants', '/tenants') }));
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
app.use('/api/assistant',    proxy(SERVICES.assistant,    { ...proxyOpts, proxyReqPathResolver: req => req.originalUrl.replace('/api/assistant', '/assistant') }));

app.use((err, req, res, next) => { console.error(err.message); res.status(502).json({ error: 'Gateway error', message: err.message }); });

app.listen(PORT, () => console.log(`[api-gateway] Running on port ${PORT}`));
