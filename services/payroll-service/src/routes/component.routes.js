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
    const rates = await prisma.fwlRate.findMany({ where: { isActive: true } });
    res.json(rates);
  } catch (err) { next(err); }
});

module.exports = router;
