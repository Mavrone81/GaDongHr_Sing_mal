'use strict';
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');

const leaveRoutes = require('./routes/leave.routes');
const yearEndRoutes = require('./routes/year-end.routes');
const { runAutoProvision } = leaveRoutes;
const { runExpirySweep } = yearEndRoutes;
const app = express();
const PORT = process.env.PORT || 4004;

app.use(helmet()); app.use(cors()); app.use(express.json({ limit: '10kb' })); app.use(morgan('combined'));
const { tenantContextMiddleware } = require('/app/shared/tenant-context');
app.use(tenantContextMiddleware);
app.get('/health', (req, res) => res.json({ service: 'leave-service', status: 'ok', ts: new Date() }));
app.use('/leave', leaveRoutes);
app.use('/leave', yearEndRoutes);
app.use((err, req, res, next) => { console.error(err); res.status(err.status || 500).json({ error: (process.env.NODE_ENV === 'production' && (err.status || 500) >= 500) ? 'Internal server error' : (err.message || 'Internal server error') }); });

// Schedule the carry-forward expiry sweep at the next 00:05 SGT boundary,
// then every 24 hours. Singapore time is UTC+8 year-round.
function msUntilNext00_05SGT() {
  const now = new Date();
  // 00:05 SGT = 16:05 UTC the previous calendar day.
  const utcTarget = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
    16, 5, 0, 0,
  ));
  if (utcTarget <= now) utcTarget.setUTCDate(utcTarget.getUTCDate() + 1);
  return utcTarget - now;
}

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[leave-service] Running on port ${PORT}`);
    // Run auto-provision at startup (after 30s for DB readiness) then every 24h
    setTimeout(() => {
      runAutoProvision().catch(err => console.error('[leave-service] Auto-provision startup error:', err));
      setInterval(() => {
        runAutoProvision().catch(err => console.error('[leave-service] Auto-provision daily error:', err));
      }, 24 * 60 * 60 * 1000);
    }, 30000);

    // Daily carry-forward expiry sweep — first run at next 00:05 SGT
    const initialDelay = msUntilNext00_05SGT();
    console.log(`[leave-service] First carry-forward expiry sweep in ${Math.round(initialDelay / 1000 / 60)} min`);
    setTimeout(() => {
      runExpirySweep(new Date())
        .then(r => console.log(`[leave-service] Expiry sweep: ${r.swept} entitlements, ${r.totalExpired} days forfeited`))
        .catch(err => console.error('[leave-service] Expiry sweep startup error:', err));
      setInterval(() => {
        runExpirySweep(new Date())
          .then(r => console.log(`[leave-service] Expiry sweep: ${r.swept} entitlements, ${r.totalExpired} days forfeited`))
          .catch(err => console.error('[leave-service] Expiry sweep daily error:', err));
      }, 24 * 60 * 60 * 1000);
    }, initialDelay);
  });
}

module.exports = app;
