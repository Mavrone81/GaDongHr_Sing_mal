'use strict';
const {
  buildOfferLetterData,
  renderOfferLetterHtml,
  buildEsignVariables,
  DEFAULT_EXPIRY_DAYS,
} = require('../src/engines/offer-letter.engine');

const CANDIDATE = { firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' };
const JOB = { title: 'Software Engineer', department: 'Engineering' };

// ── buildOfferLetterData ──────────────────────────────────────────────────────
describe('buildOfferLetterData', () => {
  test('combines candidate name from first + last', () => {
    const d = buildOfferLetterData(CANDIDATE, JOB, {});
    expect(d.candidateName).toBe('Jane Doe');
    expect(d.candidateEmail).toBe('jane@example.com');
  });

  test('uses job title and department from job object', () => {
    const d = buildOfferLetterData(CANDIDATE, JOB, {});
    expect(d.jobTitle).toBe('Software Engineer');
    expect(d.department).toBe('Engineering');
  });

  test('options override job department when provided', () => {
    const d = buildOfferLetterData(CANDIDATE, JOB, { department: 'Product' });
    expect(d.department).toBe('Engineering'); // job takes precedence
  });

  test('falls back to options.jobTitle when no job object', () => {
    const d = buildOfferLetterData(CANDIDATE, null, { jobTitle: 'Analyst' });
    expect(d.jobTitle).toBe('Analyst');
  });

  test('expiresAt defaults to now + DEFAULT_EXPIRY_DAYS', () => {
    const before = new Date();
    const d = buildOfferLetterData(CANDIDATE, JOB, {});
    const after  = new Date();
    const expectedMin = new Date(before); expectedMin.setDate(expectedMin.getDate() + DEFAULT_EXPIRY_DAYS - 1);
    const expectedMax = new Date(after);  expectedMax.setDate(expectedMax.getDate() + DEFAULT_EXPIRY_DAYS + 1);
    expect(d.expiresAt >= expectedMin).toBe(true);
    expect(d.expiresAt <= expectedMax).toBe(true);
  });

  test('custom expiryDays respected', () => {
    const d = buildOfferLetterData(CANDIDATE, JOB, { expiryDays: 14 });
    const diff = Math.round((d.expiresAt - d.issuedDate) / (1000 * 60 * 60 * 24));
    expect(diff).toBe(14);
  });

  test('probationMonths defaults to 3', () => {
    const d = buildOfferLetterData(CANDIDATE, JOB, {});
    expect(d.probationMonths).toBe(3);
  });

  test('offeredSalary null when not provided', () => {
    const d = buildOfferLetterData(CANDIDATE, JOB, {});
    expect(d.offeredSalary).toBeNull();
  });
});

// ── renderOfferLetterHtml ─────────────────────────────────────────────────────
describe('renderOfferLetterHtml', () => {
  test('includes candidate name', () => {
    const d = buildOfferLetterData(CANDIDATE, JOB, {});
    const html = renderOfferLetterHtml(d, 'GaDongHR');
    expect(html).toContain('Jane Doe');
  });

  test('includes job title', () => {
    const d = buildOfferLetterData(CANDIDATE, JOB, {});
    const html = renderOfferLetterHtml(d);
    expect(html).toContain('Software Engineer');
  });

  test('formats salary as SGD when provided', () => {
    const d = buildOfferLetterData(CANDIDATE, JOB, { offeredSalary: 5000 });
    const html = renderOfferLetterHtml(d);
    expect(html).toContain('SGD');
    expect(html).toContain('5,000');
  });

  test('shows "As discussed" when no salary', () => {
    const d = buildOfferLetterData(CANDIDATE, JOB, {});
    const html = renderOfferLetterHtml(d);
    expect(html).toContain('As discussed');
  });

  test('includes additional terms when provided', () => {
    const d = buildOfferLetterData(CANDIDATE, JOB, { additionalTerms: 'Remote work allowed' });
    const html = renderOfferLetterHtml(d);
    expect(html).toContain('Remote work allowed');
  });

  test('omits additional terms section when null', () => {
    const d = buildOfferLetterData(CANDIDATE, JOB, {});
    const html = renderOfferLetterHtml(d);
    expect(html).not.toContain('Additional Terms');
  });

  test('is a complete HTML document', () => {
    const d = buildOfferLetterData(CANDIDATE, JOB, {});
    const html = renderOfferLetterHtml(d);
    expect(html).toMatch(/<!DOCTYPE html>/);
    expect(html).toMatch(/<\/html>/);
  });
});

// ── buildEsignVariables ───────────────────────────────────────────────────────
describe('buildEsignVariables', () => {
  test('returns all required placeholder keys', () => {
    const d = buildOfferLetterData(CANDIDATE, JOB, { offeredSalary: 6000 });
    const vars = buildEsignVariables(d, 'Acme');
    expect(vars.CANDIDATE_NAME).toBe('Jane Doe');
    expect(vars.JOB_TITLE).toBe('Software Engineer');
    expect(vars.COMPANY_NAME).toBe('Acme');
    expect(vars.OFFERED_SALARY).toContain('6,000');
    expect(vars.PROBATION_MONTHS).toBe('3');
  });

  test('EXPIRY_DATE is a formatted string not a raw date', () => {
    const d = buildOfferLetterData(CANDIDATE, JOB, {});
    const vars = buildEsignVariables(d);
    expect(typeof vars.EXPIRY_DATE).toBe('string');
    expect(vars.EXPIRY_DATE).not.toMatch(/^\d{4}-\d{2}-\d{2}T/); // not ISO
  });
});
