'use strict';
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');

const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const roleRoutes = require('./routes/role.routes');
const purgeRoutes = require('./routes/purge.routes');
const { generateKeysIfNeeded } = require('./utils/jwt.utils');
const prisma = require('./utils/prisma');

const app = express();
const PORT = process.env.PORT || 4001;

// Trust proxy for rate limiting behind gateway
app.set('trust proxy', 1);

// Security headers
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10kb' }));
app.use(morgan('combined'));

// Health check
app.get('/health', (req, res) => res.json({ service: 'auth-service', status: 'ok', ts: new Date() }));

// Routes
app.use('/auth', authRoutes);
app.use('/users', userRoutes);
app.use('/roles', roleRoutes);
app.use('/auth/purge', purgeRoutes);

// Global error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// ── Daily purge scheduler ─────────────────────────────────────────────────────
// Runs at midnight UTC each day. Checks org_settings.purgeScheduleEnabled before running.
function schedulePurge() {
  const now = new Date();
  // Next midnight UTC
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const delay = next - now;
  setTimeout(async () => {
    try {
      const rows = await prisma.$queryRaw`SELECT value FROM org_settings WHERE key = 'purgeScheduleEnabled' LIMIT 1`;
      if ((rows[0]?.value) === 'true') {
        const { executePurge, getRetentionConfig } = require('./routes/purge.routes');
        const config = await getRetentionConfig();
        const result = await executePurge(config);
        console.log(`[purge-scheduler] Run complete at ${new Date().toISOString()}`, result.status);
      }
    } catch (e) {
      console.error('[purge-scheduler] Error:', e.message);
    }
    schedulePurge(); // reschedule for the next midnight
  }, delay);
  console.log(`[purge-scheduler] Next run scheduled for ${next.toISOString()}`);
}

async function start() {
  await generateKeysIfNeeded();
  app.listen(PORT, () => {
    console.log(`[auth-service] Running on port ${PORT}`);
  });
  schedulePurge();
}

start().catch(console.error);
