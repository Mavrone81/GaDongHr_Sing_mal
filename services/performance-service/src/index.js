'use strict';
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');

const performanceRoutes = require('./routes/performance.routes');
const app = express();
const PORT = process.env.PORT || 4012;

app.use(helmet()); app.use(cors()); app.use(express.json({ limit: '50kb' })); app.use(morgan('combined'));
app.get('/health', (req, res) => res.json({ service: 'performance-service', status: 'ok', ts: new Date() }));
app.use('/performance', performanceRoutes);
app.use((err, req, res, next) => { console.error(err); res.status(err.status || 500).json({ error: err.message || 'Internal server error' }); });

if (require.main === module) app.listen(PORT, () => console.log(`[performance-service] Running on port ${PORT}`));
module.exports = { app };
