'use strict';
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const platformRoutes = require('./routes/platform.routes');

const app = express();
const PORT = process.env.PORT || 4016;
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('combined'));

app.get('/health', (_req, res) => res.json({ service: 'admin-service', status: 'ok', ts: new Date() }));

// Public pricing (single source of truth for the billing page) — no auth; only
// active plans are exposed.
app.get('/pricing', async (_req, res) => {
  try {
    const plans = (await platformRoutes.getPricing()).filter((p) => p.active !== false);
    res.json({ plans });
  } catch {
    res.status(500).json({ error: 'pricing unavailable' });
  }
});

app.use('/platform', platformRoutes);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: (process.env.NODE_ENV === 'production' && (err.status || 500) >= 500) ? 'Internal server error' : (err.message || 'Internal server error') });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`[admin-service] Running on port ${PORT}`));
}
module.exports = app;
