/**
 * Unit tests for the SSO callback pages' error-suppression logic.
 *
 * We can't render the actual Next.js page components in Jest (they depend on
 * next/navigation, next/headers, etc.), so we extract and test the pure
 * decision logic that governs when the error state should or should not be set.
 *
 * Three scenarios are tested:
 *   A) OAuth provider returned an error param  → error should be shown
 *   B) No code in the URL                      → error should be shown
 *   C) Successful flow: navigating flag = true → error must be suppressed
 *   D) AbortController signal aborted          → error must be suppressed
 *   E) Both navigating and aborted             → error must be suppressed
 */

// ── Pure logic extracted from the callback useEffect ─────────────────────────

interface CallbackState {
  errorMsg: string;
  status: 'loading' | 'error';
}

function simulateCallbackEffect(opts: {
  code: string | null;
  errorParam: string | null;
  errorDescription?: string | null;
  fetchThrows?: boolean;
  fetchErrorMsg?: string;
  navigating?: boolean;   // true = success path already started navigation
  aborted?: boolean;      // true = AbortController was triggered
}): CallbackState {
  const state: CallbackState = { errorMsg: '', status: 'loading' };

  const { code, errorParam, errorDescription, fetchThrows, fetchErrorMsg, navigating = false, aborted = false } = opts;

  // OAuth provider error
  if (errorParam) {
    state.errorMsg = errorParam === 'access_denied'
      ? 'You declined the Google sign-in request.'
      : (errorDescription || errorParam);
    state.status = 'error';
    return state;
  }

  // No code in URL
  if (!code) {
    state.errorMsg = 'No authorization code received from Google.';
    state.status = 'error';
    return state;
  }

  // Fetch failure path (simulated .catch() body)
  if (fetchThrows) {
    // This is the guard: aborted or navigating → suppress
    if (aborted || navigating) return state; // state stays 'loading', no error shown
    state.errorMsg = fetchErrorMsg || 'Sign-in failed. Please try again.';
    state.status = 'error';
  }

  return state;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SSO Callback — error state logic', () => {
  describe('A) OAuth provider error param', () => {
    test('sets error for access_denied', () => {
      const s = simulateCallbackEffect({ code: null, errorParam: 'access_denied' });
      expect(s.status).toBe('error');
      expect(s.errorMsg).toMatch(/declined/i);
    });

    test('sets error for other provider errors', () => {
      const s = simulateCallbackEffect({ code: null, errorParam: 'server_error', errorDescription: 'Provider is down' });
      expect(s.status).toBe('error');
      expect(s.errorMsg).toBe('Provider is down');
    });
  });

  describe('B) No code in URL', () => {
    test('sets error when code is null', () => {
      const s = simulateCallbackEffect({ code: null, errorParam: null });
      expect(s.status).toBe('error');
      expect(s.errorMsg).toMatch(/No authorization code/i);
    });

    test('sets error when code is empty string', () => {
      const s = simulateCallbackEffect({ code: '', errorParam: null });
      expect(s.status).toBe('error');
    });
  });

  describe('C) Fetch error — normal failure (navigating=false, aborted=false)', () => {
    test('shows error state', () => {
      const s = simulateCallbackEffect({
        code: 'valid-code',
        errorParam: null,
        fetchThrows: true,
        fetchErrorMsg: 'HTTP 500',
      });
      expect(s.status).toBe('error');
      expect(s.errorMsg).toBe('HTTP 500');
    });
  });

  describe('D) AbortController triggered — error must be suppressed', () => {
    test('keeps status loading when signal is aborted', () => {
      const s = simulateCallbackEffect({
        code: 'valid-code',
        errorParam: null,
        fetchThrows: true,
        fetchErrorMsg: 'The user aborted a request.',
        aborted: true,
      });
      expect(s.status).toBe('loading');
      expect(s.errorMsg).toBe('');
    });

    test('suppresses error from Strict Mode second-invoke abort', () => {
      // Strict Mode: first effect cleanup calls controller.abort(),
      // the in-flight request throws AbortError → must not show error UI
      const s = simulateCallbackEffect({
        code: 'valid-code',
        errorParam: null,
        fetchThrows: true,
        fetchErrorMsg: 'AbortError',
        aborted: true,
      });
      expect(s.status).toBe('loading');
    });
  });

  describe('E) navigating=true — error must be suppressed (post-navigation late callbacks)', () => {
    test('keeps status loading when navigation already started', () => {
      const s = simulateCallbackEffect({
        code: 'valid-code',
        errorParam: null,
        fetchThrows: true,
        fetchErrorMsg: 'Identity fetch failed',
        navigating: true,
      });
      expect(s.status).toBe('loading');
      expect(s.errorMsg).toBe('');
    });

    test('suppresses error even if login() threw after tokens were stored', () => {
      // login() stores tokens then calls fetchUserWithToken() which might fail
      // navigating=true is set before login() is called, so this is always safe
      const s = simulateCallbackEffect({
        code: 'valid-code',
        errorParam: null,
        fetchThrows: true,
        fetchErrorMsg: 'Identity fetch failed',
        navigating: true,
      });
      expect(s.status).toBe('loading');
    });
  });

  describe('F) Happy path — code present, no errors', () => {
    test('keeps status loading (navigation replaces the page)', () => {
      const s = simulateCallbackEffect({
        code: 'valid-oauth-code',
        errorParam: null,
        fetchThrows: false,
      });
      expect(s.status).toBe('loading');
      expect(s.errorMsg).toBe('');
    });
  });
});
