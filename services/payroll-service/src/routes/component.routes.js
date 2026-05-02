'use strict';

const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize, ROLES } = require('/app/shared/auth-middleware');

const prisma = new PrismaClient();

// GET /components — list all 59 pay components
router.get('/', authenticate, async (req, res, next) => {
  try {
    const components = await prisma.payComponent.findMany({ orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }] });
    res.json(components);
  } catch (err) { next(err); }
});

// PUT /components/:id — update CPF/taxability settings
router.put('/:id', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const { isCpfApplicable, isIrasTaxable, wageType, isActive } = req.body;
    const comp = await prisma.payComponent.update({
      where: { id: req.params.id },
      data: { ...(isCpfApplicable !== undefined && { isCpfApplicable }), ...(isIrasTaxable !== undefined && { isIrasTaxable }), ...(wageType && { wageType: wageType.toUpperCase() }), ...(isActive !== undefined && { isActive }) },
    });
    res.json(comp);
  } catch (err) { next(err); }
});

// GET /components/cpf-rates
router.get('/cpf-rates', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const rates = await prisma.cpfRate.findMany({ where: { isActive: true }, orderBy: [{ citizenStatus: 'asc' }, { ageMin: 'asc' }] });
    res.json(rates);
  } catch (err) { next(err); }
});

// PUT /components/cpf-rates/:id — update CPF rate (admin/payroll officer)
router.put('/cpf-rates/:id', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const { employeeRate, employerRate, owCeiling, awCeiling } = req.body;
    const rate = await prisma.cpfRate.update({
      where: { id: req.params.id },
      data: { ...(employeeRate !== undefined && { employeeRate }), ...(employerRate !== undefined && { employerRate }), ...(owCeiling !== undefined && { owCeiling }), ...(awCeiling !== undefined && { awCeiling }) },
    });
    res.json(rate);
  } catch (err) { next(err); }
});

// GET /components/fwl-rates
router.get('/fwl-rates', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const rates = await prisma.fwlRate.findMany({ where: { isActive: true }, orderBy: [{ passType: 'asc' }, { sector: 'asc' }, { tier: 'asc' }] });
    res.json(rates);
  } catch (err) { next(err); }
});

// PUT /components/fwl-rates/:id
router.put('/fwl-rates/:id', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const { dailyRate } = req.body;
    const rate = await prisma.fwlRate.update({ where: { id: req.params.id }, data: { ...(dailyRate !== undefined && { dailyRate }) } });
    res.json(rate);
  } catch (err) { next(err); }
});

// GET /components/sdl-config
router.get('/sdl-config', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const cfg = await prisma.sdlConfig.findFirst({ where: { isActive: true } });
    res.json(cfg || {});
  } catch (err) { next(err); }
});

// PUT /components/sdl-config
router.put('/sdl-config', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const { rate, minAmount, maxAmount, salaryCap } = req.body;
    const existing = await prisma.sdlConfig.findFirst({ where: { isActive: true } });
    let cfg;
    if (existing) {
      cfg = await prisma.sdlConfig.update({
        where: { id: existing.id },
        data: { ...(rate !== undefined && { rate }), ...(minAmount !== undefined && { minAmount }), ...(maxAmount !== undefined && { maxAmount }), ...(salaryCap !== undefined && { salaryCap }) },
      });
    } else {
      cfg = await prisma.sdlConfig.create({ data: { id: require('crypto').randomUUID(), rate: rate ?? 0.0025, minAmount: minAmount ?? 2.00, maxAmount: maxAmount ?? 11.25, salaryCap: salaryCap ?? 4500, effectiveDate: new Date('2026-01-01'), isActive: true } });
    }
    res.json(cfg);
  } catch (err) { next(err); }
});

// POST /components/seed-defaults — upsert Singapore 2026 statutory defaults (skips if tables already populated)
router.post('/seed-defaults', authenticate, authorize(ROLES.SUPER_ADMIN), async (req, res, next) => {
  try {
    const effectiveDate = new Date('2026-01-01');
    const owCeiling = 7400;
    const awCeiling = 102000;

    const cpfDefaults = [
      // SC / SPR 3rd-year+
      { citizenStatus: 'SC_PR', ageMin: 0,  ageMax: 55,  employeeRate: 0.20,  employerRate: 0.17  },
      { citizenStatus: 'SC_PR', ageMin: 56, ageMax: 60,  employeeRate: 0.16,  employerRate: 0.155 },
      { citizenStatus: 'SC_PR', ageMin: 61, ageMax: 65,  employeeRate: 0.105, employerRate: 0.125 },
      { citizenStatus: 'SC_PR', ageMin: 66, ageMax: 70,  employeeRate: 0.07,  employerRate: 0.09  },
      { citizenStatus: 'SC_PR', ageMin: 71, ageMax: null, employeeRate: 0.05, employerRate: 0.075 },
      // PR Year 1 (graduated — ~25% of full)
      { citizenStatus: 'PR_YEAR1', ageMin: 0,  ageMax: 55,  employeeRate: 0.05, employerRate: 0.04  },
      { citizenStatus: 'PR_YEAR1', ageMin: 56, ageMax: 60,  employeeRate: 0.05, employerRate: 0.04  },
      { citizenStatus: 'PR_YEAR1', ageMin: 61, ageMax: 65,  employeeRate: 0.05, employerRate: 0.035 },
      { citizenStatus: 'PR_YEAR1', ageMin: 66, ageMax: 70,  employeeRate: 0.05, employerRate: 0.035 },
      { citizenStatus: 'PR_YEAR1', ageMin: 71, ageMax: null, employeeRate: 0.05, employerRate: 0.035 },
      // PR Year 2 (graduated — ~75% of full)
      { citizenStatus: 'PR_YEAR2', ageMin: 0,  ageMax: 55,  employeeRate: 0.15,  employerRate: 0.09  },
      { citizenStatus: 'PR_YEAR2', ageMin: 56, ageMax: 60,  employeeRate: 0.15,  employerRate: 0.09  },
      { citizenStatus: 'PR_YEAR2', ageMin: 61, ageMax: 65,  employeeRate: 0.105, employerRate: 0.075 },
      { citizenStatus: 'PR_YEAR2', ageMin: 66, ageMax: 70,  employeeRate: 0.07,  employerRate: 0.065 },
      { citizenStatus: 'PR_YEAR2', ageMin: 71, ageMax: null, employeeRate: 0.05, employerRate: 0.065 },
    ];

    const fwlDefaults = [
      // S-Pass
      { passType: 'S_PASS', sector: 'SERVICES',      tier: 'TIER1', dailyRate: 25.00  },
      { passType: 'S_PASS', sector: 'SERVICES',      tier: 'TIER2', dailyRate: 30.77  },
      { passType: 'S_PASS', sector: 'MANUFACTURING', tier: 'TIER1', dailyRate: 21.15  },
      { passType: 'S_PASS', sector: 'MANUFACTURING', tier: 'TIER2', dailyRate: 25.00  },
      { passType: 'S_PASS', sector: 'CONSTRUCTION',  tier: 'TIER1', dailyRate: 21.15  },
      { passType: 'S_PASS', sector: 'CONSTRUCTION',  tier: 'TIER2', dailyRate: 25.00  },
      // Work Permit
      { passType: 'WP', sector: 'SERVICES',      tier: 'BASIC_SKILLED',  dailyRate: 14.23 },
      { passType: 'WP', sector: 'SERVICES',      tier: 'HIGHER_SKILLED', dailyRate: 12.31 },
      { passType: 'WP', sector: 'CONSTRUCTION',  tier: 'BASIC_SKILLED',  dailyRate: 15.38 },
      { passType: 'WP', sector: 'CONSTRUCTION',  tier: 'HIGHER_SKILLED', dailyRate: 13.46 },
      { passType: 'WP', sector: 'MARINE',        tier: 'BASIC_SKILLED',  dailyRate: 15.38 },
      { passType: 'WP', sector: 'MARINE',        tier: 'HIGHER_SKILLED', dailyRate: 13.46 },
      { passType: 'WP', sector: 'PROCESS',       tier: 'BASIC_SKILLED',  dailyRate: 14.23 },
      { passType: 'WP', sector: 'PROCESS',       tier: 'HIGHER_SKILLED', dailyRate: 12.31 },
      { passType: 'WP', sector: 'MANUFACTURING', tier: 'BASIC_SKILLED',  dailyRate: 14.23 },
      { passType: 'WP', sector: 'MANUFACTURING', tier: 'HIGHER_SKILLED', dailyRate: 12.31 },
    ];

    const force = req.query.force === 'true';
    const [existingCpf, existingSdl, existingFwl] = await Promise.all([
      prisma.cpfRate.count({ where: { isActive: true } }),
      prisma.sdlConfig.count({ where: { isActive: true } }),
      prisma.fwlRate.count({ where: { isActive: true } }),
    ]);

    let cpfCreated = 0, sdlCreated = 0, fwlCreated = 0;

    if (existingCpf === 0 || force) {
      if (force && existingCpf > 0) {
        // Deactivate old records and recreate
        await prisma.cpfRate.updateMany({ where: { isActive: true }, data: { isActive: false } });
      }
      const cpfData = cpfDefaults.map(r => ({ id: require('crypto').randomUUID(), ...r, owCeiling, awCeiling, effectiveDate, isActive: true }));
      const result = await prisma.cpfRate.createMany({ data: cpfData, skipDuplicates: true });
      cpfCreated = result.count;
    }

    if (existingSdl === 0 || force) {
      if (force && existingSdl > 0) {
        await prisma.sdlConfig.updateMany({ where: { isActive: true }, data: { rate: 0.0025, minAmount: 2.00, maxAmount: 11.25, salaryCap: 4500, effectiveDate } });
        sdlCreated = existingSdl;
      } else {
        await prisma.sdlConfig.create({ data: { id: require('crypto').randomUUID(), rate: 0.0025, minAmount: 2.00, maxAmount: 11.25, salaryCap: 4500, effectiveDate, isActive: true } });
        sdlCreated = 1;
      }
    }

    if (existingFwl === 0 || force) {
      if (force && existingFwl > 0) {
        await prisma.fwlRate.updateMany({ where: { isActive: true }, data: { isActive: false } });
      }
      const fwlData = fwlDefaults.map(r => ({ id: require('crypto').randomUUID(), ...r, effectiveDate, isActive: true }));
      const result = await prisma.fwlRate.createMany({ data: fwlData, skipDuplicates: true });
      fwlCreated = result.count;
    }

    res.status(201).json({
      message: force ? 'Singapore 2026 statutory defaults refreshed' : 'Singapore 2026 statutory defaults loaded',
      created: { cpfRates: cpfCreated, sdlConfig: sdlCreated, fwlRates: fwlCreated },
      skipped: { cpfRates: !force && existingCpf > 0, sdlConfig: !force && existingSdl > 0, fwlRates: !force && existingFwl > 0 },
    });
  } catch (err) { next(err); }
});

module.exports = router;
