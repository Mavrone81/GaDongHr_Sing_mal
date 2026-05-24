'use strict';
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');

const assetRoutes = require('./routes/asset.routes');
const logisticsRoutes = require('./routes/logistics.routes');
const alertsRoutes = require('./routes/alerts.routes');
const { runAlertSweep } = alertsRoutes;

const app = express();
const PORT = process.env.PORT || 4011;

app.use(helmet()); app.use(cors()); app.use(express.json({ limit: '50kb' })); app.use(morgan('combined'));
app.get('/health', (_req, res) => res.json({ service: 'asset-service', status: 'ok', ts: new Date() }));

// Order matters: alertsRoutes claims /assets/alerts and /assets/:id/maintenance
// before assetRoutes' /:id catches them.
app.use('/', alertsRoutes);                  // /assets/:id/maintenance, /licences, /assets/alerts
app.use('/assets', assetRoutes);             // /assets, /assets/:id, /assets/:id/assign
app.use('/', logisticsRoutes);               // /inventory, /logistics/requests, /purchase-requests

app.use((err, _req, res, _next) => { console.error(err); res.status(err.status || 500).json({ error: err.message || 'Internal server error' }); });

// ─── Daily alert sweep at 00:15 SGT (16:15 UTC previous calendar day) ────────
function msUntilNext00_15SGT() {
  const now = new Date();
  const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 16, 15, 0, 0));
  if (t <= now) t.setUTCDate(t.getUTCDate() + 1);
  return t - now;
}

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[asset-service] Running on port ${PORT}`);
    const initialDelay = msUntilNext00_15SGT();
    console.log(`[asset-service] First alert sweep in ${Math.round(initialDelay / 60000)} min`);
    setTimeout(() => {
      runAlertSweep(new Date())
        .then(r => console.log(`[asset-service] Alert sweep: warranty=${r.warranty} maint=${r.maintenance} return=${r.return} licence=${r.licence}`))
        .catch(err => console.error('[asset-service] Alert sweep startup error:', err));
      setInterval(() => {
        runAlertSweep(new Date())
          .then(r => console.log(`[asset-service] Alert sweep: warranty=${r.warranty} maint=${r.maintenance} return=${r.return} licence=${r.licence}`))
          .catch(err => console.error('[asset-service] Alert sweep daily error:', err));
      }, 24 * 60 * 60 * 1000);
    }, initialDelay);
  });
}

module.exports = app;
