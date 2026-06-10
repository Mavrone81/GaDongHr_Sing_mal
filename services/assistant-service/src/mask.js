'use strict';

// Redact sensitive PII before tool results are sent to an EXTERNAL LLM (Claude).
// The assistant is already RBAC-scoped to the caller's own data; this is
// defense-in-depth + PDPA data-minimisation for cross-border processing.
// (Not applied for the local/Ollama path — data never leaves the host there.)
const SENSITIVE_KEYS = new Set([
  'nric', 'nricencrypted', 'fin', 'passport', 'passnumber', 'passnumberencrypted',
  'salary', 'basicsalary', 'basicsalaryencrypted', 'basicsalaryenc', 'grosspay', 'grosspayenc',
  'netpay', 'netpayenc', 'amountencrypted', 'amountenc', 'cpf', 'employeecpfenc', 'employercpfenc',
  'bankaccount', 'bankaccountencrypted', 'bankaccountno', 'accountnumber', 'bankaccountenc',
  'homeaddress', 'homeaddressencrypted', 'address', 'addressline1', 'addressline2', 'postalcode',
  'dateofbirth', 'dob', 'personalphone', 'personalemail', 'mfasecret', 'passwordhash', 'mfasecretenc',
]);
const REDACTED = '[redacted for privacy]';

function maskSensitive(value) {
  if (Array.isArray(value)) return value.map(maskSensitive);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEYS.has(String(k).toLowerCase()) && v != null ? REDACTED : maskSensitive(v);
    }
    return out;
  }
  return value;
}

module.exports = { maskSensitive };
