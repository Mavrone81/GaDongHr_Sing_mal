'use strict';
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');

const payrollRoutes = require('./routes/payroll.routes');
const componentRoutes = require('./routes/component.routes');
const bikRoutes = require('./routes/bik.routes');
const costCentreRoutes = require('./routes/cost-centre.routes');
const govtLeaveClaimsRoutes = require('./routes/govt-leave-claims.routes');
const irasSubmissionsRoutes = require('./routes/iras-submissions.routes');

const app = express();
const PORT = process.env.PORT || 4003;

const generatedDir = path.join(__dirname, '../generated');
fs.mkdirSync(generatedDir, { recursive: true });

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10kb' }));
app.use(morgan('combined'));

const { tenantContextMiddleware } = require('/app/shared/tenant-context');
app.use(tenantContextMiddleware);

app.get('/health', (req, res) => res.json({ service: 'payroll-service', status: 'ok', ts: new Date() }));
app.use('/payroll', payrollRoutes);
app.use('/payroll', bikRoutes);
app.use('/payroll', govtLeaveClaimsRoutes);
app.use('/payroll', irasSubmissionsRoutes);
app.use('/', costCentreRoutes);
app.use('/components', componentRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: (process.env.NODE_ENV === 'production' && (err.status || 500) >= 500) ? 'Internal server error' : (err.message || 'Internal server error') });
});

// PAY-007: daily IRAS / CPF submission deadline sweep at 00:25 SGT
function scheduleIrasDeadlineSweep() {
  if (process.env.NODE_ENV === 'test') return;
  const sgtOffsetMs = 8 * 60 * 60 * 1000;
  function msUntilNext0025Sgt() {
    const nowMs  = Date.now();
    const sgtNow = new Date(nowMs + sgtOffsetMs);
    const target = new Date(Date.UTC(sgtNow.getUTCFullYear(), sgtNow.getUTCMonth(), sgtNow.getUTCDate(), 0, 25, 0, 0));
    if (target <= sgtNow) target.setUTCDate(target.getUTCDate() + 1);
    return target.getTime() - sgtNow.getTime();
  }
  async function tick() {
    try {
      const sweep = irasSubmissionsRoutes.runDeadlineSweep;
      if (typeof sweep === 'function') {
        const result = await sweep();
        console.log(`[iras-deadline-sweep] scanned=${result.scanned} buckets=${JSON.stringify(result.buckets)}`);
      }
    } catch (err) {
      console.error('[iras-deadline-sweep] failed:', err.message);
    }
    setTimeout(tick, 24 * 60 * 60 * 1000);
  }
  setTimeout(tick, msUntilNext0025Sgt());
  console.log('[iras-deadline-sweep] daily scheduler armed for 00:25 SGT');
}

// PAY-005: daily payslip SLA sweep at 00:15 SGT
function schedulePayslipSlaSweep() {
  if (process.env.NODE_ENV === 'test') return;
  const sgtOffsetMs = 8 * 60 * 60 * 1000;
  function msUntilNext0015Sgt() {
    const nowMs   = Date.now();
    const sgtNow  = new Date(nowMs + sgtOffsetMs);
    const target  = new Date(Date.UTC(sgtNow.getUTCFullYear(), sgtNow.getUTCMonth(), sgtNow.getUTCDate(), 0, 15, 0, 0));
    if (target <= sgtNow) target.setUTCDate(target.getUTCDate() + 1);
    return target.getTime() - sgtNow.getTime();
  }
  async function tick() {
    try {
      const sweep = payrollRoutes.runPayslipSlaSweep;
      if (typeof sweep === 'function') {
        const result = await sweep();
        console.log(`[payslip-sla-sweep] scanned=${result.scannedRuns} created=${result.created} updated=${result.updated} resolved=${result.resolved} byType=${JSON.stringify(result.byType)}`);
      }
    } catch (err) {
      console.error('[payslip-sla-sweep] failed:', err.message);
    }
    setTimeout(tick, 24 * 60 * 60 * 1000);
  }
  setTimeout(tick, msUntilNext0015Sgt());
  console.log('[payslip-sla-sweep] daily scheduler armed for 00:15 SGT');
}

if (require.main === module) {
  app.listen(PORT, async () => {
    console.log(`[payroll-service] Running on port ${PORT}`);
    // PAY-001: ensure DB-level CHECK constraints (idempotent).
    try {
      const prisma = require('./utils/prisma');
      const { ensurePayrollConstraints } = require('./db-constraints');
      await ensurePayrollConstraints(prisma);
    } catch (err) {
      console.error('[payroll-service] db-constraints init failed:', err.message);
    }
    schedulePayslipSlaSweep();
    scheduleIrasDeadlineSweep();
  });
}

module.exports = app;
