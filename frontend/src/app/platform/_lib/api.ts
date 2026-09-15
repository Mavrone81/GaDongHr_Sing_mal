'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { BadgeTone } from '@/components/ui';

// The operator API client, lifted unchanged from the old single-page console so every
// route talks to the same endpoints with the same token and the same 401/403 redirect.

export const TOKEN_KEY = 'gadonghr_platform_token';

export function apiUrl() {
  return process.env.NEXT_PUBLIC_API_URL || `http://${window.location.hostname}:4000/api`;
}
export function tok() {
  return typeof window !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null;
}
export function signOut(router: { push: (href: string) => void }) {
  localStorage.removeItem(TOKEN_KEY);
  router.push('/platform/login');
}

export type PlatformApi = (path: string, opts?: RequestInit) => Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export function usePlatformApi(): PlatformApi {
  const router = useRouter();
  return useCallback(async (path: string, opts: RequestInit = {}) => {
    const res = await fetch(`${apiUrl()}/platform${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}`, ...(opts.headers || {}) },
    });
    if (res.status === 401 || res.status === 403) { router.push('/platform/login'); throw new Error('auth'); }
    return res.json();
  }, [router]);
}

export interface Tenant { id: string; name: string; slug: string; country: string; status: string; trialEndsAt: string; plan?: string; users: number; }
export interface Mod { moduleCode: string; enabled: boolean; }
export interface ModuleDef { code: string; name: string; isCore: boolean; }
export interface AuditEntry { action: string; tenantId: string | null; createdAt: string; }
export interface Admin { id: string; email: string; name: string; role: string; mfaEnabled: boolean; isActive: boolean; }

export const STATUS_TONE: Record<string, BadgeTone> = {
  ACTIVE: 'ok',
  TRIALING: 'brass',
  SUSPENDED: 'danger',
  PAST_DUE: 'warn',
  CANCELED: 'neutral',
};
const STATUS_LABEL: Record<string, string> = { ACTIVE: 'Active', TRIALING: 'Trialing', SUSPENDED: 'Suspended', PAST_DUE: 'Past due', CANCELED: 'Canceled' };
export const statusLabel = (s: string) => STATUS_LABEL[s] ?? s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');
export const statusTone = (s: string): BadgeTone => STATUS_TONE[s] ?? 'neutral';

export const ROLE_LABEL: Record<string, string> = { SUPER_ADMIN: 'Super admin', BILLING: 'Billing', SUPPORT: 'Support' };

export const dateInputValue = (iso?: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : '');
export const fmtDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const fmtDateTime = (iso: string) => new Date(iso).toLocaleString('en-SG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export function daysUntil(iso?: string | null) {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}
