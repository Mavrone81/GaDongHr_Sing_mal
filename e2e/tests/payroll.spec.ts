/**
 * Singapore Payroll Statutory Compliance Audit Spec
 * ==================================================
 *
 * THIS IS A COMPLIANCE-DRIVEN TEST SUITE, NOT A SYSTEM-CHARACTERISATION SUITE.
 *
 * Every numeric assertion in the statutory-compliance section below is derived
 * from a SPECIFIC published source (CPF Board, MOM, IRAS, SkillsFuture SG).
 * The expected value is what the statute MANDATES — not what the system
 * currently produces. A test failure therefore indicates one of:
 *
 *   (a) the system has a compliance bug — re-seed data / fix the engine,
 *   (b) the statute has changed since this spec was written — update the
 *       expected value AND the cited source (date in §Statutory Sources),
 *   (c) the system intentionally diverges from the statute for a documented
 *       business reason — record it in TESTING.md §11 "Known Divergences".
 *
 * Do NOT make a failing assertion pass by reading the system's output and
 * pasting it back into the test — that defeats the entire point of this spec.
 *
 * ── Statutory Sources (as at 2026-05-22) ───────────────────────────────────
 *
 *   [CPF-RATES-2026]     CPF Board "CPF Contribution Rate Table from 1 January 2026"
 *                        (official PDF) + cpf.gov.sg/employer rate page
 *                        Effective 2026-01-01:
 *                          • OW ceiling: SGD 8,000/month   (final step of Budget 2023's
 *                            4-year ramp: $6,300 → $6,800 → $7,400 → $8,000)
 *                          • AW ceiling: SGD 102,000/year  (combined with OW; unchanged)
 *                          • Rounding: TOTAL CPF rounded to nearest dollar; EMPLOYEE
 *                            share rounded DOWN; EMPLOYER share = TOTAL − EMPLOYEE
 *                            (NOT a separate Math.round). See §11 in TESTING.md.
 *                          • SC/PR Yr3+ ≤55: employee 20% / employer 17% (Total 37%)
 *                          • SC/PR Yr3+ senior-worker rates (Jan 2026, per CPF Board
 *                            official Table 1 — verified against the published doc
 *                            "CPF Contribution Rate Table from 1 January 2026"):
 *                              55–60: 18.0% / 16.0%   (Total 34%)
 *                              60–65: 12.5% / 12.5%   (Total 25%, even split)
 *                              65–70:  7.5% /  9.0%   (Total 16.5% — not enhanced this cycle)
 *                              70+:    5.0% /  7.5%   (Total 12.5%, floor)
 *                          • FOREIGNER: 0% / 0% (unchanged)
 *
 *   [CPF-PR-GRAD]        CPF Board "Graduated Employer/Employee Contribution Rates
 *                        for First Two Years of Permanent Resident"
 *                        (PR Year 1: 5%/4% ; PR Year 2: 15%/9%)
 *
 *   [CPF-FOREIGNER]      CPF Act (Cap. 36) s.7 — only Singapore Citizens and
 *                        Permanent Residents are CPF-eligible; foreigners exempt.
 *
 *   [CPF-WAGES-DEF]      CPF Board "What constitutes wages?" — wages include all
 *                        remuneration in money under contract of service. Excludes
 *                        bona-fide expense reimbursements; deductions (loans,
 *                        garnishments) do NOT reduce the CPF-able base.
 *
 *   [SDL-ACT]            Skills Development Levy Act + SkillsFuture SG guidelines
 *                        (rate 0.25%, min SGD 2.00, max SGD 11.25, salary cap
 *                        SGD 4,500). Levy is per employee, per month.
 *
 *   [EA-SECT-20]         Employment Act (Cap. 91) s.20 + MOM Salary Calculator —
 *                        incomplete-month salary = monthly × (days worked /
 *                        working days in the month).
 *
 *   [EA-SECT-38]         Employment Act (Cap. 91) s.38 — overtime payment formula:
 *                        hourly basic rate = (12 × monthly basic) / (52 × normal
 *                        weekly hours), then × multiplier × OT hours. EA caps
 *                        "normal weekly hours" at 44.
 *
 *   [IRAS-EMP-INCOME]    IRAS e-Tax Guide "Tax Treatment of Employee Remuneration"
 *                        — reimbursements for legitimate business expenses are NOT
 *                        taxable income; salary advances repaid via deduction
 *                        remain taxable in the period earned (not reduced by
 *                        deduction).
 *
 *   [CPF-ESUBMIT]        CPF Board "e-Submission File Format" — pipe-delimited
 *                        flat file, header "EMPLOYER|UEN|YYYY-MM|CPF_SUBMIT" + one
 *                        detail line per employee.
 *
 * Tests are grouped into two clearly-labelled sections below: STATUTORY COMPLIANCE
 * (assertions cite a [SOURCE] tag) and SYSTEM BEHAVIOUR (operational/state tests
 * that have no statutory basis — they verify implementation, not compliance).
 *
 * Statutory tests covered:
 *
 *   ── Lifecycle ─────────────────────────────────────────────────────────
 *   1. POST /runs (create DRAFT) → POST /runs/:id/compute (PENDING_APPROVAL)
 *      → POST /runs/:id/approve (APPROVED) → POST /runs/:id/finalise (FINALISED)
 *      → GET /cpf-file/:runId returns CPF e-Submit flat file
 *      → POST /runs/:id/cancel cleans up
 *
 *   ── CPF Act (Cap. 36) — CPF Board rates Jan 2025 ─────────────────────
 *   2. SC age ≤55, OW = SGD 5,000, ytdOw = 0
 *        ⇒ employee 20% = $1,000 ; employer 17% = $850       (Total 37%)
 *   2b. SC age 55–60 (18% / 16%)   — OW 5,000 → $900 / $800   (Total 34%)
 *   2c. SC age 60–65 (12.5% / 12.5%) — OW 5,000 → $625 / $625 (Total 25%, even split)
 *   2d. SC age 65–70 (7.5% / 9%)   — OW 5,000 → $375 / $450   (Total 16.5%)
 *   2e. SC age 70+ (5% / 7.5%)     — OW 5,000 → $250 / $375   (Total 12.5%, floor)
 *       (also covers ageMax=null edge case in the rate-table lookup)
 *   All values per CPF Board "CPF Contribution Rate Table from 1 January 2026" Table 1.
 *   3. OW ceiling — SC age 35, OW = SGD 10,000 (above 2026 SGD 8,000 ceiling)
 *        ⇒ employee CPF = min(10000, 8000) × 20% = $1,600
 *           employer CPF = min(10000, 8000) × 17% = $1,360
 *   4. FOREIGNER exemption — any OW
 *        ⇒ employee = $0, employer = $0
 *   Tests 2b–2e (SC 55+ brackets) encode Jan 2026 senior-worker rates per the
 *   Budget 2022 phased plan. If a test fails, system likely still has Jan 2025
 *   rates seeded — that's the compliance finding to remediate.
 *   4b. AW (Additional Wages) ceiling — annual SGD 102,000 shared with OW.
 *       Five scenarios in total:
 *         - fully under cap (ytdOw=0, AW within room)
 *         - partially capped by ytdOw consuming the room
 *         - fully exhausted by ytdOw
 *         - capped by ytdAw alone (proves the `102000 − ytdAw` constraint)
 *         - realistic exec scenario: OW above ceiling AND AW partially capped
 *       Formula:
 *         awCeilingRemaining = max(102000 − ytdOw − thisMonthOwSubjectToCpf, 0)
 *         awSubjectToCpf     = min(aw, min(awCeilingRemaining, 102000 − ytdAw))
 *   5. PR_YEAR1 graduated rate (employee 5%, employer 4%) — OW = SGD 4,000
 *        ⇒ employee = $200, employer = $160
 *   5b. PR_YEAR2 graduated rate (employee 15%, employer 9%) — OW = SGD 4,000
 *        ⇒ employee = $600, employer = $360
 *
 *   ── SDL Act — Skills Development Levy bounds ─────────────────────────
 *   6. SDL = max(min(gross, 4500) × 0.25%, 2.00), capped at 11.25.
 *      Tested via the actual payslip row produced by the real DB config.
 *   6b. Zero-gross exemption (early return, not the $2.00 floor)
 *   6c. SGD 4,500 cap boundary precision (exact value vs just-below)
 *
 *   ── EA s.20 — Pro-ration by working days ────────────────────────────
 *   Four scenarios using a real period's actual calendar:
 *     - mid-month STARTER (joined half-month)          — March (31 days)
 *     - mid-month LEAVER (ceased half-month)            — February (28/29 days, leap-year edge)
 *     - same-period joiner AND leaver (short stint)     — June (30 days)
 *     - WORKING-TYPE CHANGE (full-time → part-time)     — November (30 days)
 *   Verifies that pro-ration applies to basic salary, gross pay, AND CPF base.
 *
 *   **Calendar rotation**: pro-ration tests use `calendarVariedPeriod()` which
 *   rotates the YEAR per CI run (day-stable seed). Over 12 consecutive days, the
 *   formula gets exercised against 12 different working-day calendars per month
 *   slot — total 48 (year, month) combinations sampled. Each test's expect()
 *   message embeds the actual period chosen so failures are reproducible via
 *   `E2E_PAYROLL_SEED=<n>` env var.
 *
 *   ── EA s.38 — Overtime via paycode ───────────────────────────────────
 *   OT enters payroll as a paycode line item (`OT_PAY` pay component, wageType=OW,
 *   isCpfApplicable=true). Three integration tests:
 *     - OT paycode flows into effective OW and CPF base
 *     - OT + basic exceeds SGD 8,000 (Jan 2026) ceiling → CPF capped
 *     - OIL (Off-In-Lieu) — non-CPF OW paycode adds to gross but NOT to CPF base
 *       (pins the `else` branch in the compute loop)
 *   The EA s.38 formula itself (annual basic / 52 / weeklyHours × multiplier × hours)
 *   is unit-tested in payroll-utils.unit.test.js; this spec tests the integration only.
 *
 *   ── DEDUCTION and REIMBURSEMENT paycodes ─────────────────────────────
 *   Closes the last two branches of the compute loop:
 *     - DEDUCTION (STAFF_LOAN) reduces net pay only — gross and CPF unchanged
 *     - DEDUCTION amount taken as Math.abs (negative input still deducts)
 *     - REIMBURSEMENT (MED_REIMB) adds to net pay only — IRAS rule: reimbursements
 *       are not taxable income, not CPF-able
 *     - MIXED: OT + DEDUCTION + REIMBURSEMENT in same payslip — all branches active
 *       together without cross-contamination
 *
 *   ── Payroll lifecycle guards ─────────────────────────────────────────
 *   7. POST /runs duplicate (same period + runType) → 409
 *   8. compute on FINALISED run → 400
 *   9. finalise non-APPROVED run → 400
 *
 *   ── CPF e-Submit (CPF Board file format) ─────────────────────────────
 *   10. After finalise, GET /cpf-file/:runId returns "EMPLOYER|UEN|period|CPF_SUBMIT"
 *       header + one detail line per employee in pipe-delimited format.
 *
 *   ── Employee-facing payslip ─────────────────────────────────────────
 *   11. GET /payroll/payslips/me — employee fetches their own published payslip
 *
 *   ── RBAC (CPF/IRAS data is sensitive — segregation of duties) ────────
 *   12. EMPLOYEE creates payroll run → 403
 *   13. RECRUITER finalises a run → 403 (no payroll:manage)
 *
 * Note on cleanup: each test uses a UNIQUE period in the far future
 * (`2099-XX`) so re-runs and parallel CI don't collide with real data
 * or each other. Every test ends by POSTing /cancel which wipes the run +
 * its payslips, leaving the DB clean.
 *
 * Note on maker-checker: docker-compose defaults DISABLE_MAKER_CHECKER=true,
 * so we don't assert that same-user approval is blocked. The relevant gate
 * still gets exercised in test 1 because admin user approves their own run.
 */

import { test, expect, request, APIRequestContext } from '@playwright/test';
import { TEST_USERS } from '../lib/testUsers';
import { signJwt } from '../lib/jwt';
import { Role } from '../lib/roles';

const API_BASE = process.env.E2E_API_URL ?? 'http://localhost:4000';

async function ctxAs(role: Role): Promise<APIRequestContext> {
  const token = signJwt(TEST_USERS[role], role);
  return request.newContext({
    baseURL: API_BASE,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
}

// Unique YYYY-MM periods in 2099. Each test claims its own slot so re-runs
// and parallel CI runs don't collide.
function uniquePeriod(slot: number): string {
  const month = String((slot % 12) + 1).padStart(2, '0');
  // Use 2099 + (slot/12) to keep it strictly in the future and to ensure even
  // a series of re-runs after a slot has been polluted doesn't trip duplicate
  // guards: each test cleans up via /cancel.
  const year = 2099 + Math.floor(slot / 12);
  return `${year}-${month}`;
}

// For pro-ration / calendar-sensitive tests: rotate the YEAR per CI run so the
// EA s.20 working-day formula gets exercised against a different calendar each
// time. The monthSlot still picks the month so each pro-ration test in a single
// run hits a different month (different working-day count + starting weekday).
//
// - Seed = day-stable by default (changes once per UTC day) so consecutive runs
//   on the same day are reproducible; consecutive days exercise new calendars.
// - Override with E2E_PAYROLL_SEED=<number> to pin a specific calendar — used
//   to reproduce a failure locally after CI flags one.
// - Range 2200–2211: distinct from uniquePeriod's 2099–2101 so the two helpers
//   never collide on the same period in the same run.
function calendarVariedPeriod(monthSlot: number): string {
  const dailySeed = Math.floor(Date.now() / 86_400_000);  // changes once per UTC day
  const seed      = Number(process.env.E2E_PAYROLL_SEED ?? dailySeed);
  const yearOff   = ((seed % 12) + 12) % 12;              // 0–11, safe for negative seeds
  const year      = 2200 + yearOff;
  const month     = (monthSlot % 12) + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}

interface EmpInput {
  employeeId: string;
  fullName?: string;
  ow: number;
  aw?: number;
  citizenStatus: 'SC' | 'PR_YR3_PLUS' | 'PR_YEAR1' | 'PR_YEAR2' | 'FOREIGNER';
  age: number;
  ytdOw?: number;
  ytdAw?: number;
  ytdGross?: number;
  ytdEmployeeCpf?: number;
  ytdEmployerCpf?: number;
  // EA s.20 pro-ration: passing either of these triggers working-day pro-ration
  startDate?: string;  // 'YYYY-MM-DD' — pro-rates from this day to period end
  endDate?: string;    // 'YYYY-MM-DD' — pro-rates from period start to this day
}

function emp(input: EmpInput) {
  return {
    employeeCode: input.employeeId.slice(0, 12),
    fullName: input.fullName ?? `Test Employee ${input.employeeId.slice(0, 6)}`,
    grossPay: input.ow + (input.aw ?? 0),
    ow: input.ow,
    aw: input.aw ?? 0,
    citizenStatus: input.citizenStatus,
    age: input.age,
    ytdOw: input.ytdOw ?? 0,
    ytdAw: input.ytdAw ?? 0,
    ytdGross: input.ytdGross ?? 0,
    ytdEmployeeCpf: input.ytdEmployeeCpf ?? 0,
    ytdEmployerCpf: input.ytdEmployerCpf ?? 0,
    weeklyHours: 44,
    bankCode: '7171',
    bankAccount: '0000000000',
    employeeId: input.employeeId,
    startDate: input.startDate ?? null,
    endDate: input.endDate ?? null,
  };
}

// ── Calendar helpers for EA s.20 pro-ration tests ─────────────────────────────
// These mirror the route's logic at services/payroll-service/src/routes/payroll.routes.js:21-37
// so expected pro-rated salaries are computed against the real calendar of the period.

function lastDayOfPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${period}-${String(lastDay).padStart(2, '0')}`;
}

function workingDaysBetween(fromYMD: string, toYMD: string): number {
  let count = 0;
  const d = new Date(fromYMD + 'T00:00:00Z');
  const end = new Date(toYMD + 'T00:00:00Z');
  while (d <= end) {
    const dow = d.getUTCDay();
    if (dow >= 1 && dow <= 5) count++;  // Mon–Fri only
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return count;
}

function totalWorkingDaysInPeriod(period: string): number {
  return workingDaysBetween(`${period}-01`, lastDayOfPeriod(period));
}

function proRatedSalary(monthly: number, workedDays: number, totalDays: number): number {
  return Math.round(monthly * (workedDays / totalDays) * 100) / 100;
}

async function cancelRun(admin: APIRequestContext, runId: string) {
  // Idempotent: cancel deletes payslips, line items, and the run itself.
  // Ignore failures so tests don't fail in cleanup.
  await admin.post(`/api/payroll/runs/${runId}/cancel`).catch(() => {});
}

async function getPayslip(admin: APIRequestContext, runId: string, employeeId: string) {
  const resp = await admin.get(`/api/payroll/runs/${runId}/payslips`);
  expect(resp.ok(), 'fetch payslips').toBe(true);
  const body = await resp.json();
  const slip = body.payslips.find((p: any) => p.employeeId === employeeId);
  expect(slip, `payslip should exist for ${employeeId}`).toBeTruthy();
  return slip;
}

// ═════════════════════════════════════════════════════════════════════════════
// ║                SYSTEM BEHAVIOUR / OPERATIONAL TESTS                       ║
// ║   These verify implementation details (state machine, RBAC, file format), ║
// ║   not statutory rules. Failures here may indicate operational bugs but    ║
// ║   are not in themselves compliance violations.                            ║
// ═════════════════════════════════════════════════════════════════════════════

// ─── 1. Full lifecycle (state machine + [CPF-ESUBMIT] file format) ────────────
test('SYSTEM: DRAFT → compute → APPROVE → FINALISE → [CPF-ESUBMIT] file generated', async () => {
  const admin = await ctxAs('SUPER_ADMIN');
  const period = uniquePeriod(0);
  const empId = `e2e-lc-${Date.now()}`;

  // Create
  const create = await admin.post('/api/payroll/runs', { data: { period, runType: 'MONTHLY' } });
  expect(create.status(), 'create run').toBe(201);
  const run = await create.json();
  expect(run.status).toBe('DRAFT');

  try {
    // Compute (with controlled employee data)
    const compute = await admin.post(`/api/payroll/runs/${run.id}/compute`, {
      data: { employees: [emp({ employeeId: empId, ow: 5000, citizenStatus: 'SC', age: 35 })] },
    });
    expect(compute.ok(), 'compute').toBe(true);

    // Status now PENDING_APPROVAL
    const after = await (await admin.get(`/api/payroll/runs/${run.id}`)).json();
    expect(after.status).toBe('PENDING_APPROVAL');

    // Approve (maker-checker disabled in compose, so admin can approve own run)
    const approve = await admin.post(`/api/payroll/runs/${run.id}/approve`);
    expect(approve.ok(), 'approve').toBe(true);
    expect((await approve.json()).run.status).toBe('APPROVED');

    // Finalise
    const finalise = await admin.post(`/api/payroll/runs/${run.id}/finalise`);
    expect(finalise.ok(), 'finalise').toBe(true);

    // CPF e-Submit file — format per [CPF-ESUBMIT]
    const cpfFile = await admin.get(`/api/payroll/cpf-file/${run.id}`);
    expect(cpfFile.ok(), '[CPF-ESUBMIT] file generation').toBe(true);
    const body = await cpfFile.text();
    expect(body.split('\n')[0], '[CPF-ESUBMIT] header format EMPLOYER|UEN|YYYY-MM|CPF_SUBMIT').toMatch(/^EMPLOYER\|[A-Z0-9]+\|[\d-]{7}\|CPF_SUBMIT$/);
    const detail = body.split('\n').find(l => l.startsWith(empId));
    expect(detail, '[CPF-ESUBMIT] one detail line per employee').toBeTruthy();
    expect(detail!.split('|').length, '[CPF-ESUBMIT] detail = 6 pipe-delimited fields').toBe(6);
  } finally {
    await cancelRun(admin, run.id);
  }
  await admin.dispose();
});

// ═════════════════════════════════════════════════════════════════════════════
// ║                 STATUTORY COMPLIANCE TESTS                                ║
// ║   Every numeric expectation below is sourced from [SOURCE] tags above.    ║
// ║   A failure means investigate, NOT update the expected value.             ║
// ═════════════════════════════════════════════════════════════════════════════

// ─── 2. CPF SC rate Jan 2025 [CPF-RATES-2026] ─────────────────────────────────
test('[CPF-RATES-2026] SC age 35, OW 5000 → employee 20% = $1000, employer 17% = $850', async () => {
  const admin = await ctxAs('SUPER_ADMIN');
  const period = uniquePeriod(1);
  const empId = `e2e-sc-${Date.now()}`;

  const run = await (await admin.post('/api/payroll/runs', { data: { period, runType: 'MONTHLY' } })).json();
  try {
    await admin.post(`/api/payroll/runs/${run.id}/compute`, {
      data: { employees: [emp({ employeeId: empId, ow: 5000, citizenStatus: 'SC', age: 35 })] },
    });
    const slip = await getPayslip(admin, run.id, empId);
    // Statutory expectations — source: [CPF-RATES-2026]
    expect(slip.grossPay, '[CPF-RATES-2026] gross = full OW (no statutory deductions to gross)').toBe(5000);
    expect(slip.employeeCpf, '[CPF-RATES-2026] SC/PR Yr3+ ≤55 employee rate = 20% × 5000').toBe(1000);
    expect(slip.employerCpf, '[CPF-RATES-2026] SC/PR Yr3+ ≤55 employer rate = 17% × 5000').toBe(850);
    expect(slip.basicSalary, '[CPF-RATES-2026] OW reflects contracted monthly').toBe(5000);
    expect(slip.netPay, '[CPF-WAGES-DEF] net = gross − employee CPF (no other statutory pre-tax deductions)').toBe(4000);
  } finally {
    await cancelRun(admin, run.id);
  }
  await admin.dispose();
});

// ─── 2b–2e. CPF SC age-bracket rate rows [CPF-RATES-2026] ─────────────────────
// Each test pins one age bracket per CPF Board's OFFICIAL Table 1 (Jan 2026):
//
//   ≤55:    employee 20%   / employer 17%    (Total 37%)
//   55–60:  employee 18%   / employer 16%    (Total 34%) ← enhanced this cycle
//   60–65:  employee 12.5% / employer 12.5%  (Total 25%) ← enhanced this cycle
//   65–70:  employee 7.5%  / employer 9%     (Total 16.5%) — NOT enhanced this cycle
//   70+:    employee 5%    / employer 7.5%   (Total 12.5%, floor)
//
// If 2b or 2c fails, the system likely still has Jan 2025 rates seeded
// (55–60 was 16%/15%, 60–65 was 10.5%/11.5%) — a real compliance gap that
// triggers under-contribution. Resolution: update cpf_rates rows in seed
// and the running DB to the values above.

test('[CPF-RATES-2026] SC age 57 → 55–60 bracket: employee 18%, employer 16% (Total 34%)', async () => {
  const admin = await ctxAs('SUPER_ADMIN');
  const period = uniquePeriod(14);
  const empId = `e2e-sc57-${Date.now()}`;
  const run = await (await admin.post('/api/payroll/runs', { data: { period, runType: 'MONTHLY' } })).json();
  try {
    await admin.post(`/api/payroll/runs/${run.id}/compute`, {
      data: { employees: [emp({ employeeId: empId, ow: 5000, citizenStatus: 'SC', age: 57 })] },
    });
    const slip = await getPayslip(admin, run.id, empId);
    // Official CPF Board Table 1 Jan 2026: 34% total (18% emp + 16% emplr)
    expect(slip.employeeCpf, '[CPF-RATES-2026] SC 55–60 employee rate 18% × 5000').toBe(900);
    expect(slip.employerCpf, '[CPF-RATES-2026] SC 55–60 employer rate 16% × 5000').toBe(800);
  } finally {
    await cancelRun(admin, run.id);
  }
  await admin.dispose();
});

test('[CPF-RATES-2026] SC age 62 → 60–65 bracket: employee 12.5%, employer 12.5% (Total 25%, even split)', async () => {
  const admin = await ctxAs('SUPER_ADMIN');
  const period = uniquePeriod(15);
  const empId = `e2e-sc62-${Date.now()}`;
  const run = await (await admin.post('/api/payroll/runs', { data: { period, runType: 'MONTHLY' } })).json();
  try {
    await admin.post(`/api/payroll/runs/${run.id}/compute`, {
      data: { employees: [emp({ employeeId: empId, ow: 5000, citizenStatus: 'SC', age: 62 })] },
    });
    const slip = await getPayslip(admin, run.id, empId);
    // Official CPF Board Table 1 Jan 2026: 25% total (12.5% emp + 12.5% emplr — even split)
    expect(slip.employeeCpf, '[CPF-RATES-2026] SC 60–65 employee rate 12.5% × 5000').toBe(625);
    expect(slip.employerCpf, '[CPF-RATES-2026] SC 60–65 employer rate 12.5% × 5000').toBe(625);
  } finally {
    await cancelRun(admin, run.id);
  }
  await admin.dispose();
});

test('[CPF-RATES-2026] SC age 67 → 65–70 bracket: employee 7.5%, employer 9% (Total 16.5%, unchanged from earlier)', async () => {
  const admin = await ctxAs('SUPER_ADMIN');
  const period = uniquePeriod(16);
  const empId = `e2e-sc67-${Date.now()}`;
  const run = await (await admin.post('/api/payroll/runs', { data: { period, runType: 'MONTHLY' } })).json();
  try {
    await admin.post(`/api/payroll/runs/${run.id}/compute`, {
      data: { employees: [emp({ employeeId: empId, ow: 5000, citizenStatus: 'SC', age: 67 })] },
    });
    const slip = await getPayslip(admin, run.id, empId);
    // Official CPF Board Table 1 Jan 2026: 16.5% total (7.5% emp + 9% emplr — not enhanced for Jan 2026)
    expect(slip.employeeCpf, '[CPF-RATES-2026] SC 65–70 employee rate 7.5% × 5000').toBe(375);
    expect(slip.employerCpf, '[CPF-RATES-2026] SC 65–70 employer rate 9% × 5000').toBe(450);
  } finally {
    await cancelRun(admin, run.id);
  }
  await admin.dispose();
});

test('[CPF-RATES-2026] SC age 72 → 70+ bracket: employee 5%, employer 7.5%', async () => {
  const admin = await ctxAs('SUPER_ADMIN');
  const period = uniquePeriod(17);
  const empId = `e2e-sc72-${Date.now()}`;
  const run = await (await admin.post('/api/payroll/runs', { data: { period, runType: 'MONTHLY' } })).json();
  try {
    await admin.post(`/api/payroll/runs/${run.id}/compute`, {
      data: { employees: [emp({ employeeId: empId, ow: 5000, citizenStatus: 'SC', age: 72 })] },
    });
    const slip = await getPayslip(admin, run.id, empId);
    expect(slip.employeeCpf, '[CPF-RATES-2026] SC 70+ employee rate 5% × 5000').toBe(250);
    expect(slip.employerCpf, '[CPF-RATES-2026] SC 70+ employer rate 7.5% × 5000').toBe(375);
  } finally {
    await cancelRun(admin, run.id);
  }
  await admin.dispose();
});

// ─── 3. CPF OW ceiling [CPF-RATES-2026] ───────────────────────────────────────
test('[CPF-RATES-2026] OW above SGD 8,000 monthly ceiling is capped (SC, OW 10000 → CPF base 8000)', async () => {
  const admin = await ctxAs('SUPER_ADMIN');
  const period = uniquePeriod(2);
  const empId = `e2e-ceil-${Date.now()}`;

  const run = await (await admin.post('/api/payroll/runs', { data: { period, runType: 'MONTHLY' } })).json();
  try {
    await admin.post(`/api/payroll/runs/${run.id}/compute`, {
      // OW 10000 — $2,000 over the Jan 2026 ceiling of $8,000
      data: { employees: [emp({ employeeId: empId, ow: 10000, citizenStatus: 'SC', age: 35 })] },
    });
    const slip = await getPayslip(admin, run.id, empId);
    // Jan 2026 OW ceiling: 8000 × 20% = 1600 ; 8000 × 17% = 1360
    expect(slip.employeeCpf, '[CPF-RATES-2026] OW ceiling SGD 8,000/month — employee 20% × 8000').toBe(1600);
    expect(slip.employerCpf, '[CPF-RATES-2026] OW ceiling SGD 8,000/month — employer 17% × 8000').toBe(1360);
    expect(slip.grossPay, '[CPF-WAGES-DEF] gross = full earnings; only CPF base is capped').toBe(10000);
    // Net = gross − employee CPF only (employer CPF doesn't reduce net)
    expect(slip.netPay, '[CPF-WAGES-DEF] employer CPF does not reduce net pay').toBe(10000 - 1600);
  } finally {
    await cancelRun(admin, run.id);
  }
  await admin.dispose();
});

// ─── 4. CPF FOREIGNER exemption [CPF-FOREIGNER] ──────────────────────────────
test('[CPF-FOREIGNER] CPF Act s.7 — foreigners exempt; OW 4500 → CPF $0 both sides', async () => {
  const admin = await ctxAs('SUPER_ADMIN');
  const period = uniquePeriod(3);
  const empId = `e2e-fgn-${Date.now()}`;

  const run = await (await admin.post('/api/payroll/runs', { data: { period, runType: 'MONTHLY' } })).json();
  try {
    await admin.post(`/api/payroll/runs/${run.id}/compute`, {
      data: { employees: [emp({ employeeId: empId, ow: 4500, citizenStatus: 'FOREIGNER', age: 40 })] },
    });
    const slip = await getPayslip(admin, run.id, empId);
    expect(slip.employeeCpf, '[CPF-FOREIGNER] foreigner exempt — no employee CPF').toBe(0);
    expect(slip.employerCpf, '[CPF-FOREIGNER] foreigner exempt — no employer CPF').toBe(0);
    expect(slip.netPay, '[CPF-FOREIGNER] net pay = full gross (no CPF deduction)').toBe(4500);
  } finally {
    await cancelRun(admin, run.id);
  }
  await admin.dispose();
});

// ─── 5b. CPF PR_YEAR2 graduated rate [CPF-PR-GRAD] ────────────────────────────
test('[CPF-PR-GRAD] PR Year 2 graduated — employee 15%, employer 9% (OW 4000 → $600/$360)', async () => {
  const admin = await ctxAs('SUPER_ADMIN');
  const period = uniquePeriod(18);
  const empId = `e2e-pr2-${Date.now()}`;

  const run = await (await admin.post('/api/payroll/runs', { data: { period, runType: 'MONTHLY' } })).json();
  try {
    await admin.post(`/api/payroll/runs/${run.id}/compute`, {
      data: { employees: [emp({ employeeId: empId, ow: 4000, citizenStatus: 'PR_YEAR2', age: 30 })] },
    });
    const slip = await getPayslip(admin, run.id, empId);
    expect(slip.employeeCpf, '[CPF-PR-GRAD] PR Year 2 employee rate 15% × 4000').toBe(600);
    expect(slip.employerCpf, '[CPF-PR-GRAD] PR Year 2 employer rate 9% × 4000').toBe(360);
  } finally {
    await cancelRun(admin, run.id);
  }
  await admin.dispose();
});

// ─── 4b. CPF AW annual ceiling [CPF-RATES-2026] ───────────────────────────────
// The hardest CPF rule. CPF Board's AW formula (Jan 2025):
//   awCeilingRemaining = max(102,000 − ytdOw − thisMonthOwSubjectToCpf, 0)
//   awSubjectToCpf     = min(aw, min(awCeilingRemaining, 102,000 − ytdAw))
// Five scenarios below pin the formula end-to-end against the system.

test('[CPF-RATES-2026] AW within annual ceiling — both OW and AW get full CPF (early-year scenario)', async () => {
  const admin = await ctxAs('SUPER_ADMIN');
  const period = uniquePeriod(11);
  const empId = `e2e-aw-low-${Date.now()}`;

  const run = await (await admin.post('/api/payroll/runs', { data: { period, runType: 'MONTHLY' } })).json();
  try {
    // Early-year scenario: ytdOw=0, this month OW=5000, plus AW bonus of 10000.
    // AW remaining = 102000 − 0 − 5000 = 97000 ; AW subject = min(10000, 97000) = 10000
    await admin.post(`/api/payroll/runs/${run.id}/compute`, {
      data: { employees: [emp({
        employeeId: empId, ow: 5000, aw: 10000,
        citizenStatus: 'SC', age: 35, ytdOw: 0, ytdAw: 0,
      })] },
    });
    const slip = await getPayslip(admin, run.id, empId);
    // Employee CPF: (5000 × 20%) + (10000 × 20%) = 1000 + 2000 = 3000
    expect(slip.employeeCpf, '[CPF-RATES-2026] CPF on OW + full AW (room remaining = 97000)').toBe(3000);
    // Employer CPF: (5000 × 17%) + (10000 × 17%) = 850 + 1700 = 2550
    expect(slip.employerCpf, '[CPF-RATES-2026] employer 17% × (OW + full AW)').toBe(2550);
    // grossPay = OW + AW
    expect(slip.grossPay).toBe(15000);
  } finally {
    await cancelRun(admin, run.id);
  }
  await admin.dispose();
});

test('[CPF-RATES-2026] AW partially capped — ytdOw consumes annual room (only $6,000 of $20,000 bonus CPF-able)', async () => {
  const admin = await ctxAs('SUPER_ADMIN');
  const period = uniquePeriod(12);
  const empId = `e2e-aw-cap-${Date.now()}`;

  const run = await (await admin.post('/api/payroll/runs', { data: { period, runType: 'MONTHLY' } })).json();
  try {
    // Year-end senior: ytdOw=88,000, OW=8000 (at 2026 ceiling), AW=20000 bonus
    //   awCeilingRemaining = max(102000 − 88000 − 8000, 0) = 6000
    //   awSubjectToCpf = min(20000, min(6000, 102000)) = 6000  (the other 14000 escapes CPF)
    await admin.post(`/api/payroll/runs/${run.id}/compute`, {
      data: { employees: [emp({
        employeeId: empId, ow: 8000, aw: 20000,
        citizenStatus: 'SC', age: 35, ytdOw: 88000, ytdAw: 0,
      })] },
    });
    const slip = await getPayslip(admin, run.id, empId);
    // Employee CPF: (8000 × 20%) + (6000 × 20%) = 1600 + 1200 = 2800
    expect(slip.employeeCpf, '[CPF-RATES-2026] AW capped: (8000 × 20%) + (6000 × 20%) = 2800').toBe(2800);
    // Employer CPF: (8000 × 17%) + (6000 × 17%) = 1360 + 1020 = 2380
    expect(slip.employerCpf, '[CPF-RATES-2026] employer on capped AW: (8000 × 17%) + (6000 × 17%) = 2380').toBe(2380);
  } finally {
    await cancelRun(admin, run.id);
  }
  await admin.dispose();
});

test('[CPF-RATES-2026] AW exhausted — ytdOw + this-month OW = annual ceiling, bonus escapes CPF entirely', async () => {
  const admin = await ctxAs('SUPER_ADMIN');
  const period = uniquePeriod(13);
  const empId = `e2e-aw-exh-${Date.now()}`;

  const run = await (await admin.post('/api/payroll/runs', { data: { period, runType: 'MONTHLY' } })).json();
  try {
    // Very high earner: ytdOw=94000 + this month OW=8000 = 102000 (= annual ceiling)
    //   awCeilingRemaining = max(102000 − 94000 − 8000, 0) = 0
    //   awSubjectToCpf = min(10000, min(0, 102000)) = 0 — no CPF on AW
    await admin.post(`/api/payroll/runs/${run.id}/compute`, {
      data: { employees: [emp({
        employeeId: empId, ow: 8000, aw: 10000,
        citizenStatus: 'SC', age: 35, ytdOw: 94000, ytdAw: 0,
      })] },
    });
    const slip = await getPayslip(admin, run.id, empId);
    // CPF on OW only: 8000 × 20% = 1600 ; 8000 × 17% = 1360
    expect(slip.employeeCpf, '[CPF-RATES-2026] AW ceiling exhausted — CPF on OW only: 8000 × 20%').toBe(1600);
    expect(slip.employerCpf, '[CPF-RATES-2026] employer CPF on OW only: 8000 × 17%').toBe(1360);
    // grossPay still includes the bonus (CPF cap doesn't reduce gross pay)
    expect(slip.grossPay, '[CPF-WAGES-DEF] gross = OW + full AW; ceiling only affects CPF base').toBe(18000);
  } finally {
    await cancelRun(admin, run.id);
  }
  await admin.dispose();
});

// ─── 5. CPF PR_YEAR1 graduated rate [CPF-PR-GRAD] ─────────────────────────────
test('[CPF-PR-GRAD] PR Year 1 graduated — employee 5%, employer 4% (OW 4000 → $200/$160)', async () => {
  const admin = await ctxAs('SUPER_ADMIN');
  const period = uniquePeriod(4);
  const empId = `e2e-pr1-${Date.now()}`;

  const run = await (await admin.post('/api/payroll/runs', { data: { period, runType: 'MONTHLY' } })).json();
  try {
    await admin.post(`/api/payroll/runs/${run.id}/compute`, {
      data: { employees: [emp({ employeeId: empId, ow: 4000, citizenStatus: 'PR_YEAR1', age: 30 })] },
    });
    const slip = await getPayslip(admin, run.id, empId);
    expect(slip.employeeCpf, '[CPF-PR-GRAD] PR Year 1 employee rate 5% × 4000').toBe(200);
    expect(slip.employerCpf, '[CPF-PR-GRAD] PR Year 1 employer rate 4% × 4000').toBe(160);
  } finally {
    await cancelRun(admin, run.id);
  }
  await admin.dispose();
});

// ─── 6. SDL Act bounds [SDL-ACT] ──────────────────────────────────────────────
test('[SDL-ACT] SDL bounds: floor $2.00, linear $5.00, max $11.25 at SGD 4,500 cap', async () => {
  const admin = await ctxAs('SUPER_ADMIN');
  const period = uniquePeriod(5);
  const empLow = `e2e-sdl-low-${Date.now()}`;
  const empMid = `e2e-sdl-mid-${Date.now()}`;
  const empHi  = `e2e-sdl-hi-${Date.now()}`;

  const run = await (await admin.post('/api/payroll/runs', { data: { period, runType: 'MONTHLY' } })).json();
  try {
    await admin.post(`/api/payroll/runs/${run.id}/compute`, {
      data: {
        employees: [
          emp({ employeeId: empLow, ow: 500,  citizenStatus: 'SC', age: 30 }), // 500 × 0.25% = $1.25 → min $2.00
          emp({ employeeId: empMid, ow: 2000, citizenStatus: 'SC', age: 30 }), // 2000 × 0.25% = $5.00
          emp({ employeeId: empHi,  ow: 6000, citizenStatus: 'SC', age: 30 }), // capped at 4500 × 0.25% = $11.25
        ],
      },
    });
    const slips = (await (await admin.get(`/api/payroll/runs/${run.id}/payslips`)).json()).payslips;
    const lo = slips.find((s: any) => s.employeeId === empLow);
    const mi = slips.find((s: any) => s.employeeId === empMid);
    const hi = slips.find((s: any) => s.employeeId === empHi);

    expect(lo.sdl, '[SDL-ACT] floor SGD 2.00 (gross × 0.25% < $2 → $2)').toBe(2.00);
    expect(mi.sdl, '[SDL-ACT] linear regime: 2000 × 0.25% = $5.00').toBe(5.00);
    expect(hi.sdl, '[SDL-ACT] capped at SGD 11.25 (= SGD 4,500 × 0.25%)').toBe(11.25);
  } finally {
    await cancelRun(admin, run.id);
  }
  await admin.dispose();
});

// ─── 6b. SDL boundary cases [SDL-ACT] ─────────────────────────────────────────
// Pins the two boundary behaviours: (i) zero-gross exemption and (ii) the exact
// SGD 4,500 cap boundary. Both are common off-by-one targets.

test('[SDL-ACT] zero-gross exemption: gross = $0 → SDL = $0 (not the $2.00 floor)', async () => {
  const admin = await ctxAs('SUPER_ADMIN');
  const period = uniquePeriod(19);
  const empId = `e2e-sdl-zero-${Date.now()}`;
  const run = await (await admin.post('/api/payroll/runs', { data: { period, runType: 'MONTHLY' } })).json();
  try {
    // Use FOREIGNER so OW doesn't trigger CPF; ow=0 means zero gross
    await admin.post(`/api/payroll/runs/${run.id}/compute`, {
      data: { employees: [emp({ employeeId: empId, ow: 0, citizenStatus: 'FOREIGNER', age: 30 })] },
    });
    const slip = await getPayslip(admin, run.id, empId);
    expect(slip.sdl, '[SDL-ACT] no remuneration ⇒ no levy (statutory exemption, not floor)').toBe(0);
  } finally {
    await cancelRun(admin, run.id);
  }
  await admin.dispose();
});

test('[SDL-ACT] cap boundary precision: gross = SGD 4,500 → SDL = $11.25; gross = $4,400 → $11.00', async () => {
  const admin = await ctxAs('SUPER_ADMIN');
  const period = uniquePeriod(20);
  const empAtCap     = `e2e-sdl-at-${Date.now()}`;
  const empJustBelow = `e2e-sdl-jb-${Date.now()}`;
  const run = await (await admin.post('/api/payroll/runs', { data: { period, runType: 'MONTHLY' } })).json();
  try {
    await admin.post(`/api/payroll/runs/${run.id}/compute`, {
      data: {
        employees: [
          // Gross = $4,500 exact → min(4500, 4500) × 0.25% = $11.25
          emp({ employeeId: empAtCap, ow: 4500, citizenStatus: 'SC', age: 30 }),
          // Gross = $4,400 → 4400 × 0.25% = $11.00 (still in linear regime)
          emp({ employeeId: empJustBelow, ow: 4400, citizenStatus: 'SC', age: 30 }),
        ],
      },
    });
    const slips = (await (await admin.get(`/api/payroll/runs/${run.id}/payslips`)).json()).payslips;
    const at = slips.find((s: any) => s.employeeId === empAtCap);
    const jb = slips.find((s: any) => s.employeeId === empJustBelow);
    expect(at.sdl, '[SDL-ACT] at cap boundary SGD 4,500: min(4500, 4500) × 0.25% = $11.25').toBe(11.25);
    expect(jb.sdl, '[SDL-ACT] just below cap: 4400 × 0.25% = $11.00 (still linear)').toBe(11.00);
  } finally {
    await cancelRun(admin, run.id);
  }
  await admin.dispose();
});

// ─── 4e–4f. CPF AW — two more interactions ────────────────────────────────────
// The earlier AW tests exercised ytdOw consuming the cap. These cover the OTHER
// constraint in the formula: `min(awCeilingRemaining, 102000 − ytdAw)`. If
// someone refactors the formula and accidentally drops the ytdAw term, the
// "ytdAw alone" test below will catch it.

test('[CPF-RATES-2026] AW capped by 102000 − ytdAw branch (independent of ytdOw)', async () => {
  const admin = await ctxAs('SUPER_ADMIN');
  const period = uniquePeriod(21);
  const empId = `e2e-aw-ytdaw-${Date.now()}`;
  const run = await (await admin.post('/api/payroll/runs', { data: { period, runType: 'MONTHLY' } })).json();
  try {
    // ytdOw=0 (low earner whose pay is mostly bonus-driven), ytdAw=100000 already
    //   awCeilingRemaining   = 102000 − 0 − 5000   = 97000  (lots of room from this side)
    //   102000 − ytdAw       = 102000 − 100000     = 2000   (this is the binding cap)
    //   awSubjectToCpf = min(10000, min(97000, 2000)) = 2000
    // (Unchanged math: this scenario doesn't interact with the OW ceiling.)
    await admin.post(`/api/payroll/runs/${run.id}/compute`, {
      data: { employees: [emp({
        employeeId: empId, ow: 5000, aw: 10000,
        citizenStatus: 'SC', age: 35, ytdOw: 0, ytdAw: 100000,
      })] },
    });
    const slip = await getPayslip(admin, run.id, empId);
    // Employee CPF: (5000 × 20%) + (2000 × 20%) = 1000 + 400 = 1400
    expect(slip.employeeCpf, '[CPF-RATES-2026] AW capped by 102000 − ytdAw: 1000 + 400 = 1400').toBe(1400);
    // Employer CPF: (5000 × 17%) + (2000 × 17%) = 850 + 340 = 1190
    expect(slip.employerCpf, '[CPF-RATES-2026] employer applies same caps: 850 + 340 = 1190').toBe(1190);
  } finally {
    await cancelRun(admin, run.id);
  }
  await admin.dispose();
});

test('[CPF-RATES-2026] AW + OW interactions — exec scenario with OW ceiling AND AW partial cap', async () => {
  const admin = await ctxAs('SUPER_ADMIN');
  const period = uniquePeriod(22);
  const empId = `e2e-aw-exec-${Date.now()}`;
  const run = await (await admin.post('/api/payroll/runs', { data: { period, runType: 'MONTHLY' } })).json();
  try {
    // Senior exec under Jan 2026 rates: OW=10000 (capped to 8000), AW=30000 year-end bonus,
    // ytdOw=80000 from earlier months
    //   owSubjectToCpf     = min(10000, 8000) = 8000
    //   awCeilingRemaining = max(102000 − 80000 − 8000, 0) = 14000
    //   awSubjectToCpf     = min(30000, min(14000, 102000)) = 14000
    await admin.post(`/api/payroll/runs/${run.id}/compute`, {
      data: { employees: [emp({
        employeeId: empId, ow: 10000, aw: 30000,
        citizenStatus: 'SC', age: 45, ytdOw: 80000, ytdAw: 0,
      })] },
    });
    const slip = await getPayslip(admin, run.id, empId);
    // Employee CPF: (8000 × 20%) + (14000 × 20%) = 1600 + 2800 = 4400
    expect(slip.employeeCpf, '[CPF-RATES-2026] CPF on OW (ceiling) + capped AW: 1600 + 2800 = 4400').toBe(4400);
    // Employer CPF: (8000 × 17%) + (14000 × 17%) = 1360 + 2380 = 3740
    expect(slip.employerCpf, '[CPF-RATES-2026] employer with both ceilings: 1360 + 2380 = 3740').toBe(3740);
    expect(slip.grossPay, '[CPF-WAGES-DEF] gross = full OW + AW; ceilings only affect CPF base').toBe(40000);
  } finally {
    await cancelRun(admin, run.id);
  }
  await admin.dispose();
});

// ─── 7. Duplicate run guard ───────────────────────────────────────────────────
test('SYSTEM: duplicate run (same period + runType) returns 409', async () => {
  const admin = await ctxAs('SUPER_ADMIN');
  const period = uniquePeriod(6);

  const first = await admin.post('/api/payroll/runs', { data: { period, runType: 'MONTHLY' } });
  expect(first.status()).toBe(201);
  const run = await first.json();
  try {
    const dup = await admin.post('/api/payroll/runs', { data: { period, runType: 'MONTHLY' } });
    expect(dup.status(), 'second MONTHLY for same period must 409').toBe(409);
    expect((await dup.json()).error).toMatch(/already exists/i);

    // ADHOC for same period is allowed (supplemental run)
    const adhoc = await admin.post('/api/payroll/runs', { data: { period, runType: 'ADHOC' } });
    expect(adhoc.status(), 'ADHOC supplemental for same period is allowed').toBe(201);
    await cancelRun(admin, (await adhoc.json()).id);
  } finally {
    await cancelRun(admin, run.id);
  }
  await admin.dispose();
});

// ─── 8. Status guards ─────────────────────────────────────────────────────────
test('SYSTEM: state-machine guards — cannot compute FINALISED, cannot finalise unapproved', async () => {
  const admin = await ctxAs('SUPER_ADMIN');
  const period = uniquePeriod(7);
  const empId = `e2e-guard-${Date.now()}`;

  const run = await (await admin.post('/api/payroll/runs', { data: { period, runType: 'MONTHLY' } })).json();
  try {
    // Cannot finalise DRAFT (not yet APPROVED)
    const finDraft = await admin.post(`/api/payroll/runs/${run.id}/finalise`);
    expect(finDraft.status(), 'finalise DRAFT must 400').toBe(400);
    expect((await finDraft.json()).error).toMatch(/APPROVED/i);

    // Compute → status PENDING_APPROVAL
    await admin.post(`/api/payroll/runs/${run.id}/compute`, {
      data: { employees: [emp({ employeeId: empId, ow: 3000, citizenStatus: 'SC', age: 30 })] },
    });

    // Still can't finalise — not APPROVED yet
    const finPending = await admin.post(`/api/payroll/runs/${run.id}/finalise`);
    expect(finPending.status(), 'finalise PENDING_APPROVAL must 400').toBe(400);

    // Approve + finalise
    await admin.post(`/api/payroll/runs/${run.id}/approve`);
    await admin.post(`/api/payroll/runs/${run.id}/finalise`);

    // Now cannot recompute
    const recompute = await admin.post(`/api/payroll/runs/${run.id}/compute`, {
      data: { employees: [emp({ employeeId: empId, ow: 9999, citizenStatus: 'SC', age: 30 })] },
    });
    expect(recompute.status(), 'compute FINALISED must 400').toBe(400);
    expect((await recompute.json()).error).toMatch(/DRAFT|PENDING_APPROVAL/i);
  } finally {
    await cancelRun(admin, run.id);
  }
  await admin.dispose();
});

// ─── 9. Employee can fetch their own published payslip ────────────────────────
test('SYSTEM: employee fetches their own published payslip via /payslips/me', async () => {
  const admin = await ctxAs('SUPER_ADMIN');
  // Use a real employee so /payslips/me's req.user.employeeId resolves to their ID
  const empList = await (await admin.get('/api/employees?limit=1&isActive=true')).json();
  const realEmp = (empList.employees || empList || [])[0];
  expect(realEmp, 'need at least one real employee').toBeTruthy();

  const period = uniquePeriod(8);
  const run = await (await admin.post('/api/payroll/runs', { data: { period, runType: 'MONTHLY' } })).json();
  try {
    await admin.post(`/api/payroll/runs/${run.id}/compute`, {
      data: { employees: [emp({ employeeId: realEmp.id, ow: 5500, citizenStatus: 'SC', age: 35 })] },
    });
    await admin.post(`/api/payroll/runs/${run.id}/approve`);
    await admin.post(`/api/payroll/runs/${run.id}/finalise`);

    // Forge an EMPLOYEE JWT with the real employee's id
    const token = signJwt({ ...TEST_USERS.EMPLOYEE, employeeId: realEmp.id }, 'EMPLOYEE');
    const empCtx = await request.newContext({
      baseURL: API_BASE,
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    });
    const mine = await empCtx.get('/api/payroll/payslips/me');
    expect(mine.ok(), 'employee fetches own payslips').toBe(true);
    const body = await mine.json();
    const ours = body.payslips.find((p: any) => p.period === period);
    expect(ours, 'should see our test payslip').toBeTruthy();
    expect(ours.grossPay, 'gross matches what we computed').toBe(5500);
    expect(ours.employeeCpf, 'CPF matches SC 20%').toBe(1100);
    await empCtx.dispose();
  } finally {
    await cancelRun(admin, run.id);
  }
  await admin.dispose();
});

// ─── 9b. EA s.20 — pro-ration by working days [EA-SECT-20] ────────────────────
// MOM EA s.20 + MOM Salary Calculator: incomplete-month salary =
//   monthlySalary × (days worked / total working days in the month)
// Working days = days the employee would normally have worked. The five-day-
// workweek convention used here is one of the conventions MOM permits.
//
// Calendar rotation: see calendarVariedPeriod() — year rotates per CI run so
// the formula gets exercised against many different (year, month) calendars.

test('[EA-SECT-20] mid-month STARTER — salary pro-rated by (worked / total) working days', async () => {
  const admin = await ctxAs('SUPER_ADMIN');
  // March slot (month 2) — 31-day month, varied starting weekday across CI runs
  const period = calendarVariedPeriod(2);
  const empId = `e2e-prostart-${Date.now()}`;
  const joinDate = `${period}-12`;  // mid-month join

  const monthly = 5000;
  const totalWd = totalWorkingDaysInPeriod(period);
  const workedWd = workingDaysBetween(joinDate, lastDayOfPeriod(period));
  const expectedSalary = proRatedSalary(monthly, workedWd, totalWd);
  const ctx = `[period=${period} totalWd=${totalWd} workedWd=${workedWd} (re-run with E2E_PAYROLL_SEED=${process.env.E2E_PAYROLL_SEED ?? Math.floor(Date.now() / 86_400_000)})]`;

  const run = await (await admin.post('/api/payroll/runs', { data: { period, runType: 'MONTHLY' } })).json();
  try {
    await admin.post(`/api/payroll/runs/${run.id}/compute`, {
      data: { employees: [emp({
        employeeId: empId, ow: monthly,
        citizenStatus: 'SC', age: 35,
        startDate: joinDate,
      })] },
    });
    const slip = await getPayslip(admin, run.id, empId);

    expect(slip.basicSalary, `${ctx} [EA-SECT-20] pro-rated basic = ${monthly} × ${workedWd}/${totalWd}`).toBeCloseTo(expectedSalary, 2);
    expect(slip.grossPay, `${ctx} [EA-SECT-20] gross also pro-rated by working days`).toBeCloseTo(expectedSalary, 2);
    expect(slip.basicSalary, `${ctx} [EA-SECT-20] sanity: pro-rated < full monthly`).toBeLessThan(monthly);
    // CPF Board: CPF base = pro-rated OW (the pro-ration applies before CPF)
    expect(slip.employeeCpf, `${ctx} [CPF-RATES-2026] CPF on pro-rated OW @ 20%`).toBeCloseTo(expectedSalary * 0.20, 0);
  } finally {
    await cancelRun(admin, run.id);
  }
  await admin.dispose();
});

test('[EA-SECT-20] mid-month LEAVER — pro-rated to working days before exit', async () => {
  const admin = await ctxAs('SUPER_ADMIN');
  // February slot (month 1) — 28/29-day edge case; leap-year aware via the period rotation
  const period = calendarVariedPeriod(1);
  const empId = `e2e-proleave-${Date.now()}`;
  const exitDate = `${period}-15`;  // mid-month exit

  const monthly = 5000;
  const totalWd = totalWorkingDaysInPeriod(period);
  const workedWd = workingDaysBetween(`${period}-01`, exitDate);
  const expectedSalary = proRatedSalary(monthly, workedWd, totalWd);
  const ctx = `[period=${period} totalWd=${totalWd} workedWd=${workedWd}]`;

  const run = await (await admin.post('/api/payroll/runs', { data: { period, runType: 'MONTHLY' } })).json();
  try {
    await admin.post(`/api/payroll/runs/${run.id}/compute`, {
      data: { employees: [emp({
        employeeId: empId, ow: monthly,
        citizenStatus: 'SC', age: 35,
        startDate: '2020-01-01',  // started long before period
        endDate: exitDate,
      })] },
    });
    const slip = await getPayslip(admin, run.id, empId);
    expect(slip.basicSalary, `${ctx} [EA-SECT-20] pro-rated basic = ${monthly} × ${workedWd}/${totalWd}`).toBeCloseTo(expectedSalary, 2);
    expect(slip.grossPay, `${ctx} [EA-SECT-20] gross pro-rated`).toBeCloseTo(expectedSalary, 2);
    expect(slip.basicSalary, `${ctx} [EA-SECT-20] sanity: < full monthly`).toBeLessThan(monthly);
  } finally {
    await cancelRun(admin, run.id);
  }
  await admin.dispose();
});

test('[EA-SECT-20] same-period joiner AND leaver — short stint pro-rated to worked window', async () => {
  // This also covers the "very short tenure" edge case and serves as a building block
  // for the working-type-change scenario tested below.
  const admin = await ctxAs('SUPER_ADMIN');
  // June slot (month 5) — 30-day mid-year month
  const period = calendarVariedPeriod(5);
  const empId = `e2e-proshort-${Date.now()}`;
  const startDate = `${period}-10`;
  const endDate   = `${period}-20`;

  const monthly = 5000;
  const totalWd = totalWorkingDaysInPeriod(period);
  const workedWd = workingDaysBetween(startDate, endDate);
  const expectedSalary = proRatedSalary(monthly, workedWd, totalWd);
  const ctx = `[period=${period} totalWd=${totalWd} workedWd=${workedWd}]`;

  const run = await (await admin.post('/api/payroll/runs', { data: { period, runType: 'MONTHLY' } })).json();
  try {
    await admin.post(`/api/payroll/runs/${run.id}/compute`, {
      data: { employees: [emp({
        employeeId: empId, ow: monthly,
        citizenStatus: 'SC', age: 35,
        startDate, endDate,
      })] },
    });
    const slip = await getPayslip(admin, run.id, empId);
    expect(slip.basicSalary, `${ctx} [EA-SECT-20] ${workedWd}-day stint of ${totalWd}-day month`).toBeCloseTo(expectedSalary, 2);
    expect(slip.grossPay, `${ctx} [EA-SECT-20] gross pro-rated to short stint`).toBeCloseTo(expectedSalary, 2);
  } finally {
    await cancelRun(admin, run.id);
  }
  await admin.dispose();
});

test('[EA-SECT-20] WORKING-TYPE CHANGE mid-period (FT → PT) — terminate + rehire, each half pro-rated', async () => {
  // System pattern: HR ends the full-time record on day 14, starts a new part-time
  // record on day 15. Both records flow through the SAME payroll run, and each
  // is pro-rated independently against the period's working-day calendar.
  // This is the canonical way to handle employment-type transitions mid-month.
  const admin = await ctxAs('SUPER_ADMIN');
  // November slot (month 10) — 30 days, often spans 5 weeks depending on start day
  const period = calendarVariedPeriod(10);
  const empIdFT = `e2e-ft-${Date.now()}`;       // full-time half
  const empIdPT = `e2e-pt-${Date.now()}`;       // part-time half
  const transitionDayFT = 14;                    // last day of FT
  const transitionDayPT = 15;                    // first day of PT
  const ftEnd   = `${period}-${String(transitionDayFT).padStart(2, '0')}`;
  const ptStart = `${period}-${String(transitionDayPT).padStart(2, '0')}`;

  const ftMonthly = 5000;
  const ptMonthly = 2500;  // half rate after switching to part-time
  const totalWd   = totalWorkingDaysInPeriod(period);
  const ftWorked  = workingDaysBetween(`${period}-01`, ftEnd);
  const ptWorked  = workingDaysBetween(ptStart, lastDayOfPeriod(period));
  const expectedFt = proRatedSalary(ftMonthly, ftWorked, totalWd);
  const expectedPt = proRatedSalary(ptMonthly, ptWorked, totalWd);

  const run = await (await admin.post('/api/payroll/runs', { data: { period, runType: 'MONTHLY' } })).json();
  try {
    await admin.post(`/api/payroll/runs/${run.id}/compute`, {
      data: {
        employees: [
          // FT half — pro-rated by working days from period start to FT exit
          emp({ employeeId: empIdFT, ow: ftMonthly, citizenStatus: 'SC', age: 35,
                startDate: '2020-01-01', endDate: ftEnd }),
          // PT half — pro-rated by working days from PT start to period end
          emp({ employeeId: empIdPT, ow: ptMonthly, citizenStatus: 'SC', age: 35,
                startDate: ptStart }),
        ],
      },
    });
    const slips = (await (await admin.get(`/api/payroll/runs/${run.id}/payslips`)).json()).payslips;
    const ft = slips.find((s: any) => s.employeeId === empIdFT);
    const pt = slips.find((s: any) => s.employeeId === empIdPT);

    const ctx = `[period=${period} totalWd=${totalWd} ftWorked=${ftWorked} ptWorked=${ptWorked}]`;
    expect(ft.basicSalary, `${ctx} [EA-SECT-20] FT half pro-rated: ${ftMonthly} × ${ftWorked}/${totalWd}`).toBeCloseTo(expectedFt, 2);
    expect(pt.basicSalary, `${ctx} [EA-SECT-20] PT half pro-rated: ${ptMonthly} × ${ptWorked}/${totalWd}`).toBeCloseTo(expectedPt, 2);

    // Sanity (test design check, not statutory): the two halves shouldn't overlap.
    expect(ftWorked + ptWorked, `${ctx} test setup: FT days + PT days = total working days (no overlap)`).toBe(totalWd);
  } finally {
    await cancelRun(admin, run.id);
  }
  await admin.dispose();
});

// ─── 9c. EA s.38 — Overtime via paycode [EA-SECT-38] ──────────────────────────
// EA s.38(1) hourly basic rate formula:
//   hourly = (12 × monthly basic) / (52 × normal weekly hours)
// then OT pay = hourly × multiplier × OT hours.
// EA caps "normal weekly hours" at 44. CPF Board: OT pay is wages (OW) and
// is CPF-able under [CPF-WAGES-DEF].
//
// Tests verify: (a) the OT amount entered as a paycode flows into the OW base,
// (b) CPF is computed on combined basic + OT, (c) the OW ceiling still applies.

async function findComponent(admin: APIRequestContext, code: string): Promise<{ id: string }> {
  const resp = await admin.get('/api/payroll/components');
  expect(resp.ok(), 'fetch pay components').toBe(true);
  const comps: any[] = await resp.json();
  const c = comps.find(x => x.code === code);
  expect(c, `pay component ${code} should be seeded`).toBeTruthy();
  return c;
}

// Replicates shared/payroll-utils computeOtPay locally so the test stays self-contained
function eaOtPay(monthlyBasic: number, weeklyHours: number, otHours: number, multiplier = 1.5): number {
  const hourlyRate = (monthlyBasic * 12) / 52 / weeklyHours;
  return Math.round(hourlyRate * multiplier * otHours * 100) / 100;
}

test('[EA-SECT-38] OT paycode is wages — flows into OW base, gross, and CPF', async () => {
  const admin = await ctxAs('SUPER_ADMIN');
  const period = uniquePeriod(27);
  const empId = `e2e-ot-${Date.now()}`;

  // EA s.38: 10 hours of weekday OT @ 1.5×, monthly basic $5,000, 44 weekly hours
  const monthlyBasic = 5000;
  const weeklyHours  = 44;
  const otHours      = 10;
  const otAmount     = eaOtPay(monthlyBasic, weeklyHours, otHours, 1.5);
  // ≈ (60000 / 52 / 44) × 1.5 × 10 ≈ $393.36

  const otComponent = await findComponent(admin, 'OT_PAY');
  const run = await (await admin.post('/api/payroll/runs', { data: { period, runType: 'MONTHLY' } })).json();
  try {
    // Step 1 — add OT paycode (must precede compute so the line item exists when compute runs)
    const addPaycode = await admin.post(`/api/payroll/runs/${run.id}/paycodes`, {
      data: {
        employeeId: empId,
        componentId: otComponent.id,
        description: `Weekday OT × ${otHours} hr @ 1.5×`,
        amount: otAmount,
      },
    });
    expect(addPaycode.status(), 'add OT paycode').toBeLessThan(400);

    // Step 2 — compute
    await admin.post(`/api/payroll/runs/${run.id}/compute`, {
      data: { employees: [emp({ employeeId: empId, ow: monthlyBasic, citizenStatus: 'SC', age: 35 })] },
    });

    // Step 3 — assertions
    const slip = await getPayslip(admin, run.id, empId);
    const expectedOw = monthlyBasic + otAmount;

    expect(slip.basicSalary, '[EA-SECT-38] effective OW = basic + OT paycode').toBeCloseTo(expectedOw, 2);
    expect(slip.grossPay,    '[CPF-WAGES-DEF] gross includes OT (it is wages)').toBeCloseTo(expectedOw, 2);
    // CPF Board: OT pay is OW, subject to CPF; combined OW here is under SGD 8,000 (Jan 2026) ceiling
    expect(slip.employeeCpf, '[CPF-RATES-2026] employee CPF 20% × (basic + OT)').toBeCloseTo(Math.round(expectedOw * 0.20), 0);
    expect(slip.employerCpf, '[CPF-RATES-2026] employer CPF 17% × (basic + OT)').toBeCloseTo(Math.round(expectedOw * 0.17), 0);
  } finally {
    await cancelRun(admin, run.id);
  }
  await admin.dispose();
});

test('[EA-SECT-38] OT + basic above Jan 2026 SGD 8,000 ceiling → CPF capped at the ceiling', async () => {
  const admin = await ctxAs('SUPER_ADMIN');
  const period = uniquePeriod(28);
  const empId = `e2e-ot-cap-${Date.now()}`;

  // Senior salary $7,500 + OT $1,000 = effective OW $8,500 → over the Jan 2026 SGD 8,000 ceiling
  const basic   = 7500;
  const otAmt   = 1000;
  const otComp  = await findComponent(admin, 'OT_PAY');
  const run = await (await admin.post('/api/payroll/runs', { data: { period, runType: 'MONTHLY' } })).json();
  try {
    await admin.post(`/api/payroll/runs/${run.id}/paycodes`, {
      data: { employeeId: empId, componentId: otComp.id, description: 'Weekday OT', amount: otAmt },
    });
    await admin.post(`/api/payroll/runs/${run.id}/compute`, {
      data: { employees: [emp({ employeeId: empId, ow: basic, citizenStatus: 'SC', age: 35 })] },
    });
    const slip = await getPayslip(admin, run.id, empId);

    expect(slip.basicSalary, '[EA-SECT-38] effective OW = basic + OT (pre-ceiling)').toBeCloseTo(basic + otAmt, 2);
    expect(slip.grossPay, '[CPF-WAGES-DEF] gross unchanged by CPF ceiling').toBeCloseTo(basic + otAmt, 2);
    // Jan 2026 ceiling: 8000 × 20% = 1600 ; 8000 × 17% = 1360 — the extra $500 escapes CPF
    expect(slip.employeeCpf, '[CPF-RATES-2026] OW capped at SGD 8,000: 20% × 8000 = 1600').toBe(1600);
    expect(slip.employerCpf, '[CPF-RATES-2026] OW capped at SGD 8,000: 17% × 8000 = 1360').toBe(1360);
    expect(slip.netPay, '[CPF-WAGES-DEF] net = full gross − employee CPF only').toBeCloseTo(basic + otAmt - 1600, 2);
  } finally {
    await cancelRun(admin, run.id);
  }
  await admin.dispose();
});

// ─── 9d. OIL cash-out — POTENTIAL COMPLIANCE FINDING [CPF-WAGES-DEF] ──────────
// Per CPF Board, "wages" = all remuneration in money under contract of service.
// When unused Off-In-Lieu (OIL) is CASHED OUT to an employee, the cash payment
// is remuneration for prior work → it IS subject to CPF as Ordinary Wages.
//
// Compliance question this test answers:
//   Does the system treat OIL cash-out as CPF-able OW?
//
// Current system state (2026-05-22): scripts/seed.js seeds the `OIL` pay
// component with isCpfApplicable=FALSE — meaning OIL paycodes do NOT enter the
// CPF base. If OIL is truly used for cash-out (not just for tracking accrued
// time off), this would be a CPF under-contribution.
//
// Test outcome interpretation:
//   - Test PASSES: OIL cash-out is being treated as CPF-able. Good.
//   - Test FAILS:  Compliance gap — either (a) re-seed OIL with isCpfApplicable=
//                  true OR (b) document in TESTING.md §11 that OIL is used only
//                  for non-monetary leave tracking, and use a different pay
//                  component for cash-out scenarios.

test('[CPF-WAGES-DEF] OIL cash-out is wages → subject to CPF as OW (compliance check)', async () => {
  const admin = await ctxAs('SUPER_ADMIN');
  const period = uniquePeriod(29);
  const empId = `e2e-oil-${Date.now()}`;

  const basic  = 5000;
  const oilAmt = 100;  // assumed to be a CASH PAYMENT for accrued OIL hours
  const oilComp = await findComponent(admin, 'OIL');

  const run = await (await admin.post('/api/payroll/runs', { data: { period, runType: 'MONTHLY' } })).json();
  try {
    await admin.post(`/api/payroll/runs/${run.id}/paycodes`, {
      data: { employeeId: empId, componentId: oilComp.id, description: 'OIL cash-out', amount: oilAmt },
    });
    await admin.post(`/api/payroll/runs/${run.id}/compute`, {
      data: { employees: [emp({ employeeId: empId, ow: basic, citizenStatus: 'SC', age: 35 })] },
    });
    const slip = await getPayslip(admin, run.id, empId);

    // Expected per CPF Board (statutory): OIL cash payment is wages, in OW.
    // The CPF base should be basic + OIL = $5,100.
    const expectedOw = basic + oilAmt;
    expect(slip.basicSalary, '[CPF-WAGES-DEF] effective OW includes OIL cash payment').toBe(expectedOw);
    expect(slip.grossPay, '[CPF-WAGES-DEF] gross includes OIL (cash remuneration)').toBe(expectedOw);
    expect(slip.employeeCpf, '[CPF-RATES-2026] employee CPF 20% × (basic + OIL)').toBe(expectedOw * 0.20);
    expect(slip.employerCpf, '[CPF-RATES-2026] employer CPF 17% × (basic + OIL)').toBe(expectedOw * 0.17);
    expect(slip.netPay, '[CPF-WAGES-DEF] net = gross − employee CPF on full OW').toBeCloseTo(expectedOw - expectedOw * 0.20, 2);
  } finally {
    await cancelRun(admin, run.id);
  }
  await admin.dispose();
});

// ─── 9e. DEDUCTION — reduces net only [CPF-WAGES-DEF] [IRAS-EMP-INCOME] ───────
// CPF Board: deductions for loans / advance recovery / garnishments do NOT
// reduce the CPF-able OW base.
// IRAS: salary advance repayments via deduction do NOT reduce taxable income
// — the original salary was already taxable when earned.
// Net effect: gross + CPF base unchanged; net pay reduced by the deduction.

test('[CPF-WAGES-DEF] DEDUCTION (staff loan) reduces net only — gross + CPF base unchanged', async () => {
  const admin = await ctxAs('SUPER_ADMIN');
  const period = uniquePeriod(30);
  const empId = `e2e-loan-${Date.now()}`;

  const basic    = 5000;
  const loanAmt  = 200;  // monthly staff loan repayment
  const loanComp = await findComponent(admin, 'STAFF_LOAN');
  expect((loanComp as any).wageType, 'STAFF_LOAN must be wageType=DEDUCTION').toBe('DEDUCTION');

  const run = await (await admin.post('/api/payroll/runs', { data: { period, runType: 'MONTHLY' } })).json();
  try {
    await admin.post(`/api/payroll/runs/${run.id}/paycodes`, {
      data: { employeeId: empId, componentId: loanComp.id, description: 'Staff loan #2', amount: loanAmt },
    });
    await admin.post(`/api/payroll/runs/${run.id}/compute`, {
      data: { employees: [emp({ employeeId: empId, ow: basic, citizenStatus: 'SC', age: 35 })] },
    });
    const slip = await getPayslip(admin, run.id, empId);

    expect(slip.basicSalary, '[CPF-WAGES-DEF] OW unchanged by deduction').toBe(basic);
    expect(slip.grossPay, '[IRAS-EMP-INCOME] gross unchanged — deduction is not an income reduction').toBe(basic);
    expect(slip.employeeCpf, '[CPF-WAGES-DEF] CPF on full OW — loan doesn\'t reduce base').toBe(basic * 0.20);
    expect(slip.employerCpf, '[CPF-RATES-2026] employer CPF on full OW').toBe(basic * 0.17);
    expect(slip.netPay, 'net = gross − employee CPF − loan repayment').toBeCloseTo(basic - basic * 0.20 - loanAmt, 2);
  } finally {
    await cancelRun(admin, run.id);
  }
  await admin.dispose();
});

test('SYSTEM: DEDUCTION absolute-value safeguard — negative input still deducts (not statutory)', async () => {
  // NOTE: This is a SYSTEM SAFETY test, not a statutory requirement.
  // The compute loop uses `Math.abs(amt)` for DEDUCTIONs so a sign-flipped
  // data entry (e.g. payroll officer enters −200 by mistake) still deducts
  // $200 instead of paying the employee. Listed here for completeness;
  // failure indicates a UX safety regression, not a compliance violation.
  const admin = await ctxAs('SUPER_ADMIN');
  const period = uniquePeriod(31);
  const empId = `e2e-negded-${Date.now()}`;
  const basic = 4000;
  const loanComp = await findComponent(admin, 'STAFF_LOAN');

  const run = await (await admin.post('/api/payroll/runs', { data: { period, runType: 'MONTHLY' } })).json();
  try {
    // Deliberately enter the amount as NEGATIVE
    await admin.post(`/api/payroll/runs/${run.id}/paycodes`, {
      data: { employeeId: empId, componentId: loanComp.id, description: 'Loan (data entry quirk)', amount: -150 },
    });
    await admin.post(`/api/payroll/runs/${run.id}/compute`, {
      data: { employees: [emp({ employeeId: empId, ow: basic, citizenStatus: 'SC', age: 30 })] },
    });
    const slip = await getPayslip(admin, run.id, empId);

    // System safeguard: Math.abs(-150) = 150 → net reduced by $150 regardless of sign
    expect(slip.netPay, 'SYSTEM safeguard: Math.abs(-150) deducts $150, not adds').toBeCloseTo(basic - basic * 0.20 - 150, 2);
  } finally {
    await cancelRun(admin, run.id);
  }
  await admin.dispose();
});

// ─── 9f. REIMBURSEMENT — adds to net only [IRAS-EMP-INCOME] [CPF-WAGES-DEF] ───
// IRAS e-Tax Guide on Employment Income: reimbursements for legitimate business
// expenses are NOT taxable income — the employee is being made whole for a
// company expense paid from their pocket.
// CPF Board: such reimbursements are NOT wages → not CPF-able.

test('[IRAS-EMP-INCOME] REIMBURSEMENT (medical) is not income — net pay only, no gross or CPF impact', async () => {
  const admin = await ctxAs('SUPER_ADMIN');
  const period = uniquePeriod(32);
  const empId = `e2e-reimb-${Date.now()}`;

  const basic     = 5000;
  const reimbAmt  = 150;  // approved medical claim reimbursed via payroll
  const reimbComp = await findComponent(admin, 'MED_REIMB');
  expect((reimbComp as any).wageType, 'MED_REIMB must be wageType=REIMBURSEMENT').toBe('REIMBURSEMENT');
  expect((reimbComp as any).isCpfApplicable, 'reimbursements are not CPF-applicable').toBe(false);

  const run = await (await admin.post('/api/payroll/runs', { data: { period, runType: 'MONTHLY' } })).json();
  try {
    await admin.post(`/api/payroll/runs/${run.id}/paycodes`, {
      data: { employeeId: empId, componentId: reimbComp.id, description: 'GP visit reimbursement', amount: reimbAmt },
    });
    await admin.post(`/api/payroll/runs/${run.id}/compute`, {
      data: { employees: [emp({ employeeId: empId, ow: basic, citizenStatus: 'SC', age: 35 })] },
    });
    const slip = await getPayslip(admin, run.id, empId);

    expect(slip.basicSalary, '[CPF-WAGES-DEF] OW unchanged by reimbursement (not wages)').toBe(basic);
    expect(slip.grossPay, '[IRAS-EMP-INCOME] gross unchanged — reimbursement is not taxable income').toBe(basic);
    expect(slip.employeeCpf, '[CPF-WAGES-DEF] CPF unaffected by reimbursement').toBe(basic * 0.20);
    expect(slip.employerCpf, '[CPF-RATES-2026] employer CPF unaffected by reimbursement').toBe(basic * 0.17);
    expect(slip.netPay, 'net = gross − CPF + reimbursement (employee made whole)').toBeCloseTo(basic - basic * 0.20 + reimbAmt, 2);
  } finally {
    await cancelRun(admin, run.id);
  }
  await admin.dispose();
});

test('[COMPOSITE] OT + DEDUCTION + REIMBURSEMENT in one payslip — statutory rules compose cleanly', async () => {
  // Realistic payroll month combining three statutory rules:
  //   [CPF-WAGES-DEF] OT is wages → enters OW & CPF base
  //   [CPF-WAGES-DEF] loan deduction does NOT reduce OW or CPF base
  //   [IRAS-EMP-INCOME] reimbursement is NOT income → no gross/CPF impact
  // The composite test pins that they don't interfere with each other.
  const admin = await ctxAs('SUPER_ADMIN');
  const period = uniquePeriod(33);
  const empId = `e2e-mixed-${Date.now()}`;
  const basic   = 4000;
  const otAmt   = 200;   // weekday OT cash-out
  const loanAmt = 250;   // monthly loan repayment
  const medAmt  = 80;    // GP visit reimbursement

  const otComp    = await findComponent(admin, 'OT_PAY');
  const loanComp  = await findComponent(admin, 'STAFF_LOAN');
  const medComp   = await findComponent(admin, 'MED_REIMB');

  const run = await (await admin.post('/api/payroll/runs', { data: { period, runType: 'MONTHLY' } })).json();
  try {
    for (const [comp, amount, desc] of [
      [otComp,   otAmt,   'OT (mixed test)'],
      [loanComp, loanAmt, 'Loan (mixed test)'],
      [medComp,  medAmt,  'GP reimb (mixed test)'],
    ] as const) {
      await admin.post(`/api/payroll/runs/${run.id}/paycodes`, {
        data: { employeeId: empId, componentId: (comp as any).id, description: desc, amount },
      });
    }
    await admin.post(`/api/payroll/runs/${run.id}/compute`, {
      data: { employees: [emp({ employeeId: empId, ow: basic, citizenStatus: 'SC', age: 30 })] },
    });
    const slip = await getPayslip(admin, run.id, empId);

    // OT folds into OW; loan + reimb stay separate
    const expectedOw    = basic + otAmt;            // 4200
    const expectedGross = expectedOw;               // gross = OW (no AW, no non-CPF additions in this test)
    const expectedEmpCpf  = Math.round(expectedOw * 0.20);  // 840
    const expectedEmplrCpf = Math.round(expectedOw * 0.17); // 714
    const expectedNet     = expectedGross - expectedEmpCpf - loanAmt + medAmt;  // 4200 − 840 − 250 + 80 = 3190

    expect(slip.basicSalary, '[EA-SECT-38][CPF-WAGES-DEF] OW = basic + OT').toBeCloseTo(expectedOw, 2);
    expect(slip.grossPay, '[CPF-WAGES-DEF][IRAS-EMP-INCOME] gross = basic + OT (loan/reimb excluded)').toBeCloseTo(expectedGross, 2);
    expect(slip.employeeCpf, '[CPF-RATES-2026] CPF on OW only').toBe(expectedEmpCpf);
    expect(slip.employerCpf, '[CPF-RATES-2026] employer CPF on OW only').toBe(expectedEmplrCpf);
    expect(slip.netPay, 'net = gross − employee CPF − loan + reimbursement').toBeCloseTo(expectedNet, 2);
  } finally {
    await cancelRun(admin, run.id);
  }
  await admin.dispose();
});

// ─── 10. RBAC — segregation of duties for payroll-sensitive data ──────────────
test('SYSTEM RBAC: EMPLOYEE cannot create a run; RECRUITER cannot finalise', async () => {
  // EMPLOYEE attempts to create a run
  const empCtx = await ctxAs('EMPLOYEE');
  const create = await empCtx.post('/api/payroll/runs', {
    data: { period: uniquePeriod(9), runType: 'MONTHLY' },
  });
  expect(create.status(), 'EMPLOYEE create payroll run must 403').toBe(403);
  await empCtx.dispose();

  // For finalise probe: admin sets up a finalisable run, RECRUITER tries to finalise
  const admin = await ctxAs('SUPER_ADMIN');
  const period = uniquePeriod(10);
  const empId = `e2e-rbac-${Date.now()}`;
  const run = await (await admin.post('/api/payroll/runs', { data: { period, runType: 'MONTHLY' } })).json();
  try {
    await admin.post(`/api/payroll/runs/${run.id}/compute`, {
      data: { employees: [emp({ employeeId: empId, ow: 3000, citizenStatus: 'SC', age: 30 })] },
    });
    await admin.post(`/api/payroll/runs/${run.id}/approve`);

    const rec = await ctxAs('RECRUITER');
    const finRec = await rec.post(`/api/payroll/runs/${run.id}/finalise`);
    expect(finRec.status(), 'RECRUITER finalise must 403').toBe(403);
    await rec.dispose();
  } finally {
    await cancelRun(admin, run.id);
  }
  await admin.dispose();
});
