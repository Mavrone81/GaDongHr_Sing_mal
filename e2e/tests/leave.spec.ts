/**
 * T1 Leave happy path: API-level test of the end-to-end flow we shipped today.
 *
 * Why API-level: the apply form requires entitlement state for a specific
 * employee; rather than seeding a calendar of entitlements, we exercise the
 * leave-service endpoints directly with a forged employee JWT. The UI
 * regression for the attachment viewer is covered by the smoke + manual
 * verification in /tmp/leave-verify/.
 */

import { test, expect, request } from '@playwright/test';
import { TEST_USERS } from '../lib/testUsers';
import { signJwt } from '../lib/jwt';
import * as fs from 'fs';
import * as path from 'path';

const API_BASE = process.env.E2E_API_URL ?? 'http://localhost:4000';

test('leave: apply with attachment → fetch detail → download attachment (admin path)', async () => {
  const adminToken = signJwt(TEST_USERS.SUPER_ADMIN, 'SUPER_ADMIN');
  const ctx = await request.newContext({
    baseURL: API_BASE,
    extraHTTPHeaders: { Authorization: `Bearer ${adminToken}` },
  });

  // 1. Find an NPL (no balance ceiling) leave type and a real employee
  const types = await ctx.get('/api/leave/types');
  expect(types.ok()).toBe(true);
  const typesData: any[] = await types.json();
  const npl = typesData.find(t => t.code === 'NPL' && t.isActive);
  expect(npl, 'NPL leave type should exist').toBeTruthy();

  const emps = await ctx.get('/api/employees?limit=1&isActive=true');
  expect(emps.ok()).toBe(true);
  const empBody = await emps.json();
  const targetEmp = (empBody.employees || empBody || [])[0];
  expect(targetEmp, 'should have at least one employee').toBeTruthy();

  // 2. Create a 1x1 PNG attachment on disk
  const tmpPng = path.join('/tmp', `e2e-leave-${Date.now()}.png`);
  fs.writeFileSync(tmpPng, Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108020000' +
    '0090775364de0000000c4944415478da636848000000030001eaae42' +
    '600082000000000049454e44ae426082',
    'hex'
  ));

  // 3. POST multipart with attachment
  const created = await ctx.post('/api/leave/applications', {
    multipart: {
      leaveTypeId: npl.id,
      startDate: '2026-09-01',
      endDate: '2026-09-02',
      reason: 'E2E test',
      employeeId: targetEmp.id,
      attachment: { name: 'e2e.png', mimeType: 'image/png', buffer: fs.readFileSync(tmpPng) },
    },
  });
  expect(created.status(), 'create application').toBeLessThan(400);
  const app = await created.json();
  expect(app.documentPath, 'documentPath should be populated').toBeTruthy();
  expect(app.attachment?.fileName).toBeTruthy();

  // 4. GET detail — verify employee enrichment + attachment metadata
  const detail = await ctx.get(`/api/leave/applications/${app.id}`);
  expect(detail.ok()).toBe(true);
  const detailBody = await detail.json();
  expect(detailBody.employee?.fullName, 'enrichment should populate employee.fullName').toBeTruthy();
  expect(detailBody.attachment?.downloadUrl).toBeTruthy();

  // 5. Download the attachment — verify byte integrity
  const dl = await ctx.get(`/api/leave/applications/${app.id}/attachment`);
  expect(dl.ok(), 'download').toBe(true);
  expect(dl.headers()['content-type']).toBe('image/png');
  const downloaded = await dl.body();
  const original = fs.readFileSync(tmpPng);
  expect(downloaded.equals(original), 'downloaded bytes should equal uploaded').toBe(true);

  fs.unlinkSync(tmpPng);
  await ctx.dispose();
});

test('leave: EMPLOYEE cannot download another employee’s attachment', async () => {
  // Setup: admin creates a leave for emp A
  const adminToken = signJwt(TEST_USERS.SUPER_ADMIN, 'SUPER_ADMIN');
  const adminCtx = await request.newContext({
    baseURL: API_BASE,
    extraHTTPHeaders: { Authorization: `Bearer ${adminToken}` },
  });
  const types: any[] = await (await adminCtx.get('/api/leave/types')).json();
  const npl = types.find(t => t.code === 'NPL');
  const empA = ((await (await adminCtx.get('/api/employees?limit=2')).json()).employees || [])[0];
  const created = await adminCtx.post('/api/leave/applications', {
    multipart: {
      leaveTypeId: npl.id,
      startDate: '2026-10-01', endDate: '2026-10-02',
      reason: 'cross-emp probe', employeeId: empA.id,
      attachment: { name: 'p.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a', 'hex') },
    },
  });
  const app = await created.json();
  await adminCtx.dispose();

  // Now: a foreign EMPLOYEE tries to download
  const empUser = TEST_USERS.EMPLOYEE;
  // Override the employeeId in the JWT to a non-matching id
  const empToken = signJwt({ ...empUser, employeeId: 'non-matching-emp-id' }, 'EMPLOYEE');
  const empCtx = await request.newContext({
    baseURL: API_BASE,
    extraHTTPHeaders: { Authorization: `Bearer ${empToken}` },
  });
  const res = await empCtx.get(`/api/leave/applications/${app.id}/attachment`);
  expect(res.status(), 'foreign employee should get 403').toBe(403);
  await empCtx.dispose();
});
