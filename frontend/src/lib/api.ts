// Shared API fetch utility with automatic token refresh.
//
// Post C-12 the access and refresh tokens are HttpOnly cookies set by the
// auth-service and forwarded by the gateway. JavaScript cannot read them,
// so any XSS payload no longer has access to them. apiFetch sends
// `credentials: 'include'` on every request so the browser attaches the
// cookies; we no longer set an Authorization header from JS.
//
// Legacy helpers (storeTokens / getAccessToken / getRefreshToken) are kept
// as no-ops so any older callers still compile, but they neither read nor
// write any sensitive token from JavaScript.

const ACCESS_COOKIE  = 'vorkhive_token';
const REFRESH_COOKIE = 'vorkhive_refresh';

// ── Legacy/back-compat helpers (no-ops post C-12) ────────────────────────────
// They used to read/write JWTs via document.cookie. That made any XSS able
// to exfiltrate them. They're kept for source-compatibility with older pages
// but the real token transport is the HttpOnly cookie the server sets.

export function getCookie(_name: string): string | null { return null; }
export function setCookie(_name: string, _value: string, _maxAgeSeconds: number) { /* no-op */ }
export function clearCookie(_name: string) { /* no-op */ }

export function getAccessToken(): string | null  { return null; }
export function getRefreshToken(): string | null { return null; }

export function storeTokens(_accessToken: string, _refreshToken?: string | null) {
  // Server-side HttpOnly cookies are authoritative. Nothing to store in JS.
}

export function clearTokens() {
  // Best-effort: clear any stale JS-readable cookies that may still be
  // around from before the cutover. The HttpOnly cookies are cleared by
  // the /auth/logout endpoint server-side.
  if (typeof document !== 'undefined') {
    document.cookie = `${ACCESS_COOKIE}=; Max-Age=0; path=/`;
    document.cookie = `${REFRESH_COOKIE}=; Max-Age=0; path=/`;
  }
}

function resolveApiBase(): string {
  const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  return process.env.NEXT_PUBLIC_API_URL ?? `http://${hostname}:4000/api`;
}

// Deduplicate concurrent refresh calls — only one in-flight at a time.
let _refreshPromise: Promise<boolean> | null = null;

async function doRefresh(): Promise<boolean> {
  try {
    const res = await fetch(`${resolveApiBase()}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    return res.ok;
  } catch {
    return false;
  }
}

function refreshOnce(): Promise<boolean> {
  if (!_refreshPromise) {
    _refreshPromise = doRefresh().finally(() => { _refreshPromise = null; });
  }
  return _refreshPromise;
}

async function rawFetch(path: string, opts: RequestInit | undefined): Promise<Response> {
  const isFormData = opts?.body instanceof FormData;
  const baseHeaders: Record<string, string> = isFormData ? {} : { 'Content-Type': 'application/json' };
  return fetch(`${resolveApiBase()}${path}`, {
    ...opts,
    credentials: 'include',
    headers: { ...baseHeaders, ...(opts?.headers as Record<string, string> ?? {}) },
  });
}

export async function apiFetch(path: string, opts?: RequestInit): Promise<any> {
  let res = await rawFetch(path, opts);

  // Attempt cookie-based refresh on 401, then retry once.
  if (res.status === 401) {
    const refreshed = await refreshOnce();
    if (refreshed) {
      res = await rawFetch(path, opts);
    } else {
      clearTokens();
      if (typeof window !== 'undefined') window.location.href = '/login';
      throw new Error('Session expired. Please log in again.');
    }
  }

  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error((d as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}
