'use strict';
/**
 * The originating employer on a bank payment file is the CUSTOMER's registered
 * entity — per-company payroll data, not a product brand.
 *
 * It deliberately has no default. A fallback would stamp the wrong company onto
 * a real payment instruction that the bank acts on; the bank accepts it and the
 * customer finds out afterwards. Refusing to generate the file is the safer
 * failure.
 */
jest.mock('/app/shared/auth-middleware', () => ({
  authenticate: (_req, _res, next) => next(),
  authorize: () => (_req, _res, next) => next(),
  ROLES: { SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN', PAYROLL_OFFICER: 'PAYROLL_OFFICER' },
}), { virtual: true });
jest.mock('../src/utils/prisma', () => ({}), { virtual: true });

const { resolveGiroCompanyName } = require('../src/routes/payroll.routes');

describe('resolveGiroCompanyName', () => {
  const prev = process.env.COMPANY_NAME;
  afterEach(() => {
    if (prev === undefined) delete process.env.COMPANY_NAME;
    else process.env.COMPANY_NAME = prev;
  });

  test('uses the value supplied on the request', () => {
    expect(resolveGiroCompanyName('ACME PTE LTD')).toBe('ACME PTE LTD');
  });

  test('falls back to COMPANY_NAME for the deployment', () => {
    process.env.COMPANY_NAME = 'BETA HOLDINGS PTE LTD';
    expect(resolveGiroCompanyName(undefined)).toBe('BETA HOLDINGS PTE LTD');
  });

  test('a supplied value wins over the environment', () => {
    process.env.COMPANY_NAME = 'BETA HOLDINGS PTE LTD';
    expect(resolveGiroCompanyName('ACME PTE LTD')).toBe('ACME PTE LTD');
  });

  test('refuses when neither is set, rather than inventing a company', () => {
    delete process.env.COMPANY_NAME;
    expect(() => resolveGiroCompanyName(undefined)).toThrow(/companyName is required/);
  });

  test('treats whitespace as missing', () => {
    delete process.env.COMPANY_NAME;
    expect(() => resolveGiroCompanyName('   ')).toThrow(/companyName is required/);
  });

  test('the refusal is a 400, not a server error', () => {
    delete process.env.COMPANY_NAME;
    try { resolveGiroCompanyName(undefined); } catch (e) { expect(e.status).toBe(400); }
  });

  test('carries no product brand as a default', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'src', 'routes', 'payroll.routes.js'), 'utf8');
    expect(src).not.toMatch(/GADONGHR PTE LTD|VORKHIVE PTE LTD/);
  });
});
