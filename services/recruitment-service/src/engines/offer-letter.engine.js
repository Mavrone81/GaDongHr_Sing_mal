'use strict';

// Pure offer letter helpers — no DB, no I/O.

const DEFAULT_EXPIRY_DAYS = 7;

// Build the offer letter text data used for both PDF rendering and e-sign template.
function buildOfferLetterData(candidate, job, options = {}) {
  const {
    startDate,
    offeredSalary,
    probationMonths = 3,
    reportingManager,
    additionalTerms,
    expiryDays = DEFAULT_EXPIRY_DAYS,
  } = options;

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + expiryDays);

  return {
    // Candidate
    candidateName: `${candidate.firstName} ${candidate.lastName}`,
    candidateEmail: candidate.email,
    // Role
    jobTitle:        job?.title        || options.jobTitle  || 'Position',
    department:      job?.department   || options.department || null,
    reportingManager: reportingManager || null,
    // Terms
    startDate:         startDate ? new Date(startDate) : null,
    offeredSalary:     offeredSalary ?? null,
    probationMonths,
    additionalTerms:   additionalTerms || null,
    expiresAt,
    issuedDate:        new Date(),
  };
}

// Render offer letter as HTML (used for e-sign template variables).
function renderOfferLetterHtml(data, companyName = 'The Company') {
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-SG', { day: 'numeric', month: 'long', year: 'numeric' }) : 'TBD';
  const fmtSalary = (s) => s != null ? `SGD ${Number(s).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} per month` : 'As discussed';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: Arial, sans-serif; font-size: 13px; color: #1a1a1a; margin: 0; padding: 40px; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  .subtitle { color: #555; margin-bottom: 32px; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; }
  td { padding: 6px 12px; vertical-align: top; }
  td:first-child { font-weight: bold; width: 40%; color: #444; }
  hr { border: none; border-top: 1px solid #ddd; margin: 24px 0; }
  .footer { margin-top: 48px; font-size: 11px; color: #888; }
  .signature-block { margin-top: 48px; }
</style></head>
<body>
  <p>${fmtDate(data.issuedDate)}</p>
  <p>Dear ${data.candidateName},</p>
  <h1>Letter of Offer — ${data.jobTitle}</h1>
  <p class="subtitle">We are pleased to offer you the following position at ${companyName}.</p>
  <hr>
  <table>
    <tr><td>Position</td><td>${data.jobTitle}</td></tr>
    ${data.department ? `<tr><td>Department</td><td>${data.department}</td></tr>` : ''}
    ${data.reportingManager ? `<tr><td>Reporting To</td><td>${data.reportingManager}</td></tr>` : ''}
    <tr><td>Start Date</td><td>${fmtDate(data.startDate)}</td></tr>
    <tr><td>Basic Salary</td><td>${fmtSalary(data.offeredSalary)}</td></tr>
    <tr><td>Probation Period</td><td>${data.probationMonths} month${data.probationMonths !== 1 ? 's' : ''}</td></tr>
  </table>
  ${data.additionalTerms ? `<p><strong>Additional Terms:</strong><br>${data.additionalTerms}</p>` : ''}
  <hr>
  <p>This offer is valid until <strong>${fmtDate(data.expiresAt)}</strong>. Please sign and return this letter to indicate your acceptance.</p>
  <p>We look forward to welcoming you to the team.</p>
  <div class="signature-block">
    <p>Yours sincerely,<br><br><br>
    ______________________________<br>
    Human Resources<br>${companyName}</p>
  </div>
  <hr>
  <p><strong>Acceptance</strong></p>
  <p>I, ${data.candidateName}, accept the above offer of employment.</p>
  <p>Signature: ______________________________&nbsp;&nbsp;&nbsp; Date: ______________________________</p>
  <div class="footer">
    Issued: ${fmtDate(data.issuedDate)} · Offer expires: ${fmtDate(data.expiresAt)}
  </div>
</body>
</html>`;
}

// Build the variables map for ESV-003 e-sign template placeholders.
function buildEsignVariables(data, companyName = 'The Company') {
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-SG', { day: 'numeric', month: 'long', year: 'numeric' }) : 'TBD';
  const fmtSalary = (s) => s != null ? `SGD ${Number(s).toLocaleString('en-SG', { minimumFractionDigits: 2 })} per month` : 'As discussed';

  return {
    CANDIDATE_NAME:     data.candidateName,
    CANDIDATE_EMAIL:    data.candidateEmail,
    JOB_TITLE:          data.jobTitle,
    DEPARTMENT:         data.department || '',
    REPORTING_MANAGER:  data.reportingManager || '',
    START_DATE:         fmtDate(data.startDate),
    OFFERED_SALARY:     fmtSalary(data.offeredSalary),
    PROBATION_MONTHS:   String(data.probationMonths),
    ADDITIONAL_TERMS:   data.additionalTerms || '',
    ISSUED_DATE:        fmtDate(data.issuedDate),
    EXPIRY_DATE:        fmtDate(data.expiresAt),
    COMPANY_NAME:       companyName,
  };
}

module.exports = {
  buildOfferLetterData,
  renderOfferLetterHtml,
  buildEsignVariables,
  DEFAULT_EXPIRY_DAYS,
};
