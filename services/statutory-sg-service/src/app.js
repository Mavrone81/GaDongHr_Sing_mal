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

/**
 * Liveness. Deliberately NOT behind the internal-key check: an orchestrator
 * probing health must not need a credential, and this leaks nothing.
 */
app.get('/health', (_req, res) =>
  res.json({ service: 'statutory-sg-service', status: 'ok', country: 'SG', ts: new Date() }));

app.use((err, _req, res, _next) => {
  console.error('[statutory-sg]', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal error' });
});

module.exports = app;
