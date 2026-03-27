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
app.use('/components', componentRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => console.log(`[payroll-service] Running on port ${PORT}`));
