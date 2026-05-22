/**
 * T1 Claims module happy path + RBAC probes.
 *
 * Covers the submit → approve / reject reimbursement lifecycle:
 *   1. Employee submits a claim against a seeded category
 *   2. Employee sees only their own claims in GET /claims
 *   3. SUBMITTED claim can be amended; approved claim cannot
 *   4. Finance/HR Admin approves → status APPROVED, approvedAt populated
 *   5. Re-approving an APPROVED claim is rejected (400 status guard)
 *   6. Category maxAmount enforcement (MEAL category has SGD 200 cap)
 *   7. Claims report endpoint groups by employee for payroll integration
 *
 * RBAC probes:
 *   - EMPLOYEE cannot approve a claim → 403
 *   - RECRUITER (no claims:approve perm) cannot approve → 403
 *
 * API-level: the UI is a thin shell over these endpoints, and the lifecycle
 * spans multiple roles which is cheaper to exercise through forged JWTs.
 */

import { test, expect, request, APIRequestContext } from '@playwright/test';
import { TEST_USERS } from '../lib/testUsers';
import { signJwt } from '../lib/jwt';
import { Role } from '../lib/roles';

const API_BASE = process.env.E2E_API_URL ?? 'http://localhost:4000';

async function ctxAs(role: Role, employeeId?: string): Promise<APIRequestContext> {
  const user = employeeId ? { ...TEST_USERS[role], employeeId } : TEST_USERS[role];
  const token = signJwt(user, role);
  return request.newContext({
    baseURL: API_BASE,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
}

async function fetchRealEmployee(admin: APIRequestContext): Promise<{ id: string }> {
  const resp = await admin.get('/api/employees?limit=1&isActive=true');
  expect(resp.ok(), 'employee list').toBe(true);
  const body = await resp.json();
  const emp = (body.employees || body || [])[0];
  expect(emp, 'need at least one active employee in DB').toBeTruthy();
  return emp;
}

async function fetchCategory(admin: APIRequestContext, code: string) {
  const resp = await admin.get('/api/claims/categories');
  expect(resp.ok(), 'categories list').toBe(true);
  const cats: any[] = await resp.json();
  const cat = cats.find(c => c.code === code);
  expect(cat, `category ${code} should be seeded`).toBeTruthy();
  return cat;
}

test('claims: employee submits → finance approves → status & timestamps update', async () => {
  const admin = await ctxAs('SUPER_ADMIN');
  const emp = await fetchRealEmployee(admin);
  const transport = await fetchCategory(admin, 'TRANSPORT');

  // 1. Employee submits a claim
  const empCtx = await ctxAs('EMPLOYEE', emp.id);
  const submitResp = await empCtx.post('/api/claims', {
    data: {
      categoryId: transport.id,
      title: `E2E Taxi ${Date.now()}`,
      description: 'Client visit to Tuas',
      claimDate: '2026-05-15',
      totalAmount: 38.50,
      gstAmount: 2.78,
    },
  });
  expect(submitResp.status(), 'submit claim').toBeLessThan(400);
  const claim = await submitResp.json();
  expect(claim.status, 'starts as SUBMITTED').toBe('SUBMITTED');
  expect(claim.submittedAt, 'submittedAt should be set').toBeTruthy();
  expect(claim.employeeId, 'employeeId from JWT').toBe(emp.id);

  // 2. Employee sees their own claim in GET /claims
  const list = await empCtx.get('/api/claims');
  expect(list.ok()).toBe(true);
  const listBody = await list.json();
  const seen = listBody.claims.find((c: any) => c.id === claim.id);
  expect(seen, 'employee should see their own claim').toBeTruthy();

  // 3. Amend the claim before approval
  const amend = await empCtx.patch(`/api/claims/${claim.id}`, {
    data: { description: 'Client visit to Tuas + Jurong' },
  });
  expect(amend.ok(), 'amend SUBMITTED claim').toBe(true);
  expect((await amend.json()).description).toContain('Jurong');

  // 4. Finance Admin approves
  const finance = await ctxAs('FINANCE_ADMIN');
  const approve = await finance.put(`/api/claims/${claim.id}/approve`, {
    data: { payrollPeriod: '2026-06' },
  });
  expect(approve.ok(), 'finance approves').toBe(true);
  const approved = await approve.json();
  expect(approved.status, 'after approve → APPROVED').toBe('APPROVED');
  expect(approved.approvedAt, 'approvedAt should be set').toBeTruthy();
  expect(approved.payrollPeriod, 'payroll period recorded').toBe('2026-06');

  // 5. Cannot re-approve an APPROVED claim (status guard)
  const reApprove = await finance.put(`/api/claims/${claim.id}/approve`, { data: {} });
  expect(reApprove.status(), 'second approve must 400').toBe(400);

  // 6. Cannot amend an APPROVED claim
  const lateAmend = await empCtx.patch(`/api/claims/${claim.id}`, {
    data: { description: 'too late' },
  });
  expect(lateAmend.status(), 'amend after approve must 400').toBe(400);

  await empCtx.dispose();
  await finance.dispose();
  await admin.dispose();
});

test('claims: category maxAmount is enforced (MEAL ≤ SGD 200)', async () => {
  const admin = await ctxAs('SUPER_ADMIN');
  const emp = await fetchRealEmployee(admin);
  const meal = await fetchCategory(admin, 'MEAL');
  expect(meal.maxAmount, 'MEAL category should have a cap').toBeTruthy();

  const empCtx = await ctxAs('EMPLOYEE', emp.id);
  const overLimit = await empCtx.post('/api/claims', {
    data: {
      categoryId: meal.id,
      title: 'Lavish dinner',
      claimDate: '2026-05-15',
      totalAmount: meal.maxAmount + 50,
    },
  });
  expect(overLimit.status(), 'over-limit claim must 400').toBe(400);
  expect((await overLimit.json()).error).toMatch(/exceeds category limit/i);

  // Under-limit is fine
  const ok = await empCtx.post('/api/claims', {
    data: {
      categoryId: meal.id,
      title: `E2E Meal ${Date.now()}`,
      claimDate: '2026-05-15',
      totalAmount: meal.maxAmount - 1,
    },
  });
  expect(ok.status(), 'under-limit claim accepted').toBeLessThan(400);

  await empCtx.dispose();
  await admin.dispose();
});

test('claims: reject moves status to REJECTED with reason', async () => {
  const admin = await ctxAs('SUPER_ADMIN');
  const emp = await fetchRealEmployee(admin);
  const cat = await fetchCategory(admin, 'OTHER');

  const empCtx = await ctxAs('EMPLOYEE', emp.id);
  const claim = await (await empCtx.post('/api/claims', {
    data: {
      categoryId: cat.id,
      title: `E2E Reject ${Date.now()}`,
      claimDate: '2026-05-15',
      totalAmount: 10,
    },
  })).json();

  const finance = await ctxAs('FINANCE_ADMIN');
  const reject = await finance.put(`/api/claims/${claim.id}/reject`, {
    data: { reason: 'Receipt unreadable' },
  });
  expect(reject.ok(), 'reject claim').toBe(true);
  const rejected = await reject.json();
  expect(rejected.status, 'status → REJECTED').toBe('REJECTED');
  expect(rejected.rejectedReason, 'reason recorded').toBe('Receipt unreadable');

  await empCtx.dispose();
  await finance.dispose();
  await admin.dispose();
});

test('claims: payroll report groups approved claims by employee', async () => {
  const admin = await ctxAs('SUPER_ADMIN');
  const emp = await fetchRealEmployee(admin);
  const cat = await fetchCategory(admin, 'TRANSPORT');
  const period = `E2E-${Date.now()}`;

  // Submit + approve two claims for the same employee in the same payroll period
  const empCtx = await ctxAs('EMPLOYEE', emp.id);
  const c1 = await (await empCtx.post('/api/claims', {
    data: { categoryId: cat.id, title: 'Trip 1', claimDate: '2026-05-10', totalAmount: 15 },
  })).json();
  const c2 = await (await empCtx.post('/api/claims', {
    data: { categoryId: cat.id, title: 'Trip 2', claimDate: '2026-05-12', totalAmount: 25 },
  })).json();

  const finance = await ctxAs('FINANCE_ADMIN');
  await finance.put(`/api/claims/${c1.id}/approve`, { data: { payrollPeriod: period } });
  await finance.put(`/api/claims/${c2.id}/approve`, { data: { payrollPeriod: period } });

  const reportResp = await finance.get(`/api/claims/report?period=${encodeURIComponent(period)}`);
  expect(reportResp.ok(), 'report fetch').toBe(true);
  const report = await reportResp.json();
  expect(report.period).toBe(period);
  const empSummary = report.employeeSummaries.find((s: any) => s.employeeId === emp.id);
  expect(empSummary, 'employee should appear in report').toBeTruthy();
  expect(empSummary.totalReimbursement, 'reimbursement = 15 + 25').toBe(40);
  expect(empSummary.claims.length, 'two claims aggregated').toBe(2);

  await empCtx.dispose();
  await finance.dispose();
  await admin.dispose();
});

test('claims: EMPLOYEE cannot approve a claim (RBAC 403)', async () => {
  const admin = await ctxAs('SUPER_ADMIN');
  const emp = await fetchRealEmployee(admin);
  const cat = await fetchCategory(admin, 'OTHER');

  const empCtx = await ctxAs('EMPLOYEE', emp.id);
  const claim = await (await empCtx.post('/api/claims', {
    data: { categoryId: cat.id, title: `E2E RBAC ${Date.now()}`, claimDate: '2026-05-15', totalAmount: 5 },
  })).json();

  // Same employee tries to approve their own claim
  const selfApprove = await empCtx.put(`/api/claims/${claim.id}/approve`, { data: {} });
  expect(selfApprove.status(), 'employee self-approve must 403').toBe(403);

  // A RECRUITER also has no claims:approve perm
  const recruiterCtx = await ctxAs('RECRUITER');
  const recruiterApprove = await recruiterCtx.put(`/api/claims/${claim.id}/approve`, { data: {} });
  expect(recruiterApprove.status(), 'recruiter approve must 403').toBe(403);

  await empCtx.dispose();
  await recruiterCtx.dispose();
  await admin.dispose();
});
