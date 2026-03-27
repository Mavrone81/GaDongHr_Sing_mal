'use strict';
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const { v4: uuidv4 } = require('uuid');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize, ROLES } = require('../../../../shared/auth-middleware');
const { computeOtPay } = require('../../../payroll-service/src/engines/cpf.engine');

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 4007;

app.use(helmet()); app.use(cors()); app.use(express.json({ limit: '10kb' })); app.use(morgan('combined'));
app.get('/health', (req, res) => res.json({ service: 'attendance-service', status: 'ok', ts: new Date() }));

// Clock In
app.post('/attendance/clock-in', authenticate, async (req, res, next) => {
  try {
    const empId = req.body.employeeId || req.user.employeeId;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const record = await prisma.attendanceRecord.upsert({
      where: { employeeId_date: { employeeId: empId, date: today } },
      create: { id: uuidv4(), employeeId: empId, date: today, clockIn: now, status: 'PRESENT' },
      update: { clockIn: now },
    });
    res.json(record);
  } catch (err) { next(err); }
});

// Clock Out
app.post('/attendance/clock-out', authenticate, async (req, res, next) => {
  try {
    const empId = req.body.employeeId || req.user.employeeId;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const record = await prisma.attendanceRecord.findFirst({ where: { employeeId: empId, date: today } });
    if (!record || !record.clockIn) return res.status(400).json({ error: 'No clock-in recorded today' });

    const hoursWorked = (now - record.clockIn) / (1000 * 60 * 60);
    const standardHours = 8;
    const otHours = Math.max(0, hoursWorked - standardHours);

    const updated = await prisma.attendanceRecord.update({
      where: { id: record.id },
      data: { clockOut: now, hoursWorked: Math.round(hoursWorked * 100) / 100, otHours: Math.round(otHours * 100) / 100 },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

// GET /attendance/:employeeId
app.get('/attendance/:employeeId', authenticate, async (req, res, next) => {
  try {
    const { from, to } = req.query;
    const where = { employeeId: req.params.employeeId };
    if (from || to) where.date = {};
    if (from) where.date.gte = new Date(from);
    if (to) where.date.lte = new Date(to);
    const records = await prisma.attendanceRecord.findMany({ where, orderBy: { date: 'desc' } });
    res.json(records);
  } catch (err) { next(err); }
});

// GET /overtime/:employeeId/:period — OT summary
app.get('/overtime/:employeeId/:period', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const [year, month] = req.params.period.split('-');
    const start = new Date(parseInt(year), parseInt(month) - 1, 1);
    const end = new Date(parseInt(year), parseInt(month), 0);
    const records = await prisma.attendanceRecord.findMany({ where: { employeeId: req.params.employeeId, date: { gte: start, lte: end } } });
    const totalOt = records.reduce((sum, r) => sum + (r.otHours || 0), 0);
    const cappedOt = Math.min(totalOt, 72); // EA s.38(5) cap
    const exceedsCap = totalOt > 72;
    res.json({ employeeId: req.params.employeeId, period: req.params.period, totalOtHours: totalOt, cappedOtHours: cappedOt, exceedsMonthlyCap: exceedsCap, records: records.length });
  } catch (err) { next(err); }
});

// Shifts
app.get('/shifts', authenticate, async (req, res, next) => {
  try { res.json(await prisma.shiftTemplate.findMany({ where: { isActive: true } })); } catch (err) { next(err); }
});
app.post('/shifts', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const shift = await prisma.shiftTemplate.create({ data: { id: uuidv4(), ...req.body } });
    res.status(201).json(shift);
  } catch (err) { next(err); }
});

app.use((err, req, res, next) => { console.error(err); res.status(err.status || 500).json({ error: err.message || 'Internal server error' }); });
app.listen(PORT, () => console.log(`[attendance-service] Running on port ${PORT}`));
