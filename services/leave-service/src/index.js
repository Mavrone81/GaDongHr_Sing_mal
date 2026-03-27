'use strict';
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');

const leaveRoutes = require('./routes/leave.routes');
const app = express();
const PORT = process.env.PORT || 4004;

app.use(helmet()); app.use(cors()); app.use(express.json({ limit: '10kb' })); app.use(morgan('combined'));
app.get('/health', (req, res) => res.json({ service: 'leave-service', status: 'ok', ts: new Date() }));
app.use('/leave', leaveRoutes);
app.use((err, req, res, next) => { console.error(err); res.status(err.status || 500).json({ error: err.message || 'Internal server error' }); });
app.listen(PORT, () => console.log(`[leave-service] Running on port ${PORT}`));
