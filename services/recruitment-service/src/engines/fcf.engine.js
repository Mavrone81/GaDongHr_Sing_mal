'use strict';
/**
 * REC-002 Fair Consideration Framework (FCF) engine.
 *
 * Pure — no DB. Three responsibilities:
 *   1. evaluateFcfStatus(job, now) — derives current FCF state for a job:
 *        NOT_POSTED   — no MCF posting recorded
 *        IN_PERIOD    — posted, 14-day window not yet elapsed
 *        COMPLIANT    — posted, ≥ 14 days elapsed → may shortlist + hire foreign
 *        EXEMPT       — explicitly exempted (high salary / intra-corporate /
 *                       shortage occupation / OTHER)
 *
 *      Returns { status, daysSincePosting, daysRemaining, blocksShortlisting,
 *                blocksHire }.
 *
 *   2. buildNationalityBreakdown(candidates) — tallies citizens / PRs /
 *      foreigners + a per-nationality dictionary, used by the FCF audit
 *      report and by MOM filings.
 *
 *   3. buildFcfReport(jobs, candidatesByJob, now) — array of per-job rows
 *      ready for the dashboard / CSV export, with status, days advertised,
 *      nationality breakdown, hire decision rationale.
 */

const DEFAULT_MCF_DAYS = 14;

const EXEMPT_REASONS = Object.freeze([
  'HIGH_SALARY',         // Monthly fixed salary ≥ S$30,000 (MOM rule)
  'INTRA_CORPORATE',     // Intra-corporate transferee
  'SHORTAGE_OCCUPATION', // On MOM Shortage Occupation List
  'OTHER',
]);

function daysBetween(a, b) {
  const start = (d) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((start(new Date(a)) - start(new Date(b))) / (1000 * 60 * 60 * 24));
}

/**
 * Compute the current FCF state for one job.
 * @param {object} job  { mcfPostedAt, mcfExpiredAt, fcfExempt, fcfExemptReason, salaryMax }
 * @param {Date} [now]
 * @returns {{ status: string, daysSincePosting: number|null, daysRemaining: number|null, blocksShortlisting: boolean, blocksHire: boolean, mcfDaysRequired: number }}
 */
function evaluateFcfStatus(job, now = new Date()) {
  const mcfDays = DEFAULT_MCF_DAYS;
  if (job?.fcfExempt) {
    return {
      status: 'EXEMPT',
      daysSincePosting: null,
      daysRemaining: null,
      blocksShortlisting: false,
      blocksHire: false,
      mcfDaysRequired: mcfDays,
      exemptReason: job.fcfExemptReason || null,
    };
  }
  if (!job?.mcfPostedAt) {
    return {
      status: 'NOT_POSTED',
      daysSincePosting: null,
      daysRemaining: null,
      blocksShortlisting: true,
      blocksHire: true,
      mcfDaysRequired: mcfDays,
    };
  }
  const daysSince = daysBetween(now, job.mcfPostedAt);
  const daysRemaining = Math.max(0, mcfDays - daysSince);
  if (daysSince >= mcfDays) {
    return {
      status: 'COMPLIANT',
      daysSincePosting: daysSince,
      daysRemaining: 0,
      blocksShortlisting: false,
      blocksHire: false,
      mcfDaysRequired: mcfDays,
    };
  }
  return {
    status: 'IN_PERIOD',
    daysSincePosting: daysSince,
    daysRemaining,
    blocksShortlisting: true,
    blocksHire: true,
    mcfDaysRequired: mcfDays,
  };
}

/**
 * Bucket citizen status into the three MOM buckets.
 * @param {string|null} value  free-text country code OR explicit "SC"/"PR" tag
 * @returns {'CITIZEN'|'PR'|'FOREIGNER'|'UNSPECIFIED'}
 */
function classifyCitizenship(value) {
  if (!value) return 'UNSPECIFIED';
  const v = String(value).trim().toUpperCase();
  if (v === 'CITIZEN' || v === 'SC' || v === 'SG' || v === 'SINGAPOREAN' || v === 'SINGAPORE') return 'CITIZEN';
  if (v === 'PR' || v === 'PERMANENT_RESIDENT') return 'PR';
  return 'FOREIGNER';
}

/**
 * Tally candidates by citizen status + nationality string. Used in both the
 * per-job report row and the dashboard summary.
 * @param {Array<object>} candidates  [{ nationality, citizenStatus }]
 */
function buildNationalityBreakdown(candidates = []) {
  const out = {
    total:         candidates.length,
    citizens:      0,
    prs:           0,
    foreigners:    0,
    unspecified:   0,
    byNationality: {},
  };
  for (const c of candidates) {
    const bucket = c.citizenStatus
      ? String(c.citizenStatus).toUpperCase()
      : classifyCitizenship(c.nationality);
    if (bucket === 'CITIZEN')      out.citizens++;
    else if (bucket === 'PR')      out.prs++;
    else if (bucket === 'FOREIGNER') out.foreigners++;
    else out.unspecified++;
    const key = (c.nationality || 'Unspecified').trim();
    out.byNationality[key] = (out.byNationality[key] || 0) + 1;
  }
  return out;
}

/**
 * Build the per-job FCF audit row.
 * @param {object} job
 * @param {Array<object>} candidates  the job's candidates
 * @param {Date} [now]
 * @returns {object}
 */
function buildReportRow(job, candidates = [], now = new Date()) {
  const fcf = evaluateFcfStatus(job, now);
  const breakdown = buildNationalityBreakdown(candidates);
  const hiredList = candidates.filter(c => c.isHired || c.stage === 'HIRED');
  const rejectedList = candidates.filter(c => c.stage === 'REJECTED');
  const shortlistedList = candidates.filter(c => ['INTERVIEW_1', 'INTERVIEW_2', 'ASSESSMENT', 'OFFER', 'HIRED'].includes(c.stage));
  const daysAdvertised = job?.mcfPostedAt
    ? daysBetween(now, job.mcfPostedAt)
    : 0;
  return {
    jobId: job.id,
    title: job.title,
    department: job.department,
    headcount: job.headcount,
    mcfJobId: job.mcfJobId,
    mcfPostedAt: job.mcfPostedAt,
    mcfExpiredAt: job.mcfExpiredAt,
    daysAdvertised,
    fcfStatus: fcf.status,
    fcfDaysRemaining: fcf.daysRemaining,
    blocksHire: fcf.blocksHire,
    fcfExempt: !!job.fcfExempt,
    fcfExemptReason: job.fcfExemptReason || null,
    candidateCount: candidates.length,
    shortlistedCount: shortlistedList.length,
    hiredCount: hiredList.length,
    rejectedCount: rejectedList.length,
    nationalityBreakdown: breakdown,
    hiringDecisions: hiredList.map(c => ({
      candidateId: c.id,
      candidateName: `${c.firstName || ''} ${c.lastName || ''}`.trim(),
      nationality: c.nationality || null,
      citizenStatus: c.citizenStatus || classifyCitizenship(c.nationality),
      hiringRationale: c.hiringRationale || null,
    })),
    rejectionAudit: rejectedList.map(c => ({
      candidateId: c.id,
      candidateName: `${c.firstName || ''} ${c.lastName || ''}`.trim(),
      nationality: c.nationality || null,
      rejectionReason: c.rejectionReason || null,
    })),
  };
}

/**
 * Build the full FCF compliance report.
 * @param {Array<object>} jobs       all job postings to include
 * @param {Map|object}    byJob      jobId → candidate list
 * @param {Date}          [now]
 */
function buildFcfReport(jobs = [], byJob = {}, now = new Date()) {
  const rows = jobs.map(j => {
    const candidates = (byJob instanceof Map ? byJob.get(j.id) : byJob[j.id]) || [];
    return buildReportRow(j, candidates, now);
  });
  const summary = rows.reduce((acc, r) => {
    acc.byStatus[r.fcfStatus] = (acc.byStatus[r.fcfStatus] || 0) + 1;
    acc.totalJobs       += 1;
    acc.totalCandidates += r.candidateCount;
    acc.totalHired      += r.hiredCount;
    acc.totalCitizens   += r.nationalityBreakdown.citizens;
    acc.totalPRs        += r.nationalityBreakdown.prs;
    acc.totalForeigners += r.nationalityBreakdown.foreigners;
    if (r.blocksHire && r.hiredCount > 0) acc.complianceViolations += 1;
    return acc;
  }, {
    byStatus: {}, totalJobs: 0, totalCandidates: 0, totalHired: 0,
    totalCitizens: 0, totalPRs: 0, totalForeigners: 0, complianceViolations: 0,
  });
  return { summary, rows };
}

module.exports = {
  DEFAULT_MCF_DAYS,
  EXEMPT_REASONS,
  evaluateFcfStatus,
  classifyCitizenship,
  buildNationalityBreakdown,
  buildReportRow,
  buildFcfReport,
  daysBetween,
};
