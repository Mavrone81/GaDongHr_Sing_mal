'use strict';
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const { v4: uuidv4 } = require('uuid');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize, ROLES } = require('/app/shared/auth-middleware');

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 4008;

app.use(helmet()); app.use(cors()); app.use(express.json({ limit: '10kb' })); app.use(morgan('combined'));
app.get('/health', (req, res) => res.json({ service: 'offboarding-service', status: 'ok', ts: new Date() }));

const DEFAULT_CLEARANCE_ITEMS = [
  'Resignation letter received', 'IT equipment returned', 'Access card returned',
  'Email account deactivated', 'System access revoked', 'Locker cleared',
  'Exit interview completed', 'Leave encashment computed', 'Final pay computed',
  'Certificate of Employment issued', 'CPF final contribution filed', 'H&S acknowledgement',
];

// POST /offboarding/initiate
app.post('/offboarding/initiate', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const { employeeId, reason, lastWorkingDate, noticeGivenDate, noticePeriodDays, isForeignEmployee } = req.body;
    if (!employeeId || !reason || !lastWorkingDate) return res.status(400).json({ error: 'employeeId, reason, lastWorkingDate required' });

    const existing = await prisma.offboardingCase.findUnique({ where: { employeeId } });
    if (existing) return res.status(409).json({ error: 'Offboarding case already exists for this employee' });

    const offCase = await prisma.offboardingCase.create({
      data: {
        id: uuidv4(), employeeId, reason: reason.toUpperCase(), lastWorkingDate: new Date(lastWorkingDate),
        noticeGivenDate: noticeGivenDate ? new Date(noticeGivenDate) : new Date(),
        noticePeriodDays: noticePeriodDays || 30, isForeignEmployee: !!isForeignEmployee,
        ir21Status: isForeignEmployee ? 'PENDING' : null,
        initiatedBy: req.user.sub, status: 'INITIATED',
        clearanceItems: {
          create: DEFAULT_CLEARANCE_ITEMS.map(name => ({ id: uuidv4(), itemName: name })),
        },
      },
      include: { clearanceItems: true },
    });
    res.status(201).json(offCase);
  } catch (err) { next(err); }
});

// GET /offboarding/:id/checklist
app.get('/offboarding/:id/checklist', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const offCase = await prisma.offboardingCase.findUnique({ where: { id: req.params.id }, include: { clearanceItems: true } });
    if (!offCase) return res.status(404).json({ error: 'Not found' });
    res.json(offCase);
  } catch (err) { next(err); }
});

// PUT /offboarding/:id/checklist/:itemId
app.put('/offboarding/:id/checklist/:itemId', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.IT_ADMIN), async (req, res, next) => {
  try {
    const item = await prisma.clearanceItem.update({
      where: { id: req.params.itemId }, data: { isDone: true, completedAt: new Date(), notes: req.body.notes },
    });
    res.json(item);
  } catch (err) { next(err); }
});

// POST /offboarding/:id/ir21-trigger
app.post('/offboarding/:id/ir21-trigger', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const offCase = await prisma.offboardingCase.findUnique({ where: { id: req.params.id } });
    if (!offCase) return res.status(404).json({ error: 'Not found' });
    if (!offCase.isForeignEmployee) return res.status(400).json({ error: 'IR21 only applicable for non-SC/non-PR employees' });

    const updated = await prisma.offboardingCase.update({
      where: { id: offCase.id }, data: { ir21Status: 'SUBMITTED', ir21FiledAt: new Date() },
    });
    res.json({ message: 'IR21 filed. All salary payments suspended until IRAS clearance is issued.', case: updated });
  } catch (err) { next(err); }
});

// PUT /offboarding/:id/ir21-clearance
app.put('/offboarding/:id/ir21-clearance', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const updated = await prisma.offboardingCase.update({
      where: { id: req.params.id }, data: { ir21Status: 'CLEARANCE_ISSUED', ir21ClearedAt: new Date(), moniesToRelease: true },
    });
    res.json({ message: 'IR21 clearance received. Salary payment can now be released.', case: updated });
  } catch (err) { next(err); }
});

app.use((err, req, res, next) => { console.error(err); res.status(err.status || 500).json({ error: err.message || 'Internal server error' }); });
app.listen(PORT, () => console.log(`[offboarding-service] Running on port ${PORT}`));
