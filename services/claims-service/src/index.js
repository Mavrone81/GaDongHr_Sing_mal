'use strict';
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');

const claimsRoutes = require('./routes/claims.routes');
const app = express();
const PORT = process.env.PORT || 4005;
fs.mkdirSync(path.join(__dirname, '../uploads'), { recursive: true });
app.use(helmet()); app.use(cors()); app.use(express.json({ limit: '10kb' })); app.use(morgan('combined'));
app.get('/health', (req, res) => res.json({ service: 'claims-service', status: 'ok', ts: new Date() }));
app.use('/claims', claimsRoutes);
app.use((err, req, res, next) => { console.error(err); res.status(err.status || 500).json({ error: err.message || 'Internal server error' }); });
app.listen(PORT, () => console.log(`[claims-service] Running on port ${PORT}`));
