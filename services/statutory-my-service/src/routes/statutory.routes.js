'use strict';
const express = require('express');
const prisma = require('../utils/prisma');
const { computeEpf } = require('../engines/epf.engine');
const { computeSocso } = require('../engines/socso.engine');
const { computeEis } = require('../engines/eis.engine');
const { computePcb } = require('../engines/pcb.engine');
const { MY_EMPLOYMENT_RULES, MY_SCHEMA } = require('../rules/employment-rules');

const router = express.Router();

/**
 * Service-to-service only — there is no JWT path into this service.
 * Fails closed when INTERNAL_SERVICE_KEY is unset rather than falling back to a
 * development default (the VAPT C-07 defect class). Mirrors the SG sibling.
 */
function requireInternalKey(req, res, next) {
  const expected = process.env.INTERNAL_SERVICE_KEY;
  if (!expected) return res.status(401).json({ error: 'Internal key not configured' });
  if (req.headers['x-internal-service-key'] !== expected) {
    return res.status(401).json({ error: 'Invalid internal service key' });
  }
  next();
}

/**
 * Resolve the rate version to compute on, or explain why we cannot.
 *
 * This is where PRD §A7.1 stops being a checklist. A7 requires every seeded
 * figure to be traceable to a named publication with a retrieval date — but a
 * provenance column nobody reads is just a comment. So verification is a
 * RUNTIME GATE: an unverified rate version cannot compute payroll. Shipping
 * Malaysian rates that nobody reconciled against KWSP/PERKESO/LHDN produces a
 * 503 the operator must act on, rather than plausible, wrong payslips that
 * surface months later as an underpayment plus a late charge.
 */
async function resolveRateVersion() {
  const active = await prisma.rateVersion.findFirst({
    where: { country: 'MY', isActive: true },
    orderBy: { effectiveFrom: 'desc' },
  });
  if (!active) {
    return { error: 'No active MY rate version — payroll cannot compute', status: 503 };
  }
  if (!active.verifiedAt) {
    return {
      status: 503,
      error:
        `MY rate version ${active.version} has not been verified against its source ` +
        `(${active.source}). Malaysian payroll is blocked until a named reviewer ` +
        `reconciles the EPF, SOCSO, EIS and PCB tables against the official ` +
        `publications and records verifiedBy/verifiedAt. See PRD §A7.1.`,
    };
  }
  return { active };
}

/**
 * Compute statutory contributions for a whole payroll run.
 * Batched on purpose: a 500-employee run makes one call, not 500.
 */
router.post('/compute-batch', requireInternalKey, async (req, res, next) => {
  try {
    const { entity, employees, period } = req.body || {};

    // Being routed the wrong country must be loud. Silently computing a
    // Singapore entity as Malaysia would produce plausible, wrong payslips.
    if (!entity || entity.country !== 'MY') {
      return res.status(400).json({ error: 'statutory-my-service only computes MY entities' });
    }
    if (!Array.isArray(employees) || employees.length === 0) {
      return res.status(400).json({ error: 'employees[] is required' });
    }

    const resolved = await resolveRateVersion();
    if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
    const { active } = resolved;

    const [epfBands, socsoBands, eisBands, pcbBands, reliefs, hrdRates] = await Promise.all([
      prisma.epfBand.findMany({ where: { rateVersion: active.version } }),
      prisma.socsoBand.findMany({ where: { rateVersion: active.version } }),
      prisma.eisBand.findMany({ where: { rateVersion: active.version } }),
      prisma.pcbBand.findMany({ where: { rateVersion: active.version } }),
      prisma.pcbRelief.findMany({ where: { rateVersion: active.version } }),
      prisma.hrdLevyRate.findMany({ where: { rateVersion: active.version } }),
    ]);

    const reliefBy = Object.fromEntries(reliefs.map((r) => [r.code, r.amount]));
    const results = [];

    for (const emp of employees) {
      const { employeeId, profile = {}, remuneration = {} } = emp;
      const wages = remuneration.gross || 0;
      const { age, citizenship } = profile;

      let epf, socso, eis, pcb;
      try {
        epf = computeEpf({ wages, age, citizenship, bands: epfBands });
        socso = computeSocso({ wages, age, citizenship, bands: socsoBands });
        eis = computeEis({ wages, age, citizenship, bands: eisBands });
        pcb = computePcb({
          monthlyRemuneration: wages,
          monthlyEpf: epf.employee,
          accumulatedRemuneration: remuneration.ytdGross || 0,
          accumulatedEpf: remuneration.ytdEmployeeEpf || 0,
          remainingMonths: remainingMonthsIn(period),
          category: profile.mtdCategory,
          totalReliefs: totalReliefsFor(profile, reliefBy),
          zakatPaid: remuneration.ytdZakat || 0,
          mtdPaid: remuneration.ytdMtd || 0,
          bands: pcbBands,
        });
      } catch (err) {
        // Fail the whole run and NAME the employee. Computing a zero for an
        // unmatched employee would be an invisible underpayment.
        return res.status(503).json({ error: `${err.code || 'COMPUTE_FAILED'}: ${err.message}`, employeeId });
      }

      const employerLevies = [];
      if (entity.hrdCorpRegistered) {
        const hrd = findHrdRate(hrdRates, entity.employeeCount || 0);
        if (hrd) {
          employerLevies.push({
            code: 'HRD', label: 'HRD Corp Levy',
            amount: round2(wages * hrd.rate), basis: hrd,
          });
        }
      }

      results.push({
        employeeId,
        employeeDeductions: [
          { code: 'EPF_EE',   label: 'EPF (Employee)',   amount: epf.employee,   basis: epf.basis },
          { code: 'SOCSO_EE', label: 'SOCSO (Employee)', amount: socso.employee, basis: socso.basis },
          { code: 'EIS_EE',   label: 'EIS (Employee)',   amount: eis.employee,   basis: eis.basis },
          { code: 'PCB',      label: 'PCB (MTD)',        amount: pcb.amount,     basis: pcb.basis },
        ],
        employerContributions: [
          { code: 'EPF_ER',   label: 'EPF (Employer)',   amount: epf.employer,   basis: epf.basis },
          { code: 'SOCSO_ER', label: 'SOCSO (Employer)', amount: socso.employer, basis: socso.basis },
          { code: 'EIS_ER',   label: 'EIS (Employer)',   amount: eis.employer,   basis: eis.basis },
        ],
        employerLevies,
      });
    }

    res.json({ rateVersion: active.version, currency: 'MYR', results });
  } catch (err) { next(err); }
});

/** Months remaining in the year AFTER the current one — the `n` in the MTD formula. */
function remainingMonthsIn(period) {
  // period is "YYYY-MM"; anchored on the string rather than `new Date()` so the
  // figure does not depend on when the run happens to be executed.
  const month = parseInt(String(period || '').split('-')[1], 10);
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    const err = new Error(`period must be YYYY-MM, got ${period}`);
    err.code = 'PCB_BAD_PERIOD';
    throw err;
  }
  return 12 - month;
}

function totalReliefsFor(profile, reliefBy) {
  let total = reliefBy.INDIVIDUAL || 0;
  if (profile.mtdCategory === 2) total += reliefBy.SPOUSE || 0;
  total += (profile.qualifyingChildren || 0) * (reliefBy.CHILD || 0);
  return total;
}

function findHrdRate(rates, employeeCount) {
  return rates.find((r) =>
    employeeCount >= r.minEmployees &&
    (r.maxEmployees === null || r.maxEmployees === undefined || employeeCount <= r.maxEmployees)) || null;
}

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

/** What MY needs on an employee/entity before payroll can compute. */
router.get('/schema', requireInternalKey, (_req, res) => res.json(MY_SCHEMA));

/** Leave tiers, OT multipliers, normal hours, notice bands. */
router.get('/employment-rules', requireInternalKey, (_req, res) => res.json(MY_EMPLOYMENT_RULES));

/**
 * Pre-run completeness check. Runs BEFORE compute so missing data surfaces as a
 * list of employees to fix, never as a half-written payroll run (spec §3.4).
 */
router.post('/validate', requireInternalKey, async (req, res, next) => {
  try {
    const { employees } = req.body || {};
    if (!Array.isArray(employees)) {
      return res.status(400).json({ error: 'employees[] is required' });
    }

    const required = MY_SCHEMA.employeeFields.filter((f) => f.required).map((f) => f.name);
    const problems = [];
    for (const emp of employees) {
      const profile = emp.profile || {};
      const missing = required.filter((name) =>
        profile[name] === undefined || profile[name] === null || profile[name] === '');
      if (missing.length) problems.push({ employeeId: emp.employeeId, missing });
    }

    // Surfaced by /validate too, so an operator learns the tables are
    // unverified BEFORE starting a run rather than at compute time.
    const resolved = await resolveRateVersion();

    res.json({
      ok: problems.length === 0 && !resolved.error,
      problems,
      rateVersion: resolved.active ? resolved.active.version : null,
      rateVersionProblem: resolved.error || null,
    });
  } catch (err) { next(err); }
});

module.exports = router;
