'use strict';
const express = require('express');
const prisma  = require('../utils/prisma');
const { computeCpf, computeSdl } = require('../engines/cpf.engine');
const { SG_EMPLOYMENT_RULES, SG_SCHEMA } = require('../rules/employment-rules');

const router = express.Router();

/**
 * Service-to-service only — there is no JWT path into this service.
 *
 * Fails closed when INTERNAL_SERVICE_KEY is unset rather than falling back to a
 * hardcoded development default (the VAPT C-07 defect class).
 */
function requireInternalKey(req, res, next) {
  const expected = process.env.INTERNAL_SERVICE_KEY;
  if (!expected) return res.status(401).json({ error: 'Internal key not configured' });
  if (req.headers['x-internal-service-key'] !== expected) {
    return res.status(401).json({ error: 'Invalid internal service key' });
  }
  next();
}

// The employee-facing citizenStatus vocabulary is broader than the rate table's.
// Mirrors findCpfRate as it was in payroll.routes.js so behaviour is preserved
// across the extraction.
const STATUS_MAP = {
  SC: 'SC_PR', PR: 'SC_PR', SC_PR: 'SC_PR',
  PR_YEAR1: 'PR_YEAR1', PR_YEAR2: 'PR_YEAR2', FOREIGNER: 'FOREIGNER',
};

function findBand(rates, citizenStatus, age) {
  const mapped = STATUS_MAP[citizenStatus] || 'SC_PR';
  return rates.find(r =>
    r.citizenStatus === mapped && r.ageMin <= age && (r.ageMax === null || r.ageMax >= age)) || null;
}

/**
 * Compute statutory contributions for a whole payroll run.
 *
 * Batched on purpose: a 500-employee run makes one call, not 500.
 */
router.post('/compute-batch', requireInternalKey, async (req, res, next) => {
  try {
    const { entity, employees } = req.body || {};

    // Being routed the wrong country must be loud. Silently computing a
    // Malaysian entity as Singapore would produce plausible, wrong payslips.
    if (!entity || entity.country !== 'SG') {
      return res.status(400).json({ error: 'statutory-sg-service only computes SG entities' });
    }
    if (!Array.isArray(employees) || employees.length === 0) {
      return res.status(400).json({ error: 'employees[] is required' });
    }

    const active = await prisma.rateVersion.findFirst({
      where: { country: 'SG', isActive: true },
      orderBy: { effectiveFrom: 'desc' },
    });
    // FAIL CLOSED. Never fall back to a default or the nearest version.
    if (!active) {
      return res.status(503).json({ error: 'No active SG rate version — payroll cannot compute' });
    }

    const rates     = await prisma.cpfRate.findMany({ where: { rateVersion: active.version } });
    const sdlConfig = await prisma.sdlConfig.findUnique({ where: { rateVersion: active.version } });

    const results = [];
    for (const emp of employees) {
      const { employeeId, profile = {}, remuneration = {} } = emp;

      const band = findBand(rates, profile.citizenStatus, profile.age);
      // Also fail closed: an unmatched employee must stop the run, not compute
      // as zero. Name them so the operator can fix the data.
      if (!band) {
        return res.status(503).json({
          error: `No CPF band for employee ${employeeId} (${profile.citizenStatus}, age ${profile.age})`,
        });
      }

      const cpf = computeCpf({
        ow: remuneration.ordinary || 0,
        aw: remuneration.additional || 0,
        ytdOw: remuneration.ytdOrdinary || 0,
        ytdAw: remuneration.ytdAdditional || 0,
        citizenStatus: profile.citizenStatus,
        age: profile.age,
        rates: band,
      });
      const sdl = computeSdl(remuneration.gross || 0, sdlConfig);

      // basis is the audit trail: which band produced this figure. Payroll
      // persists it per line so a payslip stays defensible years later.
      const basis = {
        citizenStatus: band.citizenStatus, ageMin: band.ageMin, ageMax: band.ageMax,
        employeeRate: band.employeeRate, employerRate: band.employerRate,
        owCeiling: band.owCeiling, awCeiling: band.awCeiling,
      };

      results.push({
        employeeId,
        employeeDeductions:    [{ code: 'CPF_EE', label: 'CPF (Employee)', amount: cpf.totalEmployee, basis }],
        employerContributions: [{ code: 'CPF_ER', label: 'CPF (Employer)', amount: cpf.totalEmployer, basis }],
        employerLevies:        [{ code: 'SDL',    label: 'Skills Development Levy', amount: sdl, basis: sdlConfig }],
      });
    }

    res.json({ rateVersion: active.version, results });
  } catch (err) { next(err); }
});

/** What SG needs on an employee/entity before payroll can compute. */
router.get('/schema', requireInternalKey, (_req, res) => res.json(SG_SCHEMA));

/** Leave tiers, OT multipliers, normal hours, notice bands. */
router.get('/employment-rules', requireInternalKey, (_req, res) => res.json(SG_EMPLOYMENT_RULES));

/**
 * Pre-run completeness check. Runs BEFORE compute so missing data surfaces as a
 * list of employees to fix, never as a half-written payroll run (spec §3.4).
 */
router.post('/validate', requireInternalKey, (req, res) => {
  const { employees } = req.body || {};
  if (!Array.isArray(employees)) {
    return res.status(400).json({ error: 'employees[] is required' });
  }

  const required = SG_SCHEMA.employeeFields.filter(f => f.required).map(f => f.name);
  const problems = [];

  for (const emp of employees) {
    const profile = emp.profile || {};
    const missing = required.filter(name =>
      profile[name] === undefined || profile[name] === null || profile[name] === '');
    if (missing.length) problems.push({ employeeId: emp.employeeId, missing });
  }

  res.json({ valid: problems.length === 0, problems });
});

module.exports = router;
