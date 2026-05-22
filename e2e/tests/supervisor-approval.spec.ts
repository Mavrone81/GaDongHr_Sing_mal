/**
 * T1 Supervisor approval chain — leave approval routing across the
 * EmployeeSupervisor chain (ANY_ONE + SEQUENTIAL flows) plus the
 * /me/subordinates lookup that powers the team calendar.
 *
 * Covers:
 *   1. SEQUENTIAL: step-1 supervisor approves → app stays PENDING, currentApprovalStep advances
 *   2. SEQUENTIAL: step-2 supervisor approves → app becomes APPROVED
 *   3. SEQUENTIAL: step-2 supervisor tries first → 403 (out-of-order)
 *   4. ANY_ONE:    any designated supervisor approves immediately → APPROVED
 *   5. RBAC:       LINE_MANAGER who isn't a designated supervisor → 403
 *   6. Bypass:     HR_ADMIN approves without being in chain → APPROVED
 *   7. /me/subordinates returns the configured direct reports
 *
 * Uses 3 distinct real employees fetched at runtime. Each test re-PUTs the
 * supervisor list to a known state so order between tests doesn't matter.
 * Cleanup wipes the supervisor chain on the applicant at the end of each test.
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

interface Cast { applicant: any; sup1: any; sup2: any; outsider: any; }

async function castThreeEmployees(admin: APIRequestContext): Promise<Cast> {
  const resp = await admin.get('/api/employees?limit=10&isActive=true');
  expect(resp.ok(), 'employees list').toBe(true);
  const body = await resp.json();
  const emps: any[] = body.employees || body || [];
  // We need 4 distinct ids; the matrix needs at least 3, plus one outsider for the
  // non-supervisor RBAC probe. Skip if the DB doesn't have enough seeded employees.
  expect(emps.length, 'need ≥4 active employees seeded to exercise supervisor chain').toBeGreaterThanOrEqual(4);
  return { applicant: emps[0], sup1: emps[1], sup2: emps[2], outsider: emps[3] };
}

async function findNplLeaveType(admin: APIRequestContext) {
  const types: any[] = await (await admin.get('/api/leave/types')).json();
  const npl = types.find(t => t.code === 'NPL' && t.isActive);
  expect(npl, 'NPL leave type should exist (unlimited so no entitlement gate)').toBeTruthy();
  return npl;
}

async function setSupervisors(admin: APIRequestContext, applicantId: string, flowType: 'SEQUENTIAL' | 'ANY_ONE', sups: { id: string, order: number }[]) {
  const resp = await admin.put(`/api/employees/${applicantId}/supervisors`, {
    data: { flowType, supervisors: sups.map(s => ({ employeeId: s.id, order: s.order })) },
  });
  expect(resp.ok(), `set ${flowType} supervisors`).toBe(true);
}

async function clearSupervisors(admin: APIRequestContext, applicantId: string) {
  await admin.put(`/api/employees/${applicantId}/supervisors`, {
    data: { flowType: 'ANY_ONE', supervisors: [] },
  });
}

async function submitNplLeave(admin: APIRequestContext, applicantId: string, leaveTypeId: string, startOffset = 30): Promise<any> {
  // Use far-future dates with unique-ish offsets so each test gets its own application
  const start = new Date(Date.now() + startOffset * 86400000).toISOString().slice(0, 10);
  const end = new Date(Date.now() + (startOffset + 1) * 86400000).toISOString().slice(0, 10);
  const resp = await admin.post('/api/leave/applications', {
    multipart: {
      leaveTypeId,
      startDate: start,
      endDate: end,
      reason: 'E2E supervisor-chain',
      employeeId: applicantId,
    },
  });
  expect(resp.status(), 'create leave application').toBeLessThan(400);
  return resp.json();
}

test('supervisor: SEQUENTIAL chain — step-1 advances, step-2 finalises', async () => {
  const admin = await ctxAs('SUPER_ADMIN');
  const { applicant, sup1, sup2 } = await castThreeEmployees(admin);
  const npl = await findNplLeaveType(admin);

  await setSupervisors(admin, applicant.id, 'SEQUENTIAL', [
    { id: sup1.id, order: 1 },
    { id: sup2.id, order: 2 },
  ]);

  const app = await submitNplLeave(admin, applicant.id, npl.id, 31);

  // Step 1: sup1 approves → still PENDING, currentApprovalStep=2
  const sup1Ctx = await ctxAs('LINE_MANAGER', sup1.id);
  const step1 = await sup1Ctx.put(`/api/leave/applications/${app.id}/approve`, { data: {} });
  expect(step1.ok(), 'step-1 approval succeeds').toBe(true);
  const step1Body = await step1.json();
  expect(step1Body.status, 'still PENDING after step-1').toBe('PENDING');
  expect(step1Body.currentApprovalStep, 'advances to step-2').toBe(2);
  expect(step1Body.message, 'should report step-1 done').toMatch(/Step 1 approved/i);

  // Step 2: sup2 approves → APPROVED
  const sup2Ctx = await ctxAs('LINE_MANAGER', sup2.id);
  const step2 = await sup2Ctx.put(`/api/leave/applications/${app.id}/approve`, { data: {} });
  expect(step2.ok(), 'step-2 approval succeeds').toBe(true);
  const step2Body = await step2.json();
  expect(step2Body.status, 'APPROVED after final step').toBe('APPROVED');
  expect(step2Body.approvedAt, 'approvedAt set').toBeTruthy();

  await clearSupervisors(admin, applicant.id);
  await sup1Ctx.dispose();
  await sup2Ctx.dispose();
  await admin.dispose();
});

test('supervisor: SEQUENTIAL — step-2 supervisor approving first is rejected', async () => {
  const admin = await ctxAs('SUPER_ADMIN');
  const { applicant, sup1, sup2 } = await castThreeEmployees(admin);
  const npl = await findNplLeaveType(admin);

  await setSupervisors(admin, applicant.id, 'SEQUENTIAL', [
    { id: sup1.id, order: 1 },
    { id: sup2.id, order: 2 },
  ]);
  const app = await submitNplLeave(admin, applicant.id, npl.id, 35);

  const sup2Ctx = await ctxAs('LINE_MANAGER', sup2.id);
  const outOfOrder = await sup2Ctx.put(`/api/leave/applications/${app.id}/approve`, { data: {} });
  expect(outOfOrder.status(), 'out-of-order approval must 403').toBe(403);
  const errBody = await outOfOrder.json();
  expect(errBody.error, 'message should mention step waiting').toMatch(/step 1/i);

  await clearSupervisors(admin, applicant.id);
  await sup2Ctx.dispose();
  await admin.dispose();
});

test('supervisor: ANY_ONE flow — single supervisor approval immediately finalises', async () => {
  const admin = await ctxAs('SUPER_ADMIN');
  const { applicant, sup1, sup2 } = await castThreeEmployees(admin);
  const npl = await findNplLeaveType(admin);

  await setSupervisors(admin, applicant.id, 'ANY_ONE', [
    { id: sup1.id, order: 1 },
    { id: sup2.id, order: 2 },
  ]);
  const app = await submitNplLeave(admin, applicant.id, npl.id, 39);

  // Either supervisor can approve in ANY_ONE — pick sup2
  const sup2Ctx = await ctxAs('LINE_MANAGER', sup2.id);
  const approve = await sup2Ctx.put(`/api/leave/applications/${app.id}/approve`, { data: {} });
  expect(approve.ok(), 'ANY_ONE: any supervisor can approve').toBe(true);
  const body = await approve.json();
  expect(body.status, 'goes straight to APPROVED').toBe('APPROVED');
  expect(body.approvedAt, 'approvedAt set').toBeTruthy();

  await clearSupervisors(admin, applicant.id);
  await sup2Ctx.dispose();
  await admin.dispose();
});

test('supervisor: LINE_MANAGER who is not in the chain is denied (403)', async () => {
  const admin = await ctxAs('SUPER_ADMIN');
  const { applicant, sup1, outsider } = await castThreeEmployees(admin);
  const npl = await findNplLeaveType(admin);

  await setSupervisors(admin, applicant.id, 'ANY_ONE', [{ id: sup1.id, order: 1 }]);
  const app = await submitNplLeave(admin, applicant.id, npl.id, 43);

  const outsiderCtx = await ctxAs('LINE_MANAGER', outsider.id);
  const denied = await outsiderCtx.put(`/api/leave/applications/${app.id}/approve`, { data: {} });
  expect(denied.status(), 'non-designated LINE_MANAGER must be denied').toBe(403);
  expect((await denied.json()).error).toMatch(/not.*designated supervisor/i);

  await clearSupervisors(admin, applicant.id);
  await outsiderCtx.dispose();
  await admin.dispose();
});

test('supervisor: HR_ADMIN bypasses supervisor chain entirely', async () => {
  const admin = await ctxAs('SUPER_ADMIN');
  const { applicant, sup1, sup2 } = await castThreeEmployees(admin);
  const npl = await findNplLeaveType(admin);

  await setSupervisors(admin, applicant.id, 'SEQUENTIAL', [
    { id: sup1.id, order: 1 },
    { id: sup2.id, order: 2 },
  ]);
  const app = await submitNplLeave(admin, applicant.id, npl.id, 47);

  // HR_ADMIN approves directly even though it's a SEQUENTIAL chain expecting sup1 first
  const hrCtx = await ctxAs('HR_ADMIN');
  const approve = await hrCtx.put(`/api/leave/applications/${app.id}/approve`, { data: {} });
  expect(approve.ok(), 'HR_ADMIN bypass should succeed').toBe(true);
  expect((await approve.json()).status, 'goes straight to APPROVED').toBe('APPROVED');

  await clearSupervisors(admin, applicant.id);
  await hrCtx.dispose();
  await admin.dispose();
});

test('supervisor: /me/subordinates returns the configured direct reports', async () => {
  const admin = await ctxAs('SUPER_ADMIN');
  const { applicant, sup1 } = await castThreeEmployees(admin);

  await setSupervisors(admin, applicant.id, 'ANY_ONE', [{ id: sup1.id, order: 1 }]);

  // Forge a JWT for sup1 (using LINE_MANAGER role with their employeeId)
  const sup1Ctx = await ctxAs('LINE_MANAGER', sup1.id);
  const subsResp = await sup1Ctx.get('/api/employees/me/subordinates');
  expect(subsResp.ok(), 'fetch subordinates').toBe(true);
  const subs: any[] = await subsResp.json();
  expect(subs.find(s => s.id === applicant.id), 'sup1 should see applicant as subordinate').toBeTruthy();

  await clearSupervisors(admin, applicant.id);
  await sup1Ctx.dispose();
  await admin.dispose();
});
