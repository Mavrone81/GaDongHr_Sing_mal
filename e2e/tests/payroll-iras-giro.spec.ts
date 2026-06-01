/**
 * T3 PAY — IR8A AIS flat-file + GIRO bank-file format coverage.
 *
 * Extends the existing payroll.spec.ts which already pins CPF e-Submit. These
 * tests assert the structural contracts of the two remaining mandatory
 * file formats:
 *
 *   IR8A   — IRAS AIS pipe-delimited flat file
 *            Header: IR8A|<year>|<UEN>
 *            Detail: NRIC|Name|Income|EmpCPF|ErlCPF|AW|BIK|ESOP
 *            (see payroll.routes.js:1831-1890)
 *
 *   GIRO   — bank-specific fixed-width or CSV per supported bank
 *            UOB  : 615-char fixed-width per row, first row = batch header
 *            DBS  : 114-char fixed-width per row
 *            OCBC : 1000-char fixed-width per row
 *            SCB / HSBC / MAYBANK : generic CSV (flagged
 *              X-Bank-Format-Status: GENERIC response header)
 *            (see payroll.routes.js:1103-1187 + giro engines)
 *
 * Strategy: spin a real run (DRAFT → compute → approve → finalise) so the
 * file generators have actual payslip + line-item rows to render. Use a
 * unique YYYY-MM in 2080 so the year-window IR8A lookup is deterministic and
 * doesn't collide with live data.
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

// Year reserved for these tests so the IR8A year-window pulls only our run.
// 2080 is far enough out to not collide with real data and far enough from
// payroll.spec.ts's 2099 slot to avoid cross-spec interference.
function uniquePeriod(slot: number): string {
  const month = String((slot % 12) + 1).padStart(2, '0');
  return `2080-${month}`;
}

function emp(input: { employeeId: string; ow: number; age?: number }) {
  return {
    employeeCode: input.employeeId.slice(0, 12),
    fullName: `IR8A/GIRO Test ${input.employeeId.slice(0, 6)}`,
    grossPay: input.ow,
    ow: input.ow,
    aw: 0,
    citizenStatus: 'SC' as const,
    age: input.age ?? 35,
    ytdOw: 0, ytdAw: 0, ytdGross: 0, ytdEmployeeCpf: 0, ytdEmployerCpf: 0,
    weeklyHours: 44,
    bankCode: '7171', bankAccount: '0000000000',
    employeeId: input.employeeId,
    startDate: null, endDate: null,
  };
}

async function cancelRun(admin: APIRequestContext, runId: string) {
  await admin.post(`/api/payroll/runs/${runId}/cancel`).catch(() => {});
}

async function makeFinalisedRun(admin: APIRequestContext, period: string, employees: any[]): Promise<string> {
  const create = await admin.post('/api/payroll/runs', { data: { period, runType: 'MONTHLY' } });
  expect(create.status(), await create.text()).toBe(201);
  const run = await create.json();

  const compute = await admin.post(`/api/payroll/runs/${run.id}/compute`, { data: { employees } });
  expect(compute.ok(), 'compute').toBe(true);

  const approve = await admin.post(`/api/payroll/runs/${run.id}/approve`);
  expect(approve.ok(), 'approve').toBe(true);

  const finalise = await admin.post(`/api/payroll/runs/${run.id}/finalise`);
  expect(finalise.ok(), 'finalise').toBe(true);

  return run.id;
}

// ── IR8A flat file ─────────────────────────────────────────────────────────

test('IR8A: header "IR8A|<year>|<UEN>" + pipe-delimited detail rows', async () => {
  const admin = await ctxAs('SUPER_ADMIN');
  const period = uniquePeriod(0);
  const year = period.split('-')[0];
  const empId = `e2e-ir8a-${Date.now()}`;

  const runId = await makeFinalisedRun(admin, period, [emp({ employeeId: empId, ow: 5000 })]);
  try {
    const res = await admin.get(`/api/payroll/ir8a-file/${year}`);
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.text();
    const lines = body.split('\n').filter(l => l.length > 0);

    // Header
    expect(lines[0], 'header line').toMatch(/^IR8A\|\d{4}\|[A-Z0-9]+$/);
    const [tag, hdrYear] = lines[0].split('|');
    expect(tag).toBe('IR8A');
    expect(hdrYear).toBe(year);

    // At least one detail line for our run's employee
    const detailLines = lines.slice(1);
    expect(detailLines.length).toBeGreaterThan(0);
    // Each detail row has 8 pipe-delimited fields: NRIC|Name|Income|EmpCPF|ErlCPF|AW|BIK|ESOP
    for (const line of detailLines) {
      expect(line.split('|').length, `detail row "${line}" must have 8 fields`).toBe(8);
    }
  } finally {
    await cancelRun(admin, runId);
  }
  await admin.dispose();
});

test('IR8A: 403 for non-payroll role (EMPLOYEE)', async () => {
  const employee = await ctxAs('EMPLOYEE');
  const res = await employee.get('/api/payroll/ir8a-file/2080');
  expect(res.status()).toBe(403);
  await employee.dispose();
});

// ── GIRO ───────────────────────────────────────────────────────────────────

test('GIRO UOB: fixed-width 615-char rows, FINALISED run only', async () => {
  const admin = await ctxAs('SUPER_ADMIN');
  const period = uniquePeriod(1);
  const empId = `e2e-uob-${Date.now()}`;

  const runId = await makeFinalisedRun(admin, period, [emp({ employeeId: empId, ow: 5000 })]);
  try {
    const res = await admin.get(`/api/payroll/bank-giro/${runId}?bank=uob`);
    expect(res.status(), await res.text()).toBe(200);
    expect(res.headers()['content-disposition']).toMatch(/^attachment; filename=UGBI/);
    const body = await res.text();
    // UOB spec: 615 bytes per record, CRLF line endings. Strip the trailing
    // CR before measuring.
    const lines = body.split(/\r?\n/).map(l => l.replace(/\r$/, '')).filter(l => l.length > 0);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.length, `UOB row width: "${line.slice(0, 40)}..."`).toBe(615);
    }
  } finally {
    await cancelRun(admin, runId);
  }
  await admin.dispose();
});

test('GIRO DBS: fixed-width 114-char rows', async () => {
  const admin = await ctxAs('SUPER_ADMIN');
  const period = uniquePeriod(2);
  const empId = `e2e-dbs-${Date.now()}`;

  const runId = await makeFinalisedRun(admin, period, [emp({ employeeId: empId, ow: 5000 })]);
  try {
    const res = await admin.get(`/api/payroll/bank-giro/${runId}?bank=dbs`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-disposition']).toMatch(/DBS-GIRO-/);
    const body = await res.text();
    const lines = body.split(/\r?\n/).map(l => l.replace(/\r$/, '')).filter(l => l.length > 0);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.length, `DBS row width: "${line.slice(0, 40)}..."`).toBe(114);
    }
  } finally {
    await cancelRun(admin, runId);
  }
  await admin.dispose();
});

test('GIRO generic CSV (SCB) flags X-Bank-Format-Status and has comma-delimited header', async () => {
  const admin = await ctxAs('SUPER_ADMIN');
  const period = uniquePeriod(3);
  const empId = `e2e-scb-${Date.now()}`;

  const runId = await makeFinalisedRun(admin, period, [emp({ employeeId: empId, ow: 5000 })]);
  try {
    const res = await admin.get(`/api/payroll/bank-giro/${runId}?bank=scb`);
    expect(res.status()).toBe(200);
    expect(res.headers()['x-bank-format-status'], 'generic CSV banner').toMatch(/GENERIC/i);
    expect(res.headers()['content-disposition']).toMatch(/SCB-GIRO-.*\.csv/);
    const body = await res.text();
    // Format header (PAYMENT_DATE,PAYEE_NAME,...) appears after the leading
    // `#` comment block — find the row that's actually a CSV header.
    const headerRow = body.split('\n').find(l => l.includes('PAYMENT_DATE') && l.includes(','));
    expect(headerRow, 'should contain a CSV PAYMENT_DATE header row').toBeTruthy();
    expect(headerRow!.split(',').length).toBeGreaterThanOrEqual(5);
  } finally {
    await cancelRun(admin, runId);
  }
  await admin.dispose();
});

test('GIRO unsupported bank → 400', async () => {
  const admin = await ctxAs('SUPER_ADMIN');
  const period = uniquePeriod(4);
  const empId = `e2e-bad-${Date.now()}`;
  const runId = await makeFinalisedRun(admin, period, [emp({ employeeId: empId, ow: 5000 })]);
  try {
    const res = await admin.get(`/api/payroll/bank-giro/${runId}?bank=mockbank`);
    expect(res.status()).toBe(400);
  } finally {
    await cancelRun(admin, runId);
  }
  await admin.dispose();
});

test('GIRO non-FINALISED run → 400', async () => {
  const admin = await ctxAs('SUPER_ADMIN');
  const period = uniquePeriod(5);
  // Create a DRAFT — never advance it.
  const create = await admin.post('/api/payroll/runs', { data: { period, runType: 'MONTHLY' } });
  expect(create.status()).toBe(201);
  const run = await create.json();
  try {
    const res = await admin.get(`/api/payroll/bank-giro/${run.id}?bank=uob`);
    expect(res.status()).toBe(400);
  } finally {
    await cancelRun(admin, run.id);
  }
  await admin.dispose();
});
