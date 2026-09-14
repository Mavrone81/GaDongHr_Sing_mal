'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { PageHeader, Card, CardHeader, Stat, Badge, Icon, EmptyState, type BadgeTone, type IconName } from '@/components/ui';

/* ─────────────────────────────────────────────────────────────────────
   GaDongHR home for HR / payroll roles.
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
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={segments.map((s) => `${s.label} ${Math.round((s.value / total) * 100)}%`).join(', ')}>
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
          {centerLabel && <span className="text-[22px] font-extrabold text-ink tracking-[-0.02em] leading-none tabular-nums">{centerLabel}</span>}
          {centerSub && <span className="text-xs text-muted mt-1">{centerSub}</span>}
        </div>
      )}
    </div>
  );
}

function Legend({ segments }: { segments: { label: string; value: number; color: string }[] }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <ul className="flex flex-col gap-2 flex-1 min-w-0">
      {segments.map((seg) => (
        <li key={seg.label} className="flex items-center gap-2.5 text-[13px]">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: seg.color }} aria-hidden="true" />
          <span className="text-ink truncate flex-1">{seg.label}</span>
          <span className="text-muted tabular-nums">{Math.round((seg.value / total) * 100)}%</span>
        </li>
      ))}
    </ul>
  );
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`bg-pill rounded-control animate-pulse ${className}`} aria-hidden="true" />;
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

const SGD = (n: number) => 'S$' + n.toLocaleString('en-SG', { maximumFractionDigits: 0 });
const titleCase = (s: string) =>
  s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (m) => m.toUpperCase());

// Donut series from the tokens; colour-mix gives the intermediate steps a
// six-series chart needs from three tokens.
const DONUT = [
  'var(--accent)',
  'var(--highlight)',
  'color-mix(in srgb, var(--accent) 55%, var(--paper))',
  'color-mix(in srgb, var(--highlight) 55%, var(--paper))',
  'var(--muted)',
  'var(--rule)',
];

// Map a real IRAS submission status to a Badge tone
function irasTone(status: string, urgency: string): { tone: BadgeTone; label: string } {
  if (status === 'ACKNOWLEDGED') return { tone: 'ok', label: 'Acknowledged' };
  if (status === 'REJECTED')     return { tone: 'danger', label: 'Rejected' };
  if (urgency === 'OVERDUE')     return { tone: 'danger', label: 'Overdue' };
  if (status === 'SUBMITTED')    return { tone: 'accent', label: 'Submitted' };
  if (urgency === 'DUE_SOON')    return { tone: 'warn', label: 'Due soon' };
  return { tone: 'neutral', label: titleCase(status || 'Draft') };
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function ManagementDashboard() {
  const { user } = useAuth();
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

  const monthLabel = new Date().toLocaleString('en-SG', { month: 'long' });
  const payrollBadge = stats?.latestPayrollRun?.period
    ? stats.latestPayrollRun.period
    : new Date().toLocaleString('default', { month: 'short', year: 'numeric' });

  const payrollStatus = stats?.latestPayrollRun?.status ?? 'N/A';
  const payrollStatusLabel =
    payrollStatus === 'PENDING' ? 'Pending approval' :
    payrollStatus === 'APPROVED' ? 'Approved' :
    payrollStatus === 'FINALISED' ? 'Finalised' :
    payrollStatus === 'DRAFT' ? 'Draft' : titleCase(payrollStatus);
  const payrollProcessed = payrollStatus === 'FINALISED' || payrollStatus === 'APPROVED';
  const payrollOpen = payrollStatus === 'PENDING' || payrollStatus === 'DRAFT';

  const deptSegments = (stats?.departments ?? []).map((d, i) => ({ label: d.label, value: d.count, color: DONUT[i % DONUT.length] }));
  const leaveSegments = (stats?.leaveByType ?? []).map((d, i) => ({ label: d.label, value: d.count, color: DONUT[i % DONUT.length] }));
  const leaveTotal = leaveSegments.reduce((s, x) => s + x.value, 0);

  // Needs your attention — derived purely from live signals
  const queue = [
    payrollOpen
      ? { title: `${payrollBadge} payroll needs approval`, sub: 'Checker approval before the GIRO file', path: '/payroll', urgent: true, icon: 'wallet' as IconName } : null,
    (stats?.pendingLeave ?? 0) > 0
      ? { title: `${stats?.pendingLeave} leave request${stats?.pendingLeave === 1 ? '' : 's'}`, sub: 'Awaiting approval', path: '/leave/registry', urgent: false, icon: 'calendar' as IconName } : null,
    (stats?.pendingClaims ?? 0) > 0
      ? { title: `${stats?.pendingClaims} claim${stats?.pendingClaims === 1 ? '' : 's'} to review`, sub: 'Submitted, not yet approved', path: '/claims/registry', urgent: false, icon: 'receipt' as IconName } : null,
    (stats?.irasDueCount ?? 0) > 0
      ? { title: `${stats?.irasDueCount} statutory filing${stats?.irasDueCount === 1 ? '' : 's'} due`, sub: 'CPF / IRAS within 60 days', path: '/payroll/iras-submissions', urgent: true, icon: 'alert' as IconName } : null,
    (stats?.docsOverdue ?? 0) > 0
      ? { title: `${stats?.docsOverdue} document${stats?.docsOverdue === 1 ? '' : 's'} overdue`, sub: 'e-sign requests past due', path: '/documents', urgent: false, icon: 'file' as IconName } : null,
  ].filter(Boolean) as { title: string; sub: string; path: string; urgent: boolean; icon: IconName }[];

  const firstName = user?.name?.split(' ')[0];

  return (
    <div className="flex flex-col gap-5 pb-8">
      <PageHeader
        title={firstName ? `${greeting()}, ${firstName}` : greeting()}
        subtitle={`Here is where ${monthLabel} payroll and your approvals stand.`}
        actions={
          <>
            <Link href="/employees" className="inline-flex items-center gap-2 h-10 px-4 rounded-control border border-rule bg-paper text-sm font-semibold text-ink hover:bg-pill"><Icon name="plus" size={16} strokeWidth={2} />Add employee</Link>
            <Link href="/payroll" className="inline-flex items-center gap-2 h-10 px-4 rounded-control border border-accent bg-accent text-sm font-semibold text-on-accent hover:opacity-95">{payrollOpen ? `Continue ${payrollBadge} payroll` : 'Open payroll'}<Icon name="arrowRight" size={16} strokeWidth={2} /></Link>
          </>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <Stat label="Headcount" value={loading ? <Skeleton className="h-8 w-16" /> : String(stats?.activeEmployees ?? 0)} note={loading ? '' : `${stats?.newThisMonth ?? 0} joined this month`} />
        <Stat
          label={`${payrollBadge} payroll`}
          value={loading ? <Skeleton className="h-8 w-28" /> : stats?.latestPayrollRun?.amount != null ? SGD(stats.latestPayrollRun.amount) : (stats?.latestPayrollRun ? payrollStatusLabel : '—')}
          note={loading ? '' : stats?.latestPayrollRun ? <Badge tone={payrollProcessed ? 'ok' : payrollOpen ? 'warn' : 'neutral'}>{payrollStatusLabel}</Badge> : 'No payroll run yet'}
        />
        <Stat label="Leave requests" value={loading ? <Skeleton className="h-8 w-10" /> : String(stats?.pendingLeave ?? 0)} note={loading ? '' : 'awaiting your approval'} />
        <Stat label="Claims" value={loading ? <Skeleton className="h-8 w-10" /> : String(stats?.pendingClaims ?? 0)} note={loading ? '' : 'submitted, awaiting review'} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Left 2/3 */}
        <div className="xl:col-span-2 flex flex-col gap-4 min-w-0">
          <Card padding="px-[22px] pt-5 pb-1.5">
            <CardHeader title="Statutory deadlines" caption="Latest submission per filing, from IRAS and CPF records." action={<Link href="/payroll/iras-submissions" className="hover:underline">View all</Link>} />
            {loading ? (
              <div className="flex flex-col gap-3 pb-4">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</div>
            ) : (stats?.iras?.length ?? 0) > 0 ? (
              <ul>
                {stats!.iras.map((it) => {
                  const t = irasTone(it.status, it.urgency);
                  const days = it.daysUntilDeadline;
                  return (
                    <li key={it.kind} className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-4 items-center py-3 border-t border-rule">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-ink truncate">{titleCase(it.kind)}</div>
                        <div className="text-[13px] text-muted">{days == null ? 'No deadline on record' : days < 0 ? `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue` : days === 0 ? 'Due today' : `Due in ${days} day${days === 1 ? '' : 's'}`}</div>
                      </div>
                      <Badge tone={t.tone}>{t.label}</Badge>
                      <Link href="/payroll/iras-submissions" className="text-muted hover:text-ink" aria-label={`Open ${titleCase(it.kind)}`}><Icon name="chevronRight" size={16} /></Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState icon="shield" title="No statutory submissions on record" description="Filings appear here once a payroll run has been finalised." className="py-8" />
            )}
          </Card>

          <Card>
            <CardHeader title={`${payrollBadge} payroll`} action={<Link href="/payroll" className="hover:underline">Open</Link>} />
            {loading ? (
              <Skeleton className="h-10 w-48" />
            ) : stats?.latestPayrollRun ? (
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                <div>
                  <div className="text-[26px] font-extrabold tracking-[-0.02em] leading-none text-ink tabular-nums">{stats.latestPayrollRun.amount != null ? SGD(stats.latestPayrollRun.amount) : payrollBadge}</div>
                  <div className="text-[13px] text-muted mt-1.5">{stats.latestPayrollRun.amount != null ? 'Latest run total' : 'Latest run'}</div>
                </div>
                <Badge tone={payrollProcessed ? 'ok' : payrollOpen ? 'warn' : 'neutral'}>{payrollStatusLabel}</Badge>
                <p className="w-full text-[13px] text-muted">{payrollOpen ? 'Needs a second approver before the GIRO file is generated.' : payrollProcessed ? 'Approved. Payslips and statutory files can be issued from the payroll page.' : ''}</p>
              </div>
            ) : (
              <EmptyState icon="wallet" title="No payroll run yet" description="Start the first run from the payroll page." className="py-6" />
            )}
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader title="Leave overview" caption="Applications by type" action={<Link href="/leave/registry" className="hover:underline">Registry</Link>} />
              {loading ? <Skeleton className="h-[132px]" /> : leaveSegments.length ? (
                <div className="flex items-center gap-5"><Donut segments={leaveSegments} centerLabel={String(leaveTotal)} centerSub="requests" /><Legend segments={leaveSegments} /></div>
              ) : <EmptyState icon="calendar" title="No leave records" className="py-6" />}
            </Card>
            <Card>
              <CardHeader title="Department load" caption="Active employees by department" action={<Link href="/employees" className="hover:underline">Employees</Link>} />
              {loading ? <Skeleton className="h-[132px]" /> : deptSegments.length ? (
                <div className="flex items-center gap-5"><Donut segments={deptSegments} centerLabel={String(stats?.activeEmployees ?? 0)} centerSub="staff" /><Legend segments={deptSegments} /></div>
              ) : <EmptyState icon="users" title="No department data" className="py-6" />}
            </Card>
          </div>
        </div>

        {/* Right 1/3 */}
        <div className="flex flex-col gap-4 min-w-0">
          <Card padding="px-[22px] pt-5 pb-2">
            <CardHeader title="Needs your attention" />
            {loading ? (
              <div className="flex flex-col gap-3 pb-4">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</div>
            ) : queue.length === 0 ? (
              <EmptyState icon="check" title="Nothing needs you right now" className="py-6" />
            ) : (
              <ul>
                {queue.map((task) => (
                  <li key={task.path + task.title} className="border-t border-rule">
                    <Link href={task.path} className="flex items-center gap-3 py-[11px] -mx-2 px-2 rounded-control hover:bg-page">
                      <span className={`flex items-center justify-center w-[34px] h-[34px] rounded-control shrink-0 ${task.urgent ? 'bg-warn-bg text-warn' : 'bg-pill text-accent'}`}><Icon name={task.icon} size={17} /></span>
                      <span className="flex flex-col gap-0.5 flex-1 min-w-0">
                        <span className="text-sm font-semibold text-ink truncate">{task.title}</span>
                        <span className="text-[12.5px] text-muted truncate">{task.sub}</span>
                      </span>
                      <Icon name="chevronRight" size={16} className="text-faint" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Quick links" />
            <div className="grid grid-cols-2 gap-2">
              {([
                ['Employees', '/employees', 'users'], ['Payroll', '/payroll', 'wallet'], ['Leave', '/leave/registry', 'calendar'], ['Claims', '/claims/registry', 'receipt'],
                ['Attendance', '/attendance/registry', 'clock'], ['Reports', '/reports', 'chart'],
              ] as [string, string, IconName][]).map(([name, path, icon]) => (
                <Link key={path} href={path} className="flex items-center gap-2.5 h-11 px-3 rounded-control border border-rule text-sm font-semibold text-ink hover:bg-page">
                  <Icon name={icon} size={17} className="text-accent" />{name}
                </Link>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
