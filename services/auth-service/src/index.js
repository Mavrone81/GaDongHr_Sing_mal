'use strict';
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');

const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const { generateKeysIfNeeded } = require('./utils/jwt.utils');

const app = express();
const PORT = process.env.PORT || 4001;

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

// Global error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

async function start() {
  await generateKeysIfNeeded();
  app.listen(PORT, () => {
    console.log(`[auth-service] Running on port ${PORT}`);
  });
}

start().catch(console.error);
