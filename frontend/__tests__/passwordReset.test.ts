/**
 * Unit tests for the self-service password-reset helper logic
 * (frontend/src/lib/passwordReset.ts). These are the pure decision functions
 * the forgot-password / reset-password pages delegate to, so we can test them
 * without rendering the Next.js client components.
 */
import { validateNewPassword, tokenFromQuery, canSubmitEmail, pwStrength } from '../src/lib/passwordReset';

describe('validateNewPassword', () => {
  test('rejects passwords shorter than 8 characters', () => {
    const v = validateNewPassword('short', 'short');
    expect(v.ok).toBe(false);
    expect(v.error).toMatch(/8 characters/i);
  });

  test('rejects when confirmation does not match', () => {
    const v = validateNewPassword('longenough1', 'longenough2');
    expect(v.ok).toBe(false);
    expect(v.error).toMatch(/do not match/i);
  });

  test('length is checked before the match (deterministic first error)', () => {
    // Too short AND mismatched → should surface the length error first.
    const v = validateNewPassword('abc', 'xyz');
    expect(v.error).toMatch(/8 characters/i);
  });

  test('accepts a valid, matching password', () => {
    const v = validateNewPassword('correcthorse', 'correcthorse');
    expect(v).toEqual({ ok: true, error: '' });
  });

  test('boundary: exactly 8 characters is accepted', () => {
    expect(validateNewPassword('12345678', '12345678').ok).toBe(true);
  });
});

describe('tokenFromQuery', () => {
  test('extracts the token from a query string', () => {
    expect(tokenFromQuery('?token=abc123')).toBe('abc123');
  });

  test('returns null when the token param is absent', () => {
    expect(tokenFromQuery('?foo=bar')).toBeNull();
    expect(tokenFromQuery('')).toBeNull();
  });

  test('treats a blank token as missing', () => {
    expect(tokenFromQuery('?token=')).toBeNull();
    expect(tokenFromQuery('?token=%20%20')).toBeNull();
  });
});

describe('pwStrength', () => {
  test('empty password scores 0 with no label', () => {
    expect(pwStrength('')).toEqual({ score: 0, label: '', color: '' });
  });

  test('short lowercase-only password is Weak (score 1)', () => {
    const s = pwStrength('abcdefgh'); // >=8 only
    expect(s.score).toBe(1);
    expect(s.label).toBe('Weak');
    expect(s.color).toBe('bg-red-500');
  });

  test('long + upper + digit + symbol maxes out at Very Strong (score 5)', () => {
    const s = pwStrength('Abcdefghij1!'); // >=8, >=12, upper, digit, symbol
    expect(s.score).toBe(5);
    expect(s.label).toBe('Very Strong');
    expect(s.color).toBe('bg-emerald-600');
  });

  test('mixed medium password lands in the middle', () => {
    const s = pwStrength('Abcdefg1'); // >=8, upper, digit = 3
    expect(s.score).toBe(3);
    expect(s.label).toBe('Good');
  });
});

describe('canSubmitEmail', () => {
  test('enabled for a shape-valid email when idle', () => {
    expect(canSubmitEmail('user@company.com', false)).toBe(true);
  });

  test('disabled while a request is in flight', () => {
    expect(canSubmitEmail('user@company.com', true)).toBe(false);
  });

  test('disabled for an obviously invalid email', () => {
    expect(canSubmitEmail('not-an-email', false)).toBe(false);
    expect(canSubmitEmail('', false)).toBe(false);
    expect(canSubmitEmail('a@b', false)).toBe(false);
  });

  test('trims surrounding whitespace before validating', () => {
    expect(canSubmitEmail('  user@company.com  ', false)).toBe(true);
  });
});
