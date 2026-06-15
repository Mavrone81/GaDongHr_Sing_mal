'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';

/* ─────────────────────────────────────────────────────────────────────
   Vorkhive Command Centre — HR / Payroll management dashboard.
   Every figure on this dashboard is sourced from a live service endpoint:
     • headcount / new hires / departments  → /employees
     • payroll total + run status           → /payroll/runs
     • leave mix                            → /leave/applications (by type)
     • statutory compliance                 → /payroll/iras-submissions (+ deadlines)
     • documents overdue                    → /esign/dashboard
   Widgets degrade gracefully (hide / empty-state) when the caller's role
   lacks access to an endpoint — nothing is fabricated. Each fetch is
   isolated via Promise.allSettled so one 403 never blanks the page.
   ───────────────────────────────────────────────────────────────────── */

// ─── Donut chart ───────────────────────────────────────────────────────────────
function Donut({
  segments, size = 132, thickness = 16, centerLabel, centerSub,
}: {
  segments: { label: string; value: number; color: string }[];
  size?: number; thickness?: number; centerLabel?: string; centerSub?: string;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--slate-100)" strokeWidth={thickness} />
        {segments.map((seg, i) => {
          const frac = seg.value / total;
          const dash = frac * c;
          const el = (
            <circle
              key={i}
              cx={size / 2} cy={size / 2} r={r}
              fill="none" stroke={seg.color} strokeWidth={thickness}
              strokeDasharray={`${dash} ${c - dash}`}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
            />
          );
          offset += dash;
          return el;
        })}
      </svg>
      {(centerLabel || centerSub) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {centerLabel && <span className="text-xl font-black text-slate-900 tracking-tighter leading-none">{centerLabel}</span>}
          {centerSub && <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest mt-1">{centerSub}</span>}
        </div>
      )}
    </div>
  );
}

function Legend({ segments }: { segments: { label: string; value: number; color: string }[] }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <div className="flex flex-col gap-2.5 flex-1 min-w-0">
      {segments.map((seg) => (
        <div key={seg.label} className="flex items-center gap-2.5">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: seg.color }} />
          <span className="text-[10px] font-bold text-slate-600 truncate flex-1">{seg.label}</span>
          <span className="text-[10px] font-black text-slate-900">{Math.round((seg.value / total) * 100)}%</span>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center py-10">
      <p className="text-[9px] font-black text-slate-300 uppercase tracking-widest text-center">{label}</p>
    </div>
  );
}

// ─── Glance tile ───────────────────────────────────────────────────────────────
function GlanceTile({
  icon, label, value, sub, accent, href, loading,
}: {
  icon: string; label: string; value: string; sub?: string;
  accent: 'navy' | 'gold' | 'emerald' | 'amber'; href?: string; loading?: boolean;
}) {
  const ring: Record<string, string> = {
    navy: 'bg-indigo-50 text-indigo-600', gold: 'bg-gold-50 text-gold-600',
    emerald: 'bg-emerald-50 text-emerald-600', amber: 'bg-amber-50 text-amber-600',
  };
  const subColor: Record<string, string> = {
    navy: 'text-indigo-500', gold: 'text-gold-600', emerald: 'text-emerald-600', amber: 'text-amber-600',
  };
  const Wrapper = href ? Link : 'div';
  return (
    <Wrapper href={href as string} className="bg-white rounded-[1.5rem] border border-slate-100 shadow-card p-5 flex flex-col gap-3 group hover:border-gold-200 transition-all">
      <div className="flex items-center justify-between">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-base ${ring[accent]}`}>{icon}</div>
        <span className="text-[8px] font-black text-slate-300 uppercase tracking-[0.2em]">{label}</span>
      </div>
      {loading ? (
        <div className="h-8 w-16 bg-slate-100 rounded-lg animate-pulse" />
      ) : (
        <h3 className="text-3xl font-black text-slate-900 tracking-tighter leading-none">{value}</h3>
      )}
      {sub && <p className={`text-[8px] font-black uppercase tracking-widest ${subColor[accent]}`}>{sub}</p>}
    </Wrapper>
  );
}

// ─── Section Header ───────────────────────────────────────────────────────────
function SectionHeader({ title, badge, href, color = 'navy' }: { title: string; badge?: string; href?: string; color?: string }) {
  const colorMap: Record<string, string> = {
    navy: 'bg-indigo-600', gold: 'bg-gold-500', emerald: 'bg-emerald-500',
    amber: 'bg-amber-500', red: 'bg-red-500', slate: 'bg-slate-700',
  };
  return (
    <div className="flex items-center justify-between mb-6">
      <div className="flex items-center gap-4">
        <div className={`w-1.5 h-8 ${colorMap[color] ?? colorMap.navy} rounded-full`}></div>
        <h3 className="text-[11px] font-black text-slate-900 uppercase tracking-[0.25em]">{title}</h3>
        {badge && <span className="text-[8px] font-black px-2.5 py-1 bg-gold-50 border border-gold-200 text-gold-600 rounded-full uppercase tracking-widest">{badge}</span>}
      </div>
      {href && (
        <Link href={href} className="label-form hover:text-gold-600 transition-colors flex items-center gap-2">
          View All <span>→</span>
        </Link>
      )}
    </div>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface IrasKind { kind: string; status: string; urgency: string; daysUntilDeadline: number | null; }
interface DashboardStats {
  activeEmployees: number;
  newThisMonth: number;
  pendingLeave: number;
  pendingClaims: number;
  departments: { label: string; count: number }[];
  latestPayrollRun: { period: string; status: string; amount: number | null } | null;
  leaveByType: { label: string; count: number }[];   // [] when unavailable
  iras: IrasKind[];                                   // [] when unavailable
  irasDueCount: number | null;                        // upcoming + overdue statutory items
  docsOverdue: number | null;                         // overdue e-sign requests
}

// 5-minute in-memory cache — avoids re-fetching on every navigation
let _statsCache: { data: DashboardStats; ts: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000;

const SGD = (n: number) => 'SGD ' + n.toLocaleString('en-SG', { maximumFractionDigits: 0 });
const titleCase = (s: string) =>
  s.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());

// Donut palette (navy → gold → neutrals)
const DONUT = ['#1c3a66', '#b8893d', '#4d6fa3', '#cda64c', '#7d9bc4', '#cbd5e1'];

// Map a real IRAS submission status to a badge tone
function irasTone(status: string, urgency: string) {
  if (status === 'ACKNOWLEDGED') return { dot: 'bg-emerald-500', txt: 'text-emerald-600', label: 'Acknowledged' };
  if (status === 'REJECTED')     return { dot: 'bg-red-500',     txt: 'text-red-600',     label: 'Rejected' };
  if (urgency === 'OVERDUE')     return { dot: 'bg-red-500',     txt: 'text-red-600',     label: 'Overdue' };
  if (status === 'SUBMITTED')    return { dot: 'bg-indigo-500',  txt: 'text-indigo-600',  label: 'Submitted' };
  if (urgency === 'DUE_SOON')    return { dot: 'bg-amber-500',   txt: 'text-amber-600',   label: 'Due soon' };
  return { dot: 'bg-slate-400', txt: 'text-slate-500', label: titleCase(status || 'Draft') };
}

export default function ManagementDashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      if (_statsCache && Date.now() - _statsCache.ts < CACHE_TTL) {
        setStats(_statsCache.data);
        setLoading(false);
        return;
      }

      try {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
        const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

        const [
          activeRes, newRes, leaveRes, claimsRes, payrollRunsRes, allEmpsRes,
          leaveAppsRes, irasRes, irasDueRes, esignRes,
        ] = await Promise.allSettled([
          apiFetch('/employees?isActive=true&limit=1'),
          apiFetch(`/employees?isActive=true&startDateFrom=${monthStart}&startDateTo=${monthEnd}&limit=1`),
          apiFetch('/leave/applications?status=PENDING&limit=1'),
          apiFetch('/claims?status=SUBMITTED&limit=1'),
          apiFetch('/payroll/runs?limit=1'),
          apiFetch('/employees?isActive=true&limit=500'),
          apiFetch('/leave/applications?limit=200'),
          apiFetch('/payroll/iras-submissions'),
          apiFetch('/payroll/iras-submissions/deadlines?withinDays=60'),
          apiFetch('/esign/dashboard'),
        ]);

        const num = (r: PromiseSettledResult<any>, path = 'total') =>
          r.status === 'fulfilled' ? (r.value?.[path] ?? 0) : 0;

        const activeEmployees = num(activeRes);
        const newThisMonth   = num(newRes);
        const pendingLeave   = num(leaveRes);
        const pendingClaims  = num(claimsRes);

        // Department breakdown (real, from active employees)
        const deptMap: Record<string, number> = {};
        if (allEmpsRes.status === 'fulfilled') {
          for (const emp of allEmpsRes.value.employees ?? []) {
            const dept = emp.department || 'Unassigned';
            deptMap[dept] = (deptMap[dept] || 0) + 1;
          }
        }
        const departments = Object.entries(deptMap)
          .sort((a, b) => b[1] - a[1]).slice(0, 6)
          .map(([label, count]) => ({ label, count }));

        // Leave mix by type (real, from leave applications)
        const leaveMap: Record<string, number> = {};
        if (leaveAppsRes.status === 'fulfilled') {
          for (const app of leaveAppsRes.value.applications ?? []) {
            const name = app.leaveType?.name || app.leaveTypeName || 'Other';
            leaveMap[name] = (leaveMap[name] || 0) + 1;
          }
        }
        const leaveSorted = Object.entries(leaveMap).sort((a, b) => b[1] - a[1]);
        const leaveByType = leaveSorted.slice(0, 4).map(([label, count]) => ({ label, count }));
        const otherLeave = leaveSorted.slice(4).reduce((s, [, c]) => s + c, 0);
        if (otherLeave > 0) leaveByType.push({ label: 'Others', count: otherLeave });

        // Latest payroll run (+ net amount if the run carries one)
        let latestPayrollRun: DashboardStats['latestPayrollRun'] = null;
        if (payrollRunsRes.status === 'fulfilled') {
          const runs = payrollRunsRes.value.runs ?? payrollRunsRes.value ?? [];
          const run = Array.isArray(runs) ? runs[0] : null;
          if (run) {
            const amount = run.netTotal ?? run.totalNet ?? run.grossTotal ?? run.totalAmount ?? null;
            latestPayrollRun = {
              period: run.period || run.periodLabel || '',
              status: run.status || 'UNKNOWN',
              amount: typeof amount === 'number' ? amount : null,
            };
          }
        }

        // Statutory compliance — latest submission per kind (real)
        let iras: IrasKind[] = [];
        if (irasRes.status === 'fulfilled') {
          const subs = irasRes.value.submissions ?? [];
          const seen = new Set<string>();
          for (const s of subs) {
            if (seen.has(s.kind)) continue; // submissions are deadline-ordered → first = most relevant
            seen.add(s.kind);
            iras.push({ kind: s.kind, status: s.status, urgency: s.urgency, daysUntilDeadline: s.daysUntilDeadline ?? null });
          }
          iras = iras.slice(0, 6);
        }
        const irasDueCount = irasDueRes.status === 'fulfilled' ? (irasDueRes.value?.total ?? null) : null;
        const docsOverdue  = esignRes.status === 'fulfilled' ? (esignRes.value?.overdue ?? null) : null;

        const computed: DashboardStats = {
          activeEmployees, newThisMonth, pendingLeave, pendingClaims, departments,
          latestPayrollRun, leaveByType, iras, irasDueCount, docsOverdue,
        };
        _statsCache = { data: computed, ts: Date.now() };
        setStats(computed);
      } catch (err) {
        console.error('[Dashboard] stats load failed:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const payrollBadge = stats?.latestPayrollRun?.period
    ? stats.latestPayrollRun.period
    : new Date().toLocaleString('default', { month: 'short', year: 'numeric' });

  const payrollStatus = stats?.latestPayrollRun?.status ?? 'N/A';
  const payrollStatusLabel =
    payrollStatus === 'PENDING' ? 'Pending Approval' :
    payrollStatus === 'APPROVED' ? 'Approved' :
    payrollStatus === 'FINALISED' ? 'Finalised' :
    payrollStatus === 'DRAFT' ? 'Draft' : payrollStatus;
  const payrollProcessed = payrollStatus === 'FINALISED' || payrollStatus === 'APPROVED';

  const deptSegments = (stats?.departments ?? []).map((d, i) => ({ label: d.label, value: d.count, color: DONUT[i % DONUT.length] }));
  const leaveSegments = (stats?.leaveByType ?? []).map((d, i) => ({ label: d.label, value: d.count, color: DONUT[i % DONUT.length] }));
  const leaveTotal = leaveSegments.reduce((s, x) => s + x.value, 0);

  const pendingApprovals = (stats?.pendingLeave ?? 0) + (stats?.pendingClaims ?? 0);

  // Action items — only real signals (omit a row when its source is unavailable)
  const actionItems = [
    { label: 'Pending Approvals', count: pendingApprovals, path: '/leave', accent: true, show: true },
    { label: 'Statutory Filings Due', count: stats?.irasDueCount ?? 0, path: '/payroll/iras-submissions', accent: false, show: stats?.irasDueCount != null },
    { label: 'Documents Overdue', count: stats?.docsOverdue ?? 0, path: '/documents', accent: false, show: stats?.docsOverdue != null },
  ].filter((i) => i.show);

  // Command queue — derived purely from live signals
  const queue = [
    payrollStatus === 'PENDING' || payrollStatus === 'DRAFT'
      ? { title: `Payroll Auth — ${payrollBadge}`, sub: 'Checker approval required', path: '/payroll', urgent: true, icon: '◆' } : null,
    (stats?.pendingLeave ?? 0) > 0
      ? { title: `Leave Approvals (${stats?.pendingLeave})`, sub: 'L1 / L2 pending', path: '/leave/registry', urgent: false, icon: '◌' } : null,
    (stats?.pendingClaims ?? 0) > 0
      ? { title: `Claims Review (${stats?.pendingClaims})`, sub: 'Finance: L2 pending', path: '/claims/registry', urgent: false, icon: '◫' } : null,
    (stats?.irasDueCount ?? 0) > 0
      ? { title: `Statutory Filings (${stats?.irasDueCount})`, sub: 'CPF / IRAS deadlines', path: '/payroll/iras-submissions', urgent: true, icon: '◉' } : null,
    (stats?.docsOverdue ?? 0) > 0
      ? { title: `Documents Overdue (${stats?.docsOverdue})`, sub: 'e-Sign past due', path: '/documents', urgent: false, icon: '◭' } : null,
  ].filter(Boolean) as { title: string; sub: string; path: string; urgent: boolean; icon: string }[];

  return (
    <div className="flex flex-col gap-8 pb-12 animate-in fade-in slide-in-from-bottom-4 duration-700">

      {/* ── ROW 1: Workforce at a glance ──────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        <GlanceTile
          icon="◈" label="Headcount" accent="navy" href="/employees" loading={loading}
          value={loading ? '—' : String(stats?.activeEmployees ?? 0)}
          sub={!loading && stats ? `↑ ${stats.newThisMonth} new this month` : 'Active employees'}
        />
        <GlanceTile
          icon="◇" label="New Hires" accent="gold" href="/employees" loading={loading}
          value={loading ? '—' : String(stats?.newThisMonth ?? 0)}
          sub="Joined this month"
        />
        <GlanceTile
          icon="◉" label="Departments" accent="emerald" href="/employees" loading={loading}
          value={loading ? '—' : String(stats?.departments?.length ?? 0)}
          sub="Active units"
        />
        <GlanceTile
          icon="✓" label="Statutory" accent="amber" href="/payroll/iras-submissions" loading={loading}
          value={loading ? '—' : String(stats?.irasDueCount ?? '—')}
          sub={stats?.irasDueCount != null ? 'Filings due (60 days)' : 'No access'}
        />
      </div>

      {/* ── ROW 2: Payroll Summary · Leave Overview · Action Items ─────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 lg:gap-8">

        {/* Payroll Summary */}
        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-card p-6 lg:p-8 flex flex-col">
          <SectionHeader title="Payroll Summary" badge={payrollBadge} href="/payroll" color="navy" />
          <div className="flex-1 flex flex-col justify-center">
            {loading ? (
              <div className="h-9 w-40 bg-slate-100 rounded-xl animate-pulse" />
            ) : (
              <h3 className="text-3xl font-black text-slate-900 tracking-tighter leading-none">
                {stats?.latestPayrollRun?.amount != null ? SGD(stats.latestPayrollRun.amount) : payrollBadge}
              </h3>
            )}
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-3">
              {stats?.latestPayrollRun ? 'Latest run' : 'No payroll run yet'}
            </p>
            {!loading && stats?.latestPayrollRun && (
              <div className="mt-5 flex items-center gap-2">
                <span className={`badge ${payrollProcessed ? 'badge-success' : 'badge-warning'}`}>
                  {payrollProcessed ? `✓ ${payrollStatusLabel}` : payrollStatusLabel}
                </span>
              </div>
            )}
          </div>
          <Link href="/payroll" className="mt-6 block w-full py-3 bg-indigo-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-700 shadow-primary transition-all active:scale-95 text-center">
            ⚡ Review &amp; Authorise
          </Link>
        </div>

        {/* Leave Overview donut */}
        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-card p-6 lg:p-8">
          <SectionHeader title="Leave Overview" href="/leave/registry" color="gold" />
          {loading ? (
            <div className="h-[132px] flex items-center justify-center">
              <div className="w-[132px] h-[132px] rounded-full border-[16px] border-slate-100 animate-pulse" />
            </div>
          ) : leaveSegments.length ? (
            <div className="flex items-center gap-6">
              <Donut segments={leaveSegments} centerLabel={String(leaveTotal)} centerSub="Requests" />
              <Legend segments={leaveSegments} />
            </div>
          ) : (
            <EmptyState label="No leave records" />
          )}
        </div>

        {/* Action Items */}
        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-card p-6 lg:p-8">
          <SectionHeader title="Action Items" color="amber" />
          <div className="space-y-3">
            {actionItems.map((it) => (
              <Link key={it.label} href={it.path} className="flex items-center justify-between p-4 rounded-2xl border bg-slate-50 border-slate-100 hover:border-gold-200 hover:bg-gold-50/40 transition-all group">
                <span className="text-[10px] font-bold text-slate-700 group-hover:text-slate-900 truncate">{it.label}</span>
                <span className={`text-[10px] font-black px-2.5 py-1 rounded-lg border ${it.accent ? 'bg-gold-50 text-gold-600 border-gold-200' : 'bg-white text-slate-500 border-slate-200'}`}>
                  {loading ? '…' : String(it.count).padStart(2, '0')}
                </span>
              </Link>
            ))}
            {!loading && actionItems.length === 0 && <EmptyState label="Nothing requires attention" />}
          </div>
        </div>
      </div>

      {/* ── ROW 3: Statutory Compliance + Department Load ──────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 sm:gap-6 lg:gap-8">

        {/* Statutory Compliance — real IRAS/CPF submission status by kind */}
        <div className="xl:col-span-2 bg-white rounded-[2rem] border border-slate-100 shadow-card overflow-hidden">
          <div className="p-4 sm:p-6 lg:p-8 border-b border-slate-50">
            <SectionHeader title="Statutory Compliance" badge={payrollBadge} href="/payroll/iras-submissions" color="navy" />
          </div>
          <div className="p-4 sm:p-6 lg:p-8">
            {loading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {[1, 2, 3, 4].map((i) => <div key={i} className="h-14 bg-slate-50 rounded-2xl animate-pulse" />)}
              </div>
            ) : (stats?.iras?.length ?? 0) > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {stats!.iras.map((it) => {
                  const tone = irasTone(it.status, it.urgency);
                  return (
                    <div key={it.kind} className="flex items-center justify-between p-4 rounded-2xl bg-slate-50 border border-slate-100">
                      <div className="min-w-0">
                        <span className="text-[10px] font-bold text-slate-700 block truncate">{titleCase(it.kind)}</span>
                        {it.daysUntilDeadline != null && (
                          <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">
                            {it.daysUntilDeadline < 0 ? `${Math.abs(it.daysUntilDeadline)}d overdue` : `T-${it.daysUntilDeadline} days`}
                          </span>
                        )}
                      </div>
                      <span className="flex items-center gap-2 shrink-0">
                        <span className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} />
                        <span className={`text-[9px] font-black uppercase tracking-widest ${tone.txt}`}>{tone.label}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState label="No statutory submissions on record" />
            )}
          </div>
          <div className="px-8 pb-8 flex gap-4">
            <Link href="/payroll" className="flex-1 py-3 bg-indigo-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-700 shadow-primary transition-all active:scale-95 text-center">
              ⚡ Review &amp; Authorise Payroll
            </Link>
            <Link href="/payroll/iras-submissions" className="px-6 py-3 bg-white border border-slate-200 rounded-2xl text-[10px] font-black text-slate-500 uppercase tracking-widest hover:border-gold-300 hover:text-gold-600 transition-all">
              Submissions
            </Link>
          </div>
        </div>

        {/* Department Load donut (real) */}
        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-card p-6 lg:p-8">
          <SectionHeader title="Department Load" href="/employees" color="slate" />
          {loading ? (
            <div className="h-[132px] flex items-center justify-center">
              <div className="w-[132px] h-[132px] rounded-full border-[16px] border-slate-100 animate-pulse" />
            </div>
          ) : deptSegments.length ? (
            <div className="flex items-center gap-6">
              <Donut segments={deptSegments} centerLabel={String(stats?.activeEmployees ?? 0)} centerSub="Staff" />
              <Legend segments={deptSegments} />
            </div>
          ) : (
            <EmptyState label="No department data" />
          )}
        </div>
      </div>

      {/* ── ROW 4: Command Queue (live signals only) ──────────────────────── */}
      {(loading || queue.length > 0) && (
        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-card p-6 lg:p-8">
          <SectionHeader title="Command Queue" badge="Actions Due" color="amber" />
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[1, 2, 3, 4].map((i) => <div key={i} className="h-16 bg-slate-50 rounded-2xl animate-pulse" />)}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {queue.map((task, i) => (
                <Link
                  key={i}
                  href={task.path}
                  className={`flex items-center gap-4 p-4 rounded-2xl border transition-all group ${
                    task.urgent ? 'bg-gold-50/50 border-gold-100 hover:bg-gold-50' : 'bg-slate-50 border-slate-100 hover:bg-slate-100'
                  }`}
                >
                  <span className={`text-lg ${task.urgent ? 'text-gold-500' : 'text-slate-300'}`}>{task.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-black text-slate-900 uppercase tracking-tight truncate">{task.title}</p>
                    <p className={`text-[9px] font-black mt-1 uppercase tracking-widest truncate ${task.urgent ? 'text-gold-600' : 'text-slate-400'}`}>{task.sub}</p>
                  </div>
                  <span className="text-slate-300 group-hover:text-gold-600 transition-colors font-black">→</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── ROW 5: Quick Access Module Grid ───────────────────────────────── */}
      <div className="bg-white rounded-[2rem] border border-slate-100 shadow-card p-6 lg:p-8">
        <SectionHeader title="All Modules" badge="RBAC Enabled" color="navy" />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {[
            { name: 'Employees',    path: '/employees',     icon: '◈', color: 'hover:border-indigo-400 hover:bg-indigo-50' },
            { name: 'Payroll',      path: '/payroll',       icon: '◆', color: 'hover:border-indigo-400 hover:bg-indigo-50', highlight: true },
            { name: 'Leave',        path: '/leave',         icon: '◌', color: 'hover:border-gold-400 hover:bg-gold-50' },
            { name: 'Claims',       path: '/claims',        icon: '◫', color: 'hover:border-violet-400 hover:bg-violet-50' },
            { name: 'Attendance',   path: '/attendance',    icon: '◉', color: 'hover:border-sky-400 hover:bg-sky-50' },
            { name: 'Recruitment',  path: '/recruitment',   icon: '◇', color: 'hover:border-emerald-400 hover:bg-emerald-50' },
            { name: 'Performance',  path: '/performance',   icon: '▣', color: 'hover:border-violet-400 hover:bg-violet-50' },
            { name: 'Training',     path: '/training',      icon: '◑', color: 'hover:border-gold-400 hover:bg-gold-50' },
            { name: 'Reports',      path: '/reports',       icon: '▤', color: 'hover:border-emerald-400 hover:bg-emerald-50' },
            { name: 'Settings',     path: '/settings',      icon: '◎', color: 'hover:border-slate-400 hover:bg-slate-50' },
          ].map((mod) => (
            <Link
              key={mod.name}
              href={mod.path}
              className={`flex flex-col items-center gap-4 p-6 rounded-2xl border transition-all group cursor-pointer active:scale-95 ${
                mod.highlight ? 'bg-indigo-600 border-indigo-600 text-white shadow-primary' : `bg-white border-slate-100 ${mod.color}`
              }`}
            >
              <span className={`text-2xl transition-transform group-hover:scale-125 duration-300 ${mod.highlight ? 'text-white' : 'text-slate-400 group-hover:text-current'}`}>
                {mod.icon}
              </span>
              <span className={`text-[9px] font-black uppercase tracking-[0.2em] ${mod.highlight ? 'text-white' : 'text-slate-500 group-hover:text-slate-900'} transition-colors`}>
                {mod.name}
              </span>
            </Link>
          ))}
        </div>
      </div>

    </div>
  );
}
