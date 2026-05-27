'use strict';
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');

const recruitmentRoutes = require('./routes/recruitment.routes');
const app = express();
const PORT = process.env.PORT || 4006;
app.use(helmet()); app.use(cors()); app.use(express.json({ limit: '10kb' })); app.use(morgan('combined'));
app.get('/health', (req, res) => res.json({ service: 'recruitment-service', status: 'ok', ts: new Date() }));
app.use('/recruitment', recruitmentRoutes);
app.use((err, req, res, next) => { console.error(err); res.status(err.status || 500).json({ error: err.message || 'Internal server error' }); });

// REC-003: daily work-pass alert sweep at 00:20 SGT.
function scheduleWorkPassSweep() {
  if (process.env.NODE_ENV === 'test') return;
  const sgtOffsetMs = 8 * 60 * 60 * 1000;
  function msUntilNext0020Sgt() {
    const nowMs  = Date.now();
    const sgtNow = new Date(nowMs + sgtOffsetMs);
    const target = new Date(Date.UTC(sgtNow.getUTCFullYear(), sgtNow.getUTCMonth(), sgtNow.getUTCDate(), 0, 20, 0, 0));
    if (target <= sgtNow) target.setUTCDate(target.getUTCDate() + 1);
    return target.getTime() - sgtNow.getTime();
  }
  async function tick() {
    try {
      const sweep = recruitmentRoutes.runWorkPassAlertSweep;
      if (typeof sweep === 'function') {
        const result = await sweep();
        console.log(`[workpass-sweep] swept=${result.sweptPasses} created=${result.created} byThreshold=${JSON.stringify(result.byThreshold)}`);
      }
    } catch (err) {
      console.error('[workpass-sweep] failed:', err.message);
    }
    setTimeout(tick, 24 * 60 * 60 * 1000);
  }
  setTimeout(tick, msUntilNext0020Sgt());
  console.log('[workpass-sweep] daily scheduler armed for 00:20 SGT');
}

// REC-004: daily onboarding-incomplete alert sweep at 00:35 SGT.
function scheduleOnboardingAlertSweep() {
  if (process.env.NODE_ENV === 'test') return;
  const sgtOffsetMs = 8 * 60 * 60 * 1000;
  function msUntilNext0035Sgt() {
    const sgtNow = new Date(Date.now() + sgtOffsetMs);
    const target = new Date(Date.UTC(sgtNow.getUTCFullYear(), sgtNow.getUTCMonth(), sgtNow.getUTCDate(), 0, 35, 0, 0));
    if (target <= sgtNow) target.setUTCDate(target.getUTCDate() + 1);
    return target.getTime() - sgtNow.getTime();
  }
  async function tick() {
    try {
      const sweep = recruitmentRoutes.runOnboardingAlertSweep;
      if (typeof sweep === 'function') {
        const result = await sweep();
        console.log(`[onboarding-sweep] checked=${result.checked} alerted=${result.alerted} skipped=${result.skipped} targetDate=${result.targetDate}`);
      }
    } catch (err) {
      console.error('[onboarding-sweep] failed:', err.message);
    }
    setTimeout(tick, 24 * 60 * 60 * 1000);
  }
  setTimeout(tick, msUntilNext0035Sgt());
  console.log('[onboarding-sweep] daily scheduler armed for 00:35 SGT');
}

if (require.main === module) {
  app.listen(PORT, () => console.log(`[recruitment-service] Running on port ${PORT}`));
  scheduleWorkPassSweep();
  scheduleOnboardingAlertSweep();
}
module.exports = { app };
