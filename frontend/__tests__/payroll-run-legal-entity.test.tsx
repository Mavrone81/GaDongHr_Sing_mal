/**
 * A1 — POST /payroll/runs requires `legalEntityId` since ENT-001
 * (services/payroll-service/src/routes/payroll.routes.js:173), but the admin
 * UI's run-creation path never sends one (usePayrollAdmin.ts `actuallyCreateRun`,
 * ~l.424 — PRIOR-STATE, confirmed by FullStack in reviews/section-fullstack.md).
 * There is no entity-selector concept anywhere in the payroll admin UI at all.
 *
 * This drives the real hook directly, not the e2e `primaryLegalEntityId` helper
 * (e2e/tests/helpers/legal-entity.ts) — that helper resolves and supplies the
 * field itself, which is exactly what lets the e2e suite pass against the
 * broken UI and mask this bug (the helper's own comment says as much).
 *
 * The mock server below mirrors the real route's own contract — the identical
 * guard and error text at payroll.routes.js:173 — so an omission in the UI
 * surfaces as the real 400, not an assertion about the request shape.
 */
import { renderHook, act } from '@testing-library/react';
import { usePayrollAdmin } from '@/app/(dashboard)/payroll/usePayrollAdmin';

const ENTITY_REQUIRED_ERROR = 'legalEntityId is required to create a payroll run';

jest.mock('@/lib/api', () => ({
  apiFetch: jest.fn((path: string, opts?: any) => {
    if (path === '/payroll/runs' && opts?.method === 'POST') {
      const body = JSON.parse(opts.body);
      // Mirrors services/payroll-service/src/routes/payroll.routes.js:173 exactly.
      if (!body.legalEntityId) return Promise.reject(new Error(ENTITY_REQUIRED_ERROR));
      return Promise.resolve({ id: 'run-new', period: body.period, runType: body.runType, legalEntityId: body.legalEntityId, status: 'DRAFT' });
    }
    if (path.startsWith('/payroll/runs?')) return Promise.resolve({ runs: [] });
    if (path.startsWith('/payroll/iras-submissions')) return Promise.resolve({ submissions: [] });
    if (path === '/payroll/drc-status') return Promise.resolve({ results: [] });
    if (path === '/tenants/me/entities') {
      return Promise.resolve([{ id: 'ent-1', name: 'GadongHR Pte Ltd', code: 'SG-01', country: 'SG', currency: 'SGD', isPrimary: true, isActive: true }]);
    }
    return Promise.resolve({});
  }),
  apiFetchRaw: jest.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })),
}));

describe('A1) payroll run creation sends legalEntityId', () => {
  test('a run created after choosing a legal entity is actually created, not rejected with the ENT-001 400', async () => {
    const { result } = renderHook(() => usePayrollAdmin());

    // A user picking a legal entity in the (to-be-added) selector. Optional
    // chaining so this line does not itself throw pre-fix, when the setter does
    // not exist yet — the assertions below are what must fail in that case.
    act(() => {
      (result.current as any).setSelectedLegalEntityId?.('ent-1');
    });

    await act(async () => {
      await result.current.actuallyCreateRun();
    });

    // Pre-fix: actuallyCreateRun never includes legalEntityId in the POST body
    // regardless of what was selected, so the mock (= the real route's
    // contract) rejects every time and this is exactly what fails.
    expect(result.current.actionToast).not.toBe(ENTITY_REQUIRED_ERROR);
    expect(result.current.reviewRunData).not.toBeNull();
    expect(result.current.reviewRunData?.id).toBe('run-new');
  });
});
