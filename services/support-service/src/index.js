'use strict';
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');

const supportRoutes = require('./routes/support.routes');
const app = express();
const PORT = process.env.PORT || 4014;

app.use(helmet()); app.use(cors()); app.use(express.json({ limit: '10kb' })); app.use(morgan('combined'));
app.get('/health', (req, res) => res.json({ service: 'support-service', status: 'ok', ts: new Date() }));
app.use('/support', supportRoutes);
app.use((err, req, res, next) => { console.error(err); res.status(err.status || 500).json({ error: err.message || 'Internal server error' }); });

if (require.main === module) {
  app.listen(PORT, () => console.log(`[support-service] Running on port ${PORT}`));
}

module.exports = app;
