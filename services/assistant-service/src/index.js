'use strict';
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');

const assistantRoutes = require('./routes/assistant.routes');

const app = express();
const PORT = process.env.PORT || 4020;

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '64kb' }));
app.use(morgan('combined'));

app.get('/health', (req, res) => res.json({
  service: 'assistant-service',
  status: 'ok',
  configured: !!process.env.ANTHROPIC_API_KEY,
  model: process.env.ASSISTANT_MODEL || 'claude-haiku-4-5',
  ts: new Date(),
}));

app.use('/assistant', assistantRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({
    error: (process.env.NODE_ENV === 'production' && (err.status || 500) >= 500)
      ? 'Internal server error'
      : (err.message || 'Internal server error'),
  });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`[assistant-service] Running on port ${PORT}`));
}

module.exports = app;
