'use strict';

// Default set of policy documents that every new hire must acknowledge.
// Seeded via POST /onboarding/policy-documents/seed (idempotent).
const REQUIRED_DOCS = [
  {
    code: 'HANDBOOK',
    title: 'Employee Handbook',
    description: 'Company policies, benefits, and code of conduct',
  },
  {
    code: 'HARASSMENT_POLICY',
    title: 'Harassment & Discrimination Policy',
    description: 'Zero-tolerance policy on workplace harassment and discrimination',
  },
  {
    code: 'PDPA_CONSENT',
    title: 'PDPA Data Protection Consent',
    description: 'Personal Data Protection Act consent for processing of employee personal data',
  },
  {
    code: 'IT_ACCEPTABLE_USE',
    title: 'IT Acceptable Use Policy',
    description: 'Rules governing use of company IT systems, devices, and data',
  },
];

/**
 * Summarise a set of PolicyAcknowledgement rows for one employee.
 * Returns { total, done, pending, allComplete }.
 * allComplete is false when total === 0 (nothing to complete yet).
 */
function computeAckSummary(acknowledgements) {
  const total = acknowledgements.length;
  const done = acknowledgements.filter(a => a.status === 'ACKNOWLEDGED').length;
  const pending = total - done;
  return { total, done, pending, allComplete: total > 0 && pending === 0 };
}

module.exports = { REQUIRED_DOCS, computeAckSummary };
