/**
 * Unit tests for supervisor chain approval logic extracted from leave.routes.js
 *
 * Tests cover:
 *   A) Admin bypass — SUPER_ADMIN/HR_ADMIN always allowed
 *   B) ANY_ONE flow — designated supervisor allowed, non-supervisor denied
 *   C) SEQUENTIAL flow — correct step allowed, wrong step denied
 *   D) No supervisor chain — non-admin denied
 *   E) Team calendar leave map — correctly maps leave ranges to calendar days
 */

// ── Types ──────────────────────────────────────────────────────────────────────

interface SupervisorCheck {
  isSupervisor: boolean;
  flowType: 'ANY_ONE' | 'SEQUENTIAL';
  supervisorOrder: number | null;
  totalSupervisors: number;
}

interface ApprovalContext {
  approverRole: string;
  approverEmpId: string | null;
  appStatus: string;
  currentApprovalStep: number;
  supervisorCheck: SupervisorCheck | null;
}

const ADMIN_ROLES = new Set(['SUPER_ADMIN', 'HR_ADMIN']);

type ApprovalResult =
  | { allowed: true; advance?: boolean; finalApprove: boolean }
  | { allowed: false; reason: string };

function canApprove(ctx: ApprovalContext): ApprovalResult {
  if (ctx.appStatus !== 'PENDING') return { allowed: false, reason: 'Only PENDING applications can be approved' };

  // Admins bypass everything
  if (ADMIN_ROLES.has(ctx.approverRole.toUpperCase())) {
    return { allowed: true, finalApprove: true };
  }

  const check = ctx.supervisorCheck;

  if (!check || check.totalSupervisors === 0) {
    return { allowed: false, reason: 'No supervisors configured for this employee. Contact HR Admin.' };
  }

  if (!check.isSupervisor) {
    return { allowed: false, reason: 'You are not a designated supervisor for this employee' };
  }

  if (check.flowType === 'SEQUENTIAL') {
    if (check.supervisorOrder !== ctx.currentApprovalStep) {
      return { allowed: false, reason: `Sequential approval required. Waiting for supervisor at step ${ctx.currentApprovalStep}.` };
    }
    const isLastStep = ctx.currentApprovalStep >= check.totalSupervisors;
    return { allowed: true, advance: !isLastStep, finalApprove: isLastStep };
  }

  // ANY_ONE
  return { allowed: true, finalApprove: true };
}

// ── Calendar leave map logic ───────────────────────────────────────────────────

interface LeaveRange { id: string; employeeId: string; startDate: string; endDate: string; }

function buildLeaveMap(leaves: LeaveRange[]): Record<string, LeaveRange[]> {
  const m: Record<string, LeaveRange[]> = {};
  leaves.forEach(lv => {
    const start = new Date(lv.startDate);
    const end = new Date(lv.endDate);
    for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const key = d.toISOString().slice(0, 10);
      if (!m[key]) m[key] = [];
      m[key].push(lv);
    }
  });
  return m;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('A) Admin bypass', () => {
  const baseCtx: Omit<ApprovalContext, 'approverRole'> = {
    approverEmpId: null, appStatus: 'PENDING', currentApprovalStep: 1, supervisorCheck: null,
  };

  ['SUPER_ADMIN', 'HR_ADMIN'].forEach(role => {
    test(`${role} always allowed regardless of supervisor config`, () => {
      const result = canApprove({ ...baseCtx, approverRole: role });
      expect(result.allowed).toBe(true);
      if (result.allowed) expect(result.finalApprove).toBe(true);
    });
  });

  test('Admin bypass works even when supervisorCheck is null', () => {
    const result = canApprove({ ...baseCtx, approverRole: 'HR_ADMIN', supervisorCheck: null });
    expect(result.allowed).toBe(true);
  });
});

describe('B) ANY_ONE flow', () => {
  const anyOneCheck: SupervisorCheck = { isSupervisor: true, flowType: 'ANY_ONE', supervisorOrder: 1, totalSupervisors: 2 };

  test('designated supervisor is allowed and finalApprove=true', () => {
    const result = canApprove({ approverRole: 'LINE_MANAGER', approverEmpId: 'emp-sup', appStatus: 'PENDING', currentApprovalStep: 1, supervisorCheck: anyOneCheck });
    expect(result.allowed).toBe(true);
    if (result.allowed) expect(result.finalApprove).toBe(true);
  });

  test('non-supervisor is denied', () => {
    const result = canApprove({ approverRole: 'LINE_MANAGER', approverEmpId: 'emp-other', appStatus: 'PENDING', currentApprovalStep: 1, supervisorCheck: { ...anyOneCheck, isSupervisor: false } });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toMatch(/not a designated supervisor/i);
  });
});

describe('C) SEQUENTIAL flow', () => {
  const seqCheck = (order: number, total: number): SupervisorCheck => ({
    isSupervisor: true, flowType: 'SEQUENTIAL', supervisorOrder: order, totalSupervisors: total,
  });

  test('correct step is allowed with advance=true when not last step', () => {
    const result = canApprove({ approverRole: 'LINE_MANAGER', approverEmpId: 'emp-sup-1', appStatus: 'PENDING', currentApprovalStep: 1, supervisorCheck: seqCheck(1, 2) });
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.advance).toBe(true);
      expect(result.finalApprove).toBe(false);
    }
  });

  test('wrong step is denied with sequential error', () => {
    const result = canApprove({ approverRole: 'LINE_MANAGER', approverEmpId: 'emp-sup-2', appStatus: 'PENDING', currentApprovalStep: 1, supervisorCheck: seqCheck(2, 2) });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toMatch(/sequential/i);
  });

  test('last step supervisor gets finalApprove=true and advance=false', () => {
    const result = canApprove({ approverRole: 'LINE_MANAGER', approverEmpId: 'emp-sup-2', appStatus: 'PENDING', currentApprovalStep: 2, supervisorCheck: seqCheck(2, 2) });
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.finalApprove).toBe(true);
      expect(result.advance).toBe(false);
    }
  });

  test('single supervisor sequential chain behaves like final step immediately', () => {
    const result = canApprove({ approverRole: 'LINE_MANAGER', approverEmpId: 'emp-sup', appStatus: 'PENDING', currentApprovalStep: 1, supervisorCheck: seqCheck(1, 1) });
    expect(result.allowed).toBe(true);
    if (result.allowed) expect(result.finalApprove).toBe(true);
  });
});

describe('D) No supervisor chain', () => {
  test('LINE_MANAGER is denied when totalSupervisors=0', () => {
    const result = canApprove({ approverRole: 'LINE_MANAGER', approverEmpId: 'emp-sup', appStatus: 'PENDING', currentApprovalStep: 1, supervisorCheck: { isSupervisor: false, flowType: 'ANY_ONE', supervisorOrder: null, totalSupervisors: 0 } });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toMatch(/No supervisors configured/i);
  });

  test('null supervisorCheck also denies non-admin', () => {
    const result = canApprove({ approverRole: 'LINE_MANAGER', approverEmpId: 'emp-sup', appStatus: 'PENDING', currentApprovalStep: 1, supervisorCheck: null });
    expect(result.allowed).toBe(false);
  });
});

describe('Common — non-PENDING', () => {
  test('already-approved application is denied', () => {
    const result = canApprove({ approverRole: 'HR_ADMIN', approverEmpId: null, appStatus: 'APPROVED', currentApprovalStep: 1, supervisorCheck: null });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toMatch(/PENDING/i);
  });
});

describe('E) Team calendar leave map', () => {
  const leaves: LeaveRange[] = [
    { id: 'lv-1', employeeId: 'emp-001', startDate: '2026-06-01', endDate: '2026-06-03' },
    { id: 'lv-2', employeeId: 'emp-002', startDate: '2026-06-02', endDate: '2026-06-02' },
  ];

  test('builds a map keyed by YYYY-MM-DD', () => {
    const map = buildLeaveMap(leaves);
    expect(map['2026-06-01']).toHaveLength(1);
    expect(map['2026-06-01'][0].id).toBe('lv-1');
  });

  test('multi-day leave appears on every day in range', () => {
    const map = buildLeaveMap(leaves);
    expect(map['2026-06-02']).toHaveLength(2); // both employees on 02
    expect(map['2026-06-03']).toHaveLength(1); // only lv-1 on 03
  });

  test('days outside any leave range are absent from map', () => {
    const map = buildLeaveMap(leaves);
    expect(map['2026-06-04']).toBeUndefined();
    expect(map['2026-05-31']).toBeUndefined();
  });

  test('empty leaves array produces empty map', () => {
    const map = buildLeaveMap([]);
    expect(Object.keys(map)).toHaveLength(0);
  });
});
