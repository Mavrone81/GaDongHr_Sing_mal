'use strict';
/**
 * Unit tests for REC-002 fcf.engine.js — pure functions, no DB.
 */

const {
  DEFAULT_MCF_DAYS,
  EXEMPT_REASONS,
  evaluateFcfStatus,
  classifyCitizenship,
  buildNationalityBreakdown,
  buildReportRow,
  buildFcfReport,
  daysBetween,
} = require('../src/engines/fcf.engine');

const NOW = new Date('2026-05-25T00:00:00Z');
const daysAgo = (n) => { const d = new Date(NOW); d.setUTCDate(d.getUTCDate() - n); return d; };

describe('constants', () => {
  test('14-day MCF window', () => expect(DEFAULT_MCF_DAYS).toBe(14));
  test('exempt reasons whitelist', () => {
    expect(EXEMPT_REASONS).toEqual(['HIGH_SALARY', 'INTRA_CORPORATE', 'SHORTAGE_OCCUPATION', 'OTHER']);
  });
});

describe('daysBetween — UTC-day aligned', () => {
  test('forward', () => expect(daysBetween(new Date('2026-05-26'), new Date('2026-05-20'))).toBe(6));
  test('handles within-same-day', () => {
    expect(daysBetween(new Date('2026-05-26T23:59Z'), new Date('2026-05-26T00:00Z'))).toBe(0);
  });
});

describe('evaluateFcfStatus', () => {
  test('NOT_POSTED when no MCF posting recorded', () => {
    const r = evaluateFcfStatus({}, NOW);
    expect(r.status).toBe('NOT_POSTED');
    expect(r.blocksHire).toBe(true);
    expect(r.blocksShortlisting).toBe(true);
  });
  test('IN_PERIOD when posted < 14 days ago', () => {
    const r = evaluateFcfStatus({ mcfPostedAt: daysAgo(5) }, NOW);
    expect(r.status).toBe('IN_PERIOD');
    expect(r.daysSincePosting).toBe(5);
    expect(r.daysRemaining).toBe(9);
    expect(r.blocksHire).toBe(true);
  });
  test('COMPLIANT exactly at 14 days', () => {
    const r = evaluateFcfStatus({ mcfPostedAt: daysAgo(14) }, NOW);
    expect(r.status).toBe('COMPLIANT');
    expect(r.daysRemaining).toBe(0);
    expect(r.blocksHire).toBe(false);
  });
  test('COMPLIANT past 14 days', () => {
    const r = evaluateFcfStatus({ mcfPostedAt: daysAgo(30) }, NOW);
    expect(r.status).toBe('COMPLIANT');
    expect(r.daysSincePosting).toBe(30);
  });
  test('EXEMPT short-circuits posting check', () => {
    const r = evaluateFcfStatus({ fcfExempt: true, fcfExemptReason: 'HIGH_SALARY' }, NOW);
    expect(r.status).toBe('EXEMPT');
    expect(r.blocksHire).toBe(false);
    expect(r.exemptReason).toBe('HIGH_SALARY');
  });
});

describe('classifyCitizenship', () => {
  test('CITIZEN tags', () => {
    expect(classifyCitizenship('SC')).toBe('CITIZEN');
    expect(classifyCitizenship('Singaporean')).toBe('CITIZEN');
    expect(classifyCitizenship('CITIZEN')).toBe('CITIZEN');
  });
  test('PR tags', () => {
    expect(classifyCitizenship('PR')).toBe('PR');
    expect(classifyCitizenship('permanent_resident')).toBe('PR');
  });
  test('anything else is FOREIGNER', () => {
    expect(classifyCitizenship('Indian')).toBe('FOREIGNER');
    expect(classifyCitizenship('CN')).toBe('FOREIGNER');
  });
  test('null/empty → UNSPECIFIED', () => {
    expect(classifyCitizenship(null)).toBe('UNSPECIFIED');
    expect(classifyCitizenship('')).toBe('UNSPECIFIED');
  });
});

describe('buildNationalityBreakdown', () => {
  test('counts buckets + byNationality dict', () => {
    const out = buildNationalityBreakdown([
      { nationality: 'SC' },
      { nationality: 'SC' },
      { nationality: 'PR' },
      { nationality: 'Indian' },
      { nationality: 'Chinese' },
      { nationality: null },
    ]);
    expect(out.total).toBe(6);
    expect(out.citizens).toBe(2);
    expect(out.prs).toBe(1);
    expect(out.foreigners).toBe(2);
    expect(out.unspecified).toBe(1);
    expect(out.byNationality.SC).toBe(2);
    expect(out.byNationality.Indian).toBe(1);
  });
  test('honours explicit citizenStatus over nationality string', () => {
    const out = buildNationalityBreakdown([
      { nationality: 'Singaporean', citizenStatus: 'FOREIGNER' },
    ]);
    expect(out.foreigners).toBe(1);
    expect(out.citizens).toBe(0);
  });
});

describe('buildReportRow', () => {
  function job(over = {}) { return { id: 'j1', title: 'Eng', department: 'R&D', headcount: 2, mcfJobId: 'MCF-1', mcfPostedAt: daysAgo(20), mcfExpiredAt: daysAgo(6), ...over }; }
  function cand(over = {}) { return { id: 'c1', firstName: 'A', lastName: 'B', nationality: 'SC', stage: 'APPLIED', ...over }; }

  test('emits per-job audit row with status + counts', () => {
    const row = buildReportRow(job(), [
      cand({ stage: 'HIRED', isHired: true, nationality: 'Indian', hiringRationale: 'Best fit' }),
      cand({ id: 'c2', stage: 'INTERVIEW_1', nationality: 'SC' }),
      cand({ id: 'c3', stage: 'REJECTED', nationality: 'PR', rejectionReason: 'Below bar' }),
    ], NOW);
    expect(row.fcfStatus).toBe('COMPLIANT');
    expect(row.hiredCount).toBe(1);
    expect(row.shortlistedCount).toBe(2); // INTERVIEW_1 + HIRED
    expect(row.rejectedCount).toBe(1);
    expect(row.daysAdvertised).toBe(20);
    expect(row.hiringDecisions[0].hiringRationale).toBe('Best fit');
    expect(row.rejectionAudit[0].rejectionReason).toBe('Below bar');
  });
});

describe('buildFcfReport — summary', () => {
  test('aggregates totals + byStatus + violation count', () => {
    const j1 = { id: 'j1', title: 'A', department: 'D', headcount: 1, mcfPostedAt: new Date('2026-05-01') };
    const j2 = { id: 'j2', title: 'B', department: 'D', headcount: 1 }; // NOT_POSTED
    const j3 = { id: 'j3', title: 'C', department: 'D', headcount: 1, fcfExempt: true, fcfExemptReason: 'HIGH_SALARY' };
    const report = buildFcfReport(
      [j1, j2, j3],
      { j1: [{ stage: 'HIRED', isHired: true, nationality: 'SC' }], j2: [{ stage: 'HIRED', isHired: true, nationality: 'Indian' }] },
      NOW,
    );
    expect(report.summary.totalJobs).toBe(3);
    expect(report.summary.totalHired).toBe(2);
    expect(report.summary.byStatus.COMPLIANT).toBe(1);
    expect(report.summary.byStatus.NOT_POSTED).toBe(1);
    expect(report.summary.byStatus.EXEMPT).toBe(1);
    // j2 has a HIRED candidate but is NOT_POSTED → compliance violation
    expect(report.summary.complianceViolations).toBe(1);
  });
});
