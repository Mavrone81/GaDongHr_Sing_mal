'use strict';

/**
 * Which country's law computes an employee's pay.
 *
 * This is the seam the whole Malaysia localisation turns on: payroll-service
 * keeps the run lifecycle and picks an upstream by the legal entity's country,
 * never learning what CPF or EPF is. It had no test, and the failure modes here
 * are the quiet kind — routing a Malaysian entity to the Singapore service
 * would produce a complete, plausible, entirely wrong payslip.
 */

const {
  computeStatutoryBatch, findResult, sumByKind, StatutoryUnavailableError,
} = require('../src/utils/statutory-client');

const OK = (body) => ({ ok: true, status: 200, json: async () => body });

describe('the statutory upstream is chosen by entity country', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; delete process.env.STATUTORY_MY_SERVICE_URL; });

  beforeEach(() => { process.env.INTERNAL_SERVICE_KEY = 'test-key'; });

  it.each([
    ['SG', 'statutory-sg-service:4021'],
    ['MY', 'statutory-my-service:4022'],
  ])('routes a %s entity to %s', async (country, expectedHost) => {
    global.fetch = jest.fn().mockResolvedValue(OK({ results: [] }));

    await computeStatutoryBatch({
      country, period: '2026-03', entity: { country }, employees: [{ employeeId: 'e1' }],
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toContain(expectedHost);
  });

  it('never sends a MY entity to the SG service', async () => {
    global.fetch = jest.fn().mockResolvedValue(OK({ results: [] }));
    await computeStatutoryBatch({
      country: 'MY', period: '2026-03', entity: { country: 'MY' }, employees: [{ employeeId: 'e1' }],
    });
    expect(global.fetch.mock.calls[0][0]).not.toContain('statutory-sg-service');
  });

  it('passes the internal key, since there is no JWT path into these services', async () => {
    global.fetch = jest.fn().mockResolvedValue(OK({ results: [] }));
    await computeStatutoryBatch({
      country: 'MY', period: '2026-03', entity: { country: 'MY' }, employees: [{ employeeId: 'e1' }],
    });
    expect(global.fetch.mock.calls[0][1].headers['x-internal-service-key']).toBe('test-key');
  });

  /**
   * An unknown country must stop the run. Falling back to Singapore — the only
   * country implemented when this seam was written — is exactly the bug the
   * fail-closed design exists to prevent.
   */
  it('refuses an unconfigured country rather than defaulting to SG', async () => {
    global.fetch = jest.fn();
    await expect(computeStatutoryBatch({
      country: 'TH', period: '2026-03', entity: { country: 'TH' }, employees: [{ employeeId: 'e1' }],
    })).rejects.toThrow(/No statutory service configured for country TH/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('fails closed when the upstream is unreachable', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(computeStatutoryBatch({
      country: 'MY', period: '2026-03', entity: { country: 'MY' }, employees: [{ employeeId: 'e1' }],
    })).rejects.toBeInstanceOf(StatutoryUnavailableError);
  });

  /**
   * The MY service returns 503 until someone has reconciled its rate tables
   * against the KWSP/PERKESO/LHDN publications (PRD §A7.1). That must reach the
   * operator as a blocked run with the reason attached, not as a zeroed payslip.
   */
  it('surfaces the unverified-rate-table refusal instead of computing', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false, status: 503,
      text: async () => JSON.stringify({ error: 'MY-2026.1 has not been verified against its source' }),
    });
    await expect(computeStatutoryBatch({
      country: 'MY', period: '2026-03', entity: { country: 'MY' }, employees: [{ employeeId: 'e1' }],
    })).rejects.toThrow(/has not been verified against its source/);
  });

  it('honours an explicit STATUTORY_MY_SERVICE_URL override', async () => {
    process.env.STATUTORY_MY_SERVICE_URL = 'http://my-statutory.internal:9999';
    global.fetch = jest.fn().mockResolvedValue(OK({ results: [] }));
    await computeStatutoryBatch({
      country: 'MY', period: '2026-03', entity: { country: 'MY' }, employees: [{ employeeId: 'e1' }],
    });
    expect(global.fetch.mock.calls[0][0]).toContain('my-statutory.internal:9999');
  });
});

describe('results are matched per employee, never defaulted', () => {
  it('throws when an employee is missing from the batch response', () => {
    expect(() => findResult([{ employeeId: 'e1' }], 'e2'))
      .toThrow(/No statutory result for employee e2/);
  });

  it('sums a kind across its lines', () => {
    const r = {
      employeeDeductions: [
        { code: 'EPF_EE', amount: 550 },
        { code: 'SOCSO_EE', amount: 10 },
        { code: 'PCB', amount: 120.5 },
      ],
    };
    expect(sumByKind(r, 'employeeDeductions')).toBe(680.5);
  });

  it('sums an absent kind to zero without throwing', () => {
    expect(sumByKind({}, 'employerLevies')).toBe(0);
  });
});
