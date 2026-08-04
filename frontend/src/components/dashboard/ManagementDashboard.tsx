'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';

/* ─────────────────────────────────────────────────────────────────────
   GaDongHR Command Centre — HR / Payroll management dashboard.
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
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--rule)" strokeWidth={thickness} />
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
          {centerLabel && <span className="text-xl font-black text-ink tracking-tighter leading-none">{centerLabel}</span>}
          {centerSub && <span className="text-[8px] font-black text-muted uppercase tracking-widest mt-1">{centerSub}</span>}
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
          <span className="w-2.5 h-2.5 shrink-0" style={{ background: seg.color }} />
          <span className="text-[10px] font-bold text-ink truncate flex-1">{seg.label}</span>
          <span className="text-[10px] font-black text-ink">{Math.round((seg.value / total) * 100)}%</span>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center py-10">
      <p className="text-[9px] font-black text-muted uppercase tracking-widest text-center">{label}</p>
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
    navy: 'bg-page text-accent', gold: 'bg-page text-highlight',
    emerald: 'bg-page text-accent', amber: 'bg-page text-ink',
  };
  const subColor: Record<string, string> = {
    navy: 'text-accent', gold: 'text-highlight', emerald: 'text-accent', amber: 'text-ink',
  };
  const Wrapper = href ? Link : 'div';
  return (
    <Wrapper href={href as string} className="bg-paper border border-rule p-5 flex flex-col gap-3 group hover:border-highlight transition-all">
      <div className="flex items-center justify-between">
        <div className={`w-9 h-9  flex items-center justify-center text-base ${ring[accent]}`}>{icon}</div>
        <span className="text-[8px] font-black text-muted uppercase tracking-[0.2em]">{label}</span>
      </div>
      {loading ? (
        <div className="h-8 w-16 bg-page animate-pulse" />
      ) : (
        <h3 className="text-3xl font-black text-ink tracking-tighter leading-none">{value}</h3>
      )}
      {sub && <p className={`text-[8px] font-black uppercase tracking-widest ${subColor[accent]}`}>{sub}</p>}
    </Wrapper>
  );
}

// ─── Section Header ───────────────────────────────────────────────────────────
function SectionHeader({ title, badge, href, color = 'navy' }: { title: string; badge?: string; href?: string; color?: string }) {
  const colorMap: Record<string, string> = {
    navy: 'bg-accent', gold: 'bg-highlight', emerald: 'bg-accent',
    amber: 'bg-highlight', red: 'bg-ink', slate: 'bg-muted',
  };
  return (
    <div className="flex items-center justify-between mb-6">
      <div className="flex items-center gap-4">
        <div className={`w-1.5 h-8 ${colorMap[color] ?? colorMap.navy} `}></div>
        <h3 className="text-[11px] font-black text-ink uppercase tracking-[0.25em]">{title}</h3>
        {badge && <span className="text-[8px] font-black px-2.5 py-1 bg-page border border-highlight text-highlight uppercase tracking-widest">{badge}</span>}
      </div>
      {href && (
        <Link href={href} className="label-form hover:text-highlight transition-colors flex items-center gap-2">
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
// Donut series from the tokens. These were frozen hexes from the retired 2026
// navy/gold palette, so the chart kept rendering the old brand on a converted
// page — and being SVG fills, no class-based check could see them. Colour-mix
// gives the intermediate steps a six-series chart needs from three tokens.
const DONUT = [
  'var(--accent)',
  'var(--highlight)',
  'color-mix(in srgb, var(--accent) 55%, var(--paper))',
  'color-mix(in srgb, var(--highlight) 55%, var(--paper))',
  'var(--muted)',
  'var(--rule)',
];

// Map a real IRAS submission status to a badge tone
function irasTone(status: string, urgency: string) {
  if (status === 'ACKNOWLEDGED') return { dot: 'bg-accent', txt: 'text-accent', label: 'Acknowledged' };
  if (status === 'REJECTED')     return { dot: 'bg-ink',     txt: 'text-ink',     label: 'Rejected' };
  if (urgency === 'OVERDUE')     return { dot: 'bg-ink',     txt: 'text-ink',     label: 'Overdue' };
  if (status === 'SUBMITTED')    return { dot: 'bg-accent',  txt: 'text-accent',  label: 'Submitted' };
  if (urgency === 'DUE_SOON')    return { dot: 'bg-highlight',   txt: 'text-ink',   label: 'Due soon' };
  return { dot: 'bg-muted', txt: 'text-muted', label: titleCase(status || 'Draft') };
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
        <div className="bg-paper border border-rule p-6 lg:p-8 flex flex-col">
          <SectionHeader title="Payroll Summary" badge={payrollBadge} href="/payroll" color="navy" />
          <div className="flex-1 flex flex-col justify-center">
            {loading ? (
              <div className="h-9 w-40 bg-page animate-pulse" />
            ) : (
              <h3 className="text-3xl font-black text-ink tracking-tighter leading-none">
                {stats?.latestPayrollRun?.amount != null ? SGD(stats.latestPayrollRun.amount) : payrollBadge}
              </h3>
            )}
            <p className="text-[9px] font-black text-muted uppercase tracking-widest mt-3">
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
          <Link href="/payroll" className="mt-6 block w-full py-3 bg-accent text-paper text-[10px] font-black uppercase tracking-widest hover:bg-accent transition-all active:scale-95 text-center">
            ⚡ Review &amp; Authorise
          </Link>
        </div>

        {/* Leave Overview donut */}
        <div className="bg-paper border border-rule p-6 lg:p-8">
          <SectionHeader title="Leave Overview" href="/leave/registry" color="gold" />
          {loading ? (
            <div className="h-[132px] flex items-center justify-center">
              <div className="w-[132px] h-[132px] border-[16px] border-rule animate-pulse" />
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
        <div className="bg-paper border border-rule p-6 lg:p-8">
          <SectionHeader title="Action Items" color="amber" />
          <div className="space-y-3">
            {actionItems.map((it) => (
              <Link key={it.label} href={it.path} className="flex items-center justify-between p-4 border bg-page border-rule hover:border-highlight hover:bg-page/40 transition-all group">
                <span className="text-[10px] font-bold text-ink group-hover:text-ink truncate">{it.label}</span>
                <span className={`text-[10px] font-black px-2.5 py-1  border ${it.accent ? 'bg-page text-highlight border-highlight' : 'bg-paper text-muted border-rule'}`}>
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
        <div className="xl:col-span-2 bg-paper border border-rule overflow-hidden">
          <div className="p-4 sm:p-6 lg:p-8 border-b border-rule">
            <SectionHeader title="Statutory Compliance" badge={payrollBadge} href="/payroll/iras-submissions" color="navy" />
          </div>
          <div className="p-4 sm:p-6 lg:p-8">
            {loading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {[1, 2, 3, 4].map((i) => <div key={i} className="h-14 bg-page animate-pulse" />)}
              </div>
            ) : (stats?.iras?.length ?? 0) > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {stats!.iras.map((it) => {
                  const tone = irasTone(it.status, it.urgency);
                  return (
                    <div key={it.kind} className="flex items-center justify-between p-4 bg-page border border-rule">
                      <div className="min-w-0">
                        <span className="text-[10px] font-bold text-ink block truncate">{titleCase(it.kind)}</span>
                        {it.daysUntilDeadline != null && (
                          <span className="text-[8px] font-black text-muted uppercase tracking-widest">
                            {it.daysUntilDeadline < 0 ? `${Math.abs(it.daysUntilDeadline)}d overdue` : `T-${it.daysUntilDeadline} days`}
                          </span>
                        )}
                      </div>
                      <span className="flex items-center gap-2 shrink-0">
                        <span className={`w-1.5 h-1.5  ${tone.dot}`} />
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
            <Link href="/payroll" className="flex-1 py-3 bg-accent text-paper text-[10px] font-black uppercase tracking-widest hover:bg-accent transition-all active:scale-95 text-center">
              ⚡ Review &amp; Authorise Payroll
            </Link>
            <Link href="/payroll/iras-submissions" className="px-6 py-3 bg-paper border border-rule text-[10px] font-black text-muted uppercase tracking-widest hover:border-highlight hover:text-highlight transition-all">
              Submissions
            </Link>
          </div>
        </div>

        {/* Department Load donut (real) */}
        <div className="bg-paper border border-rule p-6 lg:p-8">
          <SectionHeader title="Department Load" href="/employees" color="slate" />
          {loading ? (
            <div className="h-[132px] flex items-center justify-center">
              <div className="w-[132px] h-[132px] border-[16px] border-rule animate-pulse" />
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
        <div className="bg-paper border border-rule p-6 lg:p-8">
          <SectionHeader title="Command Queue" badge="Actions Due" color="amber" />
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[1, 2, 3, 4].map((i) => <div key={i} className="h-16 bg-page animate-pulse" />)}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {queue.map((task, i) => (
                <Link
                  key={i}
                  href={task.path}
                  className={`flex items-center gap-4 p-4  border transition-all group ${
                    task.urgent ? 'bg-page/50 border-highlight hover:bg-page' : 'bg-page border-rule hover:bg-page'
                  }`}
                >
                  <span className={`text-lg ${task.urgent ? 'text-highlight' : 'text-muted'}`}>{task.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-black text-ink uppercase tracking-tight truncate">{task.title}</p>
                    <p className={`text-[9px] font-black mt-1 uppercase tracking-widest truncate ${task.urgent ? 'text-highlight' : 'text-muted'}`}>{task.sub}</p>
                  </div>
                  <span className="text-muted group-hover:text-highlight transition-colors font-black">→</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── ROW 5: Quick Access Module Grid ───────────────────────────────── */}
      <div className="bg-paper border border-rule p-6 lg:p-8">
        <SectionHeader title="All Modules" badge="RBAC Enabled" color="navy" />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {[
            { name: 'Employees',    path: '/employees',     icon: '◈', color: 'hover:border-accent hover:bg-page' },
            { name: 'Payroll',      path: '/payroll',       icon: '◆', color: 'hover:border-accent hover:bg-page', highlight: true },
            { name: 'Leave',        path: '/leave',         icon: '◌', color: 'hover:border-highlight hover:bg-page' },
            { name: 'Claims',       path: '/claims',        icon: '◫', color: 'hover:border-accent hover:bg-page' },
            { name: 'Attendance',   path: '/attendance',    icon: '◉', color: 'hover:border-accent hover:bg-page' },
            { name: 'Recruitment',  path: '/recruitment',   icon: '◇', color: 'hover:border-accent hover:bg-page' },
            { name: 'Performance',  path: '/performance',   icon: '▣', color: 'hover:border-accent hover:bg-page' },
            { name: 'Training',     path: '/training',      icon: '◑', color: 'hover:border-highlight hover:bg-page' },
            { name: 'Reports',      path: '/reports',       icon: '▤', color: 'hover:border-accent hover:bg-page' },
            { name: 'Settings',     path: '/settings',      icon: '◎', color: 'hover:border-rule hover:bg-page' },
          ].map((mod) => (
            <Link
              key={mod.name}
              href={mod.path}
              className={`flex flex-col items-center gap-4 p-6  border transition-all group cursor-pointer active:scale-95 ${
                mod.highlight ? 'bg-accent border-accent text-paper' : `bg-paper border-rule ${mod.color}`
              }`}
            >
              <span className={`text-2xl transition-transform group-hover:scale-125 duration-300 ${mod.highlight ? 'text-paper' : 'text-muted group-hover:text-current'}`}>
                {mod.icon}
              </span>
              <span className={`text-[9px] font-black uppercase tracking-[0.2em] ${mod.highlight ? 'text-paper' : 'text-muted group-hover:text-ink'} transition-colors`}>
                {mod.name}
              </span>
            </Link>
          ))}
        </div>
      </div>

    </div>
  );
}
