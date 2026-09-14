/**
 * Display helpers for settings screens. Identifiers (roles, statuses, event
 * types) arrive as UPPER_SNAKE; the redesign shows sentence case, keeping the
 * acronyms people actually say as acronyms.
 */
const ACRONYMS = new Set(['HR', 'IT', 'MFA', 'SSO', 'API', 'PDPA', 'CPF', 'SDL', 'FWL', 'IP', 'ID', 'GIRO', 'IRAS', 'MOM', 'SAML', 'OIDC', 'TOTP', 'URL', 'CSV', 'PII']);

/** "SUPER_ADMIN" → "Super admin", "HR_MANAGER" → "HR manager", "user.login" → "User login". */
export function sentenceCase(id: string): string {
  const words = String(id ?? '').replace(/[._-]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  return words
    .map((w, i) => {
      const up = w.toUpperCase();
      if (ACRONYMS.has(up)) return up;
      const lower = w.toLowerCase();
      return i === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(' ');
}
