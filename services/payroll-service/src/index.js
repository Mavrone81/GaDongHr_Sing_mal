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

const app = express();
const PORT = process.env.PORT || 4003;

const generatedDir = path.join(__dirname, '../generated');
fs.mkdirSync(generatedDir, { recursive: true });

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10kb' }));
app.use(morgan('combined'));

app.get('/health', (req, res) => res.json({ service: 'payroll-service', status: 'ok', ts: new Date() }));
app.use('/payroll', payrollRoutes);
app.use('/payroll', bikRoutes);
app.use('/payroll', govtLeaveClaimsRoutes);
app.use('/', costCentreRoutes);
app.use('/components', componentRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

if (require.main === module) {
  app.listen(PORT, async () => {
    console.log(`[payroll-service] Running on port ${PORT}`);
    // PAY-001: ensure DB-level CHECK constraints (idempotent).
    try {
      const { PrismaClient } = require('@prisma/client');
      const { ensurePayrollConstraints } = require('./db-constraints');
      await ensurePayrollConstraints(new PrismaClient());
    } catch (err) {
      console.error('[payroll-service] db-constraints init failed:', err.message);
    }
  });
}

module.exports = app;
