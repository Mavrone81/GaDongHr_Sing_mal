'use strict';
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');

const trainingRoutes = require('./routes/training.routes');
const competencyRoutes = require('./routes/competency.routes');
const grantRoutes = require('./routes/grant.routes');
const { runCertReminderSweep } = trainingRoutes;
const app = express();
const PORT = process.env.PORT || 4013;

app.use(helmet()); app.use(cors()); app.use(express.json({ limit: '100kb' })); app.use(morgan('combined'));
app.get('/health', (req, res) => res.json({ service: 'training-service', status: 'ok', ts: new Date() }));
app.use('/training', trainingRoutes);
app.use('/training', competencyRoutes);
app.use('/training', grantRoutes);
app.use((err, req, res, next) => { console.error(err); res.status(err.status || 500).json({ error: err.message || 'Internal server error' }); });

// Schedule cert-reminder sweep at next 00:10 SGT, then every 24h. 00:10 SGT
// is 16:10 UTC the previous calendar day. Offset by 5 min from leave-service
// so the two scheduled jobs don't pile up at the same minute.
function msUntilNext00_10SGT() {
  const now = new Date();
  const utcTarget = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
    16, 10, 0, 0,
  ));
  if (utcTarget <= now) utcTarget.setUTCDate(utcTarget.getUTCDate() + 1);
  return utcTarget - now;
}

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[training-service] Running on port ${PORT}`);
    const initialDelay = msUntilNext00_10SGT();
    console.log(`[training-service] First cert-reminder sweep in ${Math.round(initialDelay / 1000 / 60)} min`);
    setTimeout(() => {
      runCertReminderSweep(new Date())
        .then(r => console.log(`[training-service] Cert sweep: scanned=${r.certsScanned} reminders=${r.remindersCreated} nominated=${r.nominated}`))
        .catch(err => console.error('[training-service] Cert sweep startup error:', err));
      setInterval(() => {
        runCertReminderSweep(new Date())
          .then(r => console.log(`[training-service] Cert sweep: scanned=${r.certsScanned} reminders=${r.remindersCreated} nominated=${r.nominated}`))
          .catch(err => console.error('[training-service] Cert sweep daily error:', err));
      }, 24 * 60 * 60 * 1000);
    }, initialDelay);
  });
}
module.exports = { app };
