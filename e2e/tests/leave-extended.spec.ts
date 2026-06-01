/**
 * T3 LV-15, LV-17, LV-18 — leave application edge cases.
 *
 * LV-15  Working-days display vs backend totalDays
 *   The frontend renders "X working days" (excludes weekends and PHs); the
 *   backend stores `totalDays = ceil((end-start)/day)+1` (calendar days). These
 *   diverge for any range spanning a weekend — a documented divergence in
 *   TESTING.md §11. This test pins the backend's calendar-day contract so any
 *   change that aligns them is detected and reconciled with the frontend.
 *
 * LV-17  Attachment size limit
 *   multer caps fileSize at 10 MB (leave.routes.js:39). Anything larger should
 *   either be rejected (most permissive: response surfaces a size error) or
 *   accepted-then-truncated by the storage engine. We assert the upload does
 *   NOT silently land a >10MB file in the document store.
 *
 * LV-18  Attachment MIME / extension validation
 *   fileFilter whitelist: .pdf, .png, .jpg, .jpeg, .doc, .docx, .heic, .webp
 *   (leave.routes.js:40-43). Forbidden extensions (e.g. .exe, .sh, .js) must
 *   yield a created application WITHOUT a documentPath — multer silently drops
 *   the file. Whitelisted MIME types must round-trip successfully.
 */

import { test, expect, request, APIRequestContext } from '@playwright/test';
import { TEST_USERS } from '../lib/testUsers';
import { signJwt } from '../lib/jwt';

const API_BASE = process.env.E2E_API_URL ?? 'http://localhost:4000';

async function adminCtx(): Promise<APIRequestContext> {
  const token = signJwt(TEST_USERS.SUPER_ADMIN, 'SUPER_ADMIN');
  return request.newContext({
    baseURL: API_BASE,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
}

async function pickNplAndEmployee(ctx: APIRequestContext): Promise<{ nplId: string; employeeId: string }> {
  const types = await ctx.get('/api/leave/types');
  const typesData: any[] = await types.json();
  const npl = typesData.find(t => t.code === 'NPL' && t.isActive);
  expect(npl, 'NPL leave type must exist').toBeTruthy();

  const emps = await ctx.get('/api/employees?limit=1&isActive=true');
  const empBody = await emps.json();
  const targetEmp = (empBody.employees || empBody || [])[0];
  expect(targetEmp, 'must have at least one employee').toBeTruthy();
  return { nplId: npl.id, employeeId: targetEmp.id };
}

// Tiny 1×1 PNG.
const PNG_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108020000' +
  '0090775364de0000000c4944415478da636848000000030001eaae42' +
  '600082000000000049454e44ae426082',
  'hex',
);

// Use a far-future year + the next free month per test slot so concurrent runs
// don't trample each other.
let dateSlot = 0;
function nextRange(spanDays: number): { startDate: string; endDate: string } {
  dateSlot += spanDays + 7;
  const day = 1 + (dateSlot % 20);                // keep day in 1..20
  const month = 1 + Math.floor((dateSlot / 20) % 12);
  const yyyy = 2095 + Math.floor(dateSlot / 240);  // rolls every 12 months
  const mm = String(month).padStart(2, '0');
  const start = `${yyyy}-${mm}-${String(day).padStart(2, '0')}`;
  const end = `${yyyy}-${mm}-${String(day + spanDays).padStart(2, '0')}`;
  return { startDate: start, endDate: end };
}

// ── LV-15 ──────────────────────────────────────────────────────────────────

test.describe('LV-15 working-day display vs backend totalDays', () => {
  test('totalDays is calendar-day inclusive (weekends counted)', async () => {
    const ctx = await adminCtx();
    const { nplId, employeeId } = await pickNplAndEmployee(ctx);

    // A range that deliberately crosses a weekend so calendar-days and working
    // -days clearly differ. Use an explicit known weekend boundary: pick a
    // 7-day window (e.g. Mon..Sun → 7 calendar, 5 working).
    // 2095-01-03 is a Monday; +6 = Sunday → spans 1 weekend.
    const res = await ctx.post('/api/leave/applications', {
      multipart: {
        leaveTypeId: nplId,
        employeeId,
        startDate: '2095-01-03',
        endDate: '2095-01-09', // Mon..Sun
        reason: 'LV-15 calendar-day pinning',
      },
    });
    expect(res.status(), await res.text()).toBeLessThan(400);
    const app = await res.json();

    // Backend stores 7 calendar days. If a future change moves to working-days
    // this becomes 5 and the assertion fires — reconcile the frontend display
    // module at the same time (currently does its own working-day count).
    expect(app.totalDays).toBe(7);

    await ctx.dispose();
  });

  test('half-day flag overrides span to 0.5 regardless of dates', async () => {
    const ctx = await adminCtx();
    const { nplId, employeeId } = await pickNplAndEmployee(ctx);
    const range = nextRange(0); // single-day span
    const res = await ctx.post('/api/leave/applications', {
      multipart: {
        leaveTypeId: nplId, employeeId,
        startDate: range.startDate, endDate: range.startDate,
        isHalfDay: 'true', halfDaySlot: 'AM',
        reason: 'LV-15 half-day',
      },
    });
    expect(res.status()).toBeLessThan(400);
    const app = await res.json();
    expect(app.totalDays).toBe(0.5);
    await ctx.dispose();
  });

  test('end < start is rejected (prevents negative-day balance inflation)', async () => {
    const ctx = await adminCtx();
    const { nplId, employeeId } = await pickNplAndEmployee(ctx);
    const res = await ctx.post('/api/leave/applications', {
      multipart: {
        leaveTypeId: nplId, employeeId,
        startDate: '2095-03-10', endDate: '2095-03-05',
        reason: 'LV-15 inverted range',
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/endDate/i);
    await ctx.dispose();
  });
});

// ── LV-17 ──────────────────────────────────────────────────────────────────

test.describe('LV-17 attachment size cap (10 MB)', () => {
  test('11 MB upload is rejected / not persisted as documentPath', async () => {
    const ctx = await adminCtx();
    const { nplId, employeeId } = await pickNplAndEmployee(ctx);
    const range = nextRange(0);

    // 11 MB random buffer
    const big = Buffer.alloc(11 * 1024 * 1024, 0x42);

    const res = await ctx.post('/api/leave/applications', {
      multipart: {
        leaveTypeId: nplId, employeeId,
        startDate: range.startDate, endDate: range.startDate,
        reason: 'LV-17 oversize',
        attachment: { name: 'huge.pdf', mimeType: 'application/pdf', buffer: big },
      },
    });
    // multer with limits throws and bubbles to express → 500-ish. Accept any
    // non-2xx OR a 2xx where documentPath is null.
    if (res.status() < 400) {
      const body = await res.json();
      expect(
        body.documentPath,
        'oversized file must not be persisted alongside the application',
      ).toBeFalsy();
    } else {
      expect(res.status()).toBeGreaterThanOrEqual(400);
    }
    await ctx.dispose();
  });
});

// ── LV-18 ──────────────────────────────────────────────────────────────────

test.describe('LV-18 attachment MIME / extension whitelist', () => {
  test('disallowed extension (.exe) is silently dropped — no documentPath', async () => {
    const ctx = await adminCtx();
    const { nplId, employeeId } = await pickNplAndEmployee(ctx);
    const range = nextRange(0);

    const res = await ctx.post('/api/leave/applications', {
      multipart: {
        leaveTypeId: nplId, employeeId,
        startDate: range.startDate, endDate: range.startDate,
        reason: 'LV-18 exe drop',
        attachment: { name: 'evil.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ\x00\x00') },
      },
    });
    expect(res.status()).toBeLessThan(400);
    const app = await res.json();
    expect(app.documentPath, '.exe must not yield a documentPath').toBeFalsy();
    expect(app.attachment).toBeFalsy();
    await ctx.dispose();
  });

  test('allowed extension (.pdf) is accepted and downloadable', async () => {
    const ctx = await adminCtx();
    const { nplId, employeeId } = await pickNplAndEmployee(ctx);
    const range = nextRange(0);

    const pdfBytes = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(64, 0x20), Buffer.from('\n%%EOF')]);

    const res = await ctx.post('/api/leave/applications', {
      multipart: {
        leaveTypeId: nplId, employeeId,
        startDate: range.startDate, endDate: range.startDate,
        reason: 'LV-18 pdf accept',
        attachment: { name: 'good.pdf', mimeType: 'application/pdf', buffer: pdfBytes },
      },
    });
    expect(res.status()).toBeLessThan(400);
    const app = await res.json();
    expect(app.documentPath).toMatch(/\.pdf$/);

    const dl = await ctx.get(`/api/leave/applications/${app.id}/attachment`);
    expect(dl.ok()).toBe(true);
    expect(dl.headers()['content-type']).toMatch(/pdf/);
    await ctx.dispose();
  });

  test('allowed extension (.png) is accepted (image MIME branch)', async () => {
    const ctx = await adminCtx();
    const { nplId, employeeId } = await pickNplAndEmployee(ctx);
    const range = nextRange(0);

    const res = await ctx.post('/api/leave/applications', {
      multipart: {
        leaveTypeId: nplId, employeeId,
        startDate: range.startDate, endDate: range.startDate,
        reason: 'LV-18 png accept',
        attachment: { name: 'pic.png', mimeType: 'image/png', buffer: PNG_BYTES },
      },
    });
    expect(res.status()).toBeLessThan(400);
    const app = await res.json();
    expect(app.documentPath).toMatch(/\.png$/);
    await ctx.dispose();
  });
});
