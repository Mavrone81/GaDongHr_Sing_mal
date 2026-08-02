'use strict';

/**
 * HTTP client for the per-country statutory services.
 *
 * FAIL CLOSED. Every failure throws so the caller leaves the run in DRAFT.
 * There is no cached result, no default rate, and no partial compute: a wrong
 * CPF figure is far worse than an unavailable payroll run, because it surfaces
 * months later as a compliance problem rather than immediately as an outage.
 *
 * This is the seam that lets a Malaysian statutory service exist without a line
 * of Malaysian code reaching Singapore payroll — payroll-service picks an
 * upstream by the run's entity country and never learns what CPF or EPF is.
 */

class StatutoryUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StatutoryUnavailableError';
    // 503 rather than 500: retryable, and the run stays DRAFT.
    this.status = 503;
  }
}

function serviceUrlFor(country) {
  const urls = {
    SG: process.env.STATUTORY_SG_SERVICE_URL || 'http://statutory-sg-service:4021',
    MY: process.env.STATUTORY_MY_SERVICE_URL || null, // P2
  };
  return urls[country] || null;
}

async function computeStatutoryBatch({ country, period, entity, employees }) {
  const base = serviceUrlFor(country);
  // An unconfigured country must stop payroll, not compute it as some default.
  if (!base) throw new StatutoryUnavailableError(`No statutory service configured for country ${country}`);

  const key = process.env.INTERNAL_SERVICE_KEY;
  if (!key) throw new StatutoryUnavailableError('INTERNAL_SERVICE_KEY is not configured');

  let res;
  try {
    res = await fetch(`${base}/statutory/compute-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-service-key': key },
      body: JSON.stringify({ period, entity, employees }),
    });
  } catch (err) {
    throw new StatutoryUnavailableError(`Statutory service unreachable: ${err.message}`);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new StatutoryUnavailableError(`Statutory service returned ${res.status}: ${detail}`);
  }
  return res.json();
}

function findResult(results, employeeId) {
  const r = (results || []).find(x => x.employeeId === employeeId);
  // Never default to zero — that would silently under-contribute rather than
  // fail, which is the whole failure mode this module exists to prevent.
  if (!r) throw new StatutoryUnavailableError(`No statutory result for employee ${employeeId}`);
  return r;
}

function sumByKind(result, kind) {
  return ((result && result[kind]) || []).reduce((acc, line) => acc + (line.amount || 0), 0);
}

module.exports = { computeStatutoryBatch, findResult, sumByKind, StatutoryUnavailableError };
