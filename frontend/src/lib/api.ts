// Shared API fetch utility with automatic token refresh
// All pages should import apiFetch from here instead of defining their own.

const ACCESS_COOKIE  = 'vorkhive_token';
const REFRESH_COOKIE = 'vorkhive_refresh';

export function getCookie(name: string): string | null {
  if (typeof window === 'undefined') return null;
  const c = document.cookie.split('; ').find(r => r.startsWith(`${name}=`));
  return c ? c.split('=').slice(1).join('=') : null;
}

export function setCookie(name: string, value: string, maxAgeSeconds: number) {
  document.cookie = `${name}=${value}; path=/; max-age=${maxAgeSeconds}; SameSite=Lax`;
}

export function clearCookie(name: string) {
  document.cookie = `${name}=; Max-Age=0; path=/`;
}

export function getAccessToken(): string | null  { return getCookie(ACCESS_COOKIE);  }
export function getRefreshToken(): string | null { return getCookie(REFRESH_COOKIE); }

export function storeTokens(accessToken: string, refreshToken?: string | null) {
  setCookie(ACCESS_COOKIE,  accessToken,  28800);   // 8 h
  if (refreshToken) setCookie(REFRESH_COOKIE, refreshToken, 604800); // 7 d
}

export function clearTokens() {
  clearCookie(ACCESS_COOKIE);
  clearCookie(REFRESH_COOKIE);
}

function resolveApiBase(): string {
  const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  return process.env.NEXT_PUBLIC_API_URL ?? `http://${hostname}:4000/api`;
}

// Deduplicate concurrent refresh calls — only one in-flight at a time
let _refreshPromise: Promise<string | null> | null = null;

async function doRefresh(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;
  try {
    const res = await fetch(`${resolveApiBase()}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) { clearCookie(REFRESH_COOKIE); return null; }
    const data = await res.json();
    storeTokens(data.accessToken, data.refreshToken);
    return data.accessToken as string;
  } catch {
    return null;
  }
}

function refreshOnce(): Promise<string | null> {
  if (!_refreshPromise) {
    _refreshPromise = doRefresh().finally(() => { _refreshPromise = null; });
  }
  return _refreshPromise;
}

async function rawFetch(path: string, opts: RequestInit | undefined, token: string | null): Promise<Response> {
  const isFormData = opts?.body instanceof FormData;
  const headers: Record<string, string> = isFormData ? {} : { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(`${resolveApiBase()}${path}`, {
    ...opts,
    headers: { ...headers, ...(opts?.headers as Record<string, string> ?? {}) },
  });
}

export async function apiFetch(path: string, opts?: RequestInit): Promise<any> {
  let token = getAccessToken();
  let res   = await rawFetch(path, opts, token);

  // Attempt token refresh on any 401 (expired or missing token)
  if (res.status === 401) {
    const newToken = await refreshOnce();
    if (newToken) {
      res = await rawFetch(path, opts, newToken);
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
