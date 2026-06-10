'use strict';
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');

const employeeRoutes = require('./routes/employee.routes');
const documentRoutes = require('./routes/document.routes');
const movementRoutes = require('./routes/movement.routes');

const app = express();
const PORT = process.env.PORT || 4002;

// Ensure upload dir exists
const uploadDir = path.join(__dirname, '../uploads');
fs.mkdirSync(uploadDir, { recursive: true });

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(morgan('combined'));

// Multi-tenancy: install the request tenant context before routes. The shared
// auth middleware fills in tenantId from the verified JWT; the Prisma extension
// then isolates every query by tenant.
const { tenantContextMiddleware } = require('/app/shared/tenant-context');
app.use(tenantContextMiddleware);

app.get('/health', (req, res) => res.json({ service: 'employee-service', status: 'ok', ts: new Date() }));
app.use('/employees', employeeRoutes);
app.use('/documents', documentRoutes);
app.use('/movements', movementRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: (process.env.NODE_ENV === 'production' && (err.status || 500) >= 500) ? 'Internal server error' : (err.message || 'Internal server error') });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`[employee-service] Running on port ${PORT}`));
}

module.exports = app;
