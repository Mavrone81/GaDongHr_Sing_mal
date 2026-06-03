// Pure, framework-free helpers for the self-service password-reset flow.
// Kept out of the page components so the decision logic can be unit-tested
// without rendering Next.js client components (see __tests__/passwordReset.test.ts).

export interface ResetValidation {
  ok: boolean;
  error: string;
}

// Password-strength meter shared by the admin user panel and the self-service
// reset page so both show an identical score/label/colour. Scores 0–5 from
// length and character-class diversity.
export function pwStrength(pw: string): { score: number; label: string; color: string } {
  let s = 0;
  if (pw.length >= 8)  s++;
  if (pw.length >= 12) s++;
  if (/[A-Z]/.test(pw)) s++;
  if (/[0-9]/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  const labels = ['', 'Weak', 'Fair', 'Good', 'Strong', 'Very Strong'];
  const colors = ['', 'bg-red-500', 'bg-amber-500', 'bg-yellow-400', 'bg-emerald-500', 'bg-emerald-600'];
  return { score: s, label: labels[s] || '', color: colors[s] || '' };
}

// Mirrors the server-side rule in auth-service POST /auth/reset-password
// (minimum 8 characters) plus the client-only confirm-match check. Returning
// the first failing rule keeps the UI message deterministic.
export function validateNewPassword(password: string, confirm: string): ResetValidation {
  if (password.length < 8) return { ok: false, error: 'Minimum 8 characters.' };
  if (password !== confirm) return { ok: false, error: 'Passwords do not match.' };
  return { ok: true, error: '' };
}

// A missing/empty token means the user landed on /auth/reset-password without
// a valid emailed link. We surface that immediately rather than letting them
// fill in a password only to get a server-side "invalid token" rejection.
export function tokenFromQuery(search: string): string | null {
  const token = new URLSearchParams(search).get('token');
  return token && token.trim() ? token : null;
}

export interface ForgotState {
  submitting: boolean;
  done: boolean;
  error: string;
}

// Whether the forgot-password submit button should be enabled: a non-empty,
// shape-valid email and no request already in flight.
export function canSubmitEmail(email: string, submitting: boolean): boolean {
  return !submitting && /.+@.+\..+/.test(email.trim());
}
