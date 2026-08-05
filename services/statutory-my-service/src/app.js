'use strict';
const express = require('express');
const helmet  = require('helmet');
const cors    = require('cors');
const morgan  = require('morgan');

const app = express();
app.use(helmet());
app.use(cors());
// Batch payloads carry every employee in a payroll run, so the default 100kb
// limit is far too small — a 500-employee run would be rejected outright.
app.use(express.json({ limit: '2mb' }));
app.use(morgan('combined'));

// The contract payroll-service calls — identical in shape to the Singapore
// sibling, so payroll consumes one interface regardless of country (ENT-002).
// Every route inside is gated by INTERNAL_SERVICE_KEY: service-to-service only,
// no JWT path.
app.use('/statutory', require('./routes/statutory.routes'));

/**
 * Liveness. Deliberately NOT behind the internal-key check: an orchestrator
 * probing health must not need a credential, and this leaks nothing.
 */
app.get('/health', (_req, res) =>
  res.json({ service: 'statutory-my-service', status: 'ok', country: 'MY', ts: new Date() }));

app.use((err, _req, res, _next) => {
  console.error('[statutory-my]', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal error' });
});

module.exports = app;
