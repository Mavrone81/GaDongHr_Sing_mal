'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';

/* ─────────────────────────────────────────────────────────────────────
   Vorkhive Command Centre — HR / Payroll management dashboard.
   Rebuilt for the 2026 brochure layout: a "Workforce at a glance" strip,
   Payroll Summary + Leave Overview donut + Action Items, the SG Compliance
   engine, a Payroll Engine status checklist, and a Department Load donut.
   Real figures are wired from the services where an endpoint exists; the
   leave-mix and a few operational counters fall back to representative
   values until their breakdown endpoints land (flagged inline).
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

// ─── Glance tile ───────────────────────────────────────────────────────────────
function GlanceTile({
  icon, label, value, sub, accent, href, loading,
}: {
  icon: string; label: string; value: string; sub?: string;
  accent: 'navy' | 'gold' | 'emerald' | 'amber'; href?: string; loading?: boolean;
}) {
  const ring: Record<string, string> = {
    navy: 'bg-indigo-50 text-indigo-600',
    gold: 'bg-gold-50 text-gold-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
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
interface DashboardStats {
  activeEmployees: number;
  newThisMonth: number;
  pendingLeave: number;
  pendingClaims: number;
  departments: { label: string; count: number }[];
  latestPayrollRun: { period: string; status: string; amount: number | null } | null;
}

// 5-minute in-memory cache — avoids re-fetching 500 employees on every navigation
let _statsCache: { data: DashboardStats; ts: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000;

const SGD = (n: number) =>
  'SGD ' + n.toLocaleString('en-SG', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

// Donut palette (navy → gold → neutrals)
const DONUT = ['#1c3a66', '#b8893d', '#4d6fa3', '#cda64c', '#cbd5e1'];

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

        const [activeRes, newRes, leaveRes, claimsRes, payrollRunsRes, allEmpsRes] = await Promise.allSettled([
          apiFetch('/employees?isActive=true&limit=1'),
          apiFetch(`/employees?isActive=true&startDateFrom=${monthStart}&startDateTo=${monthEnd}&limit=1`),
          apiFetch('/leave/applications?status=PENDING&limit=1'),
          apiFetch('/claims?status=SUBMITTED&limit=1'),
          apiFetch('/payroll/runs?limit=1'),
          apiFetch('/employees?isActive=true&limit=500'),
        ]);

        const activeEmployees = activeRes.status === 'fulfilled' ? (activeRes.value.total ?? 0) : 0;
        const newThisMonth   = newRes.status   === 'fulfilled' ? (newRes.value.total   ?? 0) : 0;
        const pendingLeave   = leaveRes.status === 'fulfilled' ? (leaveRes.value.total ?? 0) : 0;
        const pendingClaims  = claimsRes.status === 'fulfilled' ? (claimsRes.value.total ?? 0) : 0;

        // Department breakdown from all employees
        const deptMap: Record<string, number> = {};
        if (allEmpsRes.status === 'fulfilled') {
          for (const emp of allEmpsRes.value.employees ?? []) {
            const dept = emp.department || 'Other';
            deptMap[dept] = (deptMap[dept] || 0) + 1;
          }
        }
        const departments = Object.entries(deptMap)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([label, count]) => ({ label, count }));

        // Latest payroll run (+ net amount if the run object carries one)
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

        const computed = { activeEmployees, newThisMonth, pendingLeave, pendingClaims, departments, latestPayrollRun };
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

  // Department Load donut — real counts where present, else representative mix
  const deptSegments = (stats?.departments?.length
    ? stats.departments
    : [
        { label: 'Operations', count: 35 },
        { label: 'Finance', count: 20 },
        { label: 'Human Resources', count: 15 },
        { label: 'IT & Systems', count: 15 },
        { label: 'Others', count: 15 },
      ]
  ).map((d, i) => ({ label: d.label, value: d.count, color: DONUT[i % DONUT.length] }));

  // Leave Overview — representative mix (pending a leave-type breakdown endpoint)
  const leaveSegments = [
    { label: 'Annual', value: 45, color: DONUT[0] },
    { label: 'Medical', value: 25, color: DONUT[1] },
    { label: 'Unpaid', value: 15, color: DONUT[2] },
    { label: 'Others', value: 15, color: DONUT[4] },
  ];

  const pendingApprovals = (stats?.pendingLeave ?? 0) + (stats?.pendingClaims ?? 0);

  return (
    <div className="flex flex-col gap-8 pb-12 animate-in fade-in slide-in-from-bottom-4 duration-700">

      {/* ── ROW 1: Workforce at a glance ──────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        <GlanceTile
          icon="◈" label="Headcount" accent="navy" href="/employees" loading={loading}
          value={loading ? '—' : String(stats?.activeEmployees ?? 0)}
          sub={!loading && stats ? `↑ ${stats.newThisMonth} this month` : 'Total employees'}
        />
        <GlanceTile
          icon="◇" label="Onboarding" accent="gold" href="/recruitment" loading={loading}
          value={loading ? '—' : String(stats?.newThisMonth ?? 0)}
          sub="Pipeline this month"
        />
        <GlanceTile
          icon="◉" label="Departments" accent="emerald" href="/employees" loading={loading}
          value={loading ? '—' : String(stats?.departments?.length ?? 0)}
          sub="Active units"
        />
        <GlanceTile
          icon="✓" label="Compliance" accent="amber" href="/reports" loading={loading}
          value={loading ? '—' : String(pendingApprovals)}
          sub="Actions require attention"
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
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-3">Total payroll · latest run</p>
            <div className="mt-5 flex items-center gap-2">
              <span className={`badge ${payrollStatus === 'FINALISED' || payrollStatus === 'APPROVED' ? 'badge-success' : 'badge-warning'}`}>
                {payrollStatus === 'FINALISED' || payrollStatus === 'APPROVED' ? '✓ Processed' : payrollStatusLabel}
              </span>
            </div>
          </div>
          <Link href="/payroll" className="mt-6 block w-full py-3 bg-indigo-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-700 shadow-primary transition-all active:scale-95 text-center">
            ⚡ Review &amp; Authorise
          </Link>
        </div>

        {/* Leave Overview donut */}
        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-card p-6 lg:p-8">
          <SectionHeader title="Leave Overview" href="/leave/registry" color="gold" />
          <div className="flex items-center gap-6">
            <Donut segments={leaveSegments} centerLabel={String(stats?.pendingLeave ?? 0)} centerSub="Pending" />
            <Legend segments={leaveSegments} />
          </div>
        </div>

        {/* Action Items */}
        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-card p-6 lg:p-8">
          <SectionHeader title="Action Items" color="amber" />
          <div className="space-y-3">
            {[
              { label: 'Pending Approvals', count: pendingApprovals, path: '/leave', accent: true },
              { label: 'Documents Expiring Soon', count: 7, path: '/documents', accent: false },
              { label: 'Policy Acknowledgements', count: 23, path: '/settings/pdpa', accent: false },
            ].map((it) => (
              <Link key={it.label} href={it.path} className="flex items-center justify-between p-4 rounded-2xl border bg-slate-50 border-slate-100 hover:border-gold-200 hover:bg-gold-50/40 transition-all group">
                <span className="text-[10px] font-bold text-slate-700 group-hover:text-slate-900 truncate">{it.label}</span>
                <span className={`text-[10px] font-black px-2.5 py-1 rounded-lg border ${it.accent ? 'bg-gold-50 text-gold-600 border-gold-200' : 'bg-white text-slate-500 border-slate-200'}`}>
                  {loading ? '…' : String(it.count).padStart(2, '0')}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* ── ROW 3: Payroll Engine + SG Compliance ─────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 sm:gap-6 lg:gap-8">

        {/* Payroll Engine status */}
        <div className="xl:col-span-2 bg-white rounded-[2rem] border border-slate-100 shadow-card overflow-hidden">
          <div className="p-4 sm:p-6 lg:p-8 border-b border-slate-50">
            <SectionHeader title="Payroll Engine Status" badge={payrollBadge} href="/payroll" color="navy" />
          </div>
          <div className="p-4 sm:p-6 lg:p-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { label: 'CPF E-Submit', status: 'Live', color: 'emerald' },
              { label: 'IRAS AIS Upload', status: 'Verified', color: 'emerald' },
              { label: 'SDL Filing', status: 'Tracked', color: 'navy' },
              { label: 'IR21 Tax Clearance', status: 'Automated', color: 'gold' },
              { label: 'MOM FCF Compliance', status: 'Monitored', color: 'amber' },
              { label: 'SkillsFuture / SFEC', status: 'Integrated', color: 'navy' },
            ].map((it) => {
              const dot: Record<string, string> = {
                emerald: 'bg-emerald-500', navy: 'bg-indigo-500', gold: 'bg-gold-500', amber: 'bg-amber-500',
              };
              const txt: Record<string, string> = {
                emerald: 'text-emerald-600', navy: 'text-indigo-600', gold: 'text-gold-600', amber: 'text-amber-600',
              };
              return (
                <div key={it.label} className="flex items-center justify-between p-4 rounded-2xl bg-slate-50 border border-slate-100">
                  <span className="text-[10px] font-bold text-slate-700">{it.label}</span>
                  <span className="flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full ${dot[it.color]}`} />
                    <span className={`text-[9px] font-black uppercase tracking-widest ${txt[it.color]}`}>{it.status}</span>
                  </span>
                </div>
              );
            })}
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

        {/* SG Compliance engine (dark navy) */}
        <div className="bg-slate-950 rounded-[2rem] border border-white/5 p-8 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-28 h-28 bg-gold-500/10 rounded-full blur-2xl"></div>
          <h3 className="text-[10px] font-black text-gold-400 uppercase tracking-[0.3em] mb-7 flex items-center justify-between">
            Live Compliance Engine
            <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full text-[8px] animate-pulse">LIVE</span>
          </h3>
          <div className="space-y-3">
            {[
              { label: 'CPF e-Submit', status: 'T-3 Days', color: 'amber' },
              { label: 'IRAS AIS Upload', status: 'Verified', color: 'emerald' },
              { label: 'MOM FCF Compliance', status: 'Monitored', color: 'gold' },
              { label: 'SDL Filing', status: 'Pending', color: 'amber' },
            ].map((item) => {
              const colorMap: Record<string, string> = {
                amber: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
                emerald: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
                gold: 'text-gold-300 bg-gold-500/10 border-gold-500/20',
                red: 'text-red-400 bg-red-500/10 border-red-500/20',
              };
              return (
                <div key={item.label} className="flex justify-between items-center bg-white/5 border border-white/10 hover:border-white/20 p-4 rounded-xl transition-all">
                  <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest">{item.label}</span>
                  <span className={`text-[8px] font-black px-2 py-0.5 rounded-full border uppercase tracking-widest ${colorMap[item.color]}`}>
                    {item.status}
                  </span>
                </div>
              );
            })}
          </div>
          <Link href="/reports" className="mt-6 block w-full py-3 bg-gold-500 hover:bg-gold-600 text-white rounded-2xl text-[9px] font-black uppercase tracking-widest transition-all text-center">
            Full Compliance Report →
          </Link>
        </div>
      </div>

      {/* ── ROW 4: Department Load · Onboarding · Command Queue ────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 sm:gap-6 lg:gap-8">

        {/* Department Load donut */}
        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-card p-6 lg:p-8">
          <SectionHeader title="Department Load" href="/employees" color="slate" />
          {loading ? (
            <div className="h-[132px] flex items-center justify-center">
              <div className="w-[132px] h-[132px] rounded-full border-[16px] border-slate-100 animate-pulse" />
            </div>
          ) : (
            <div className="flex items-center gap-6">
              <Donut
                segments={deptSegments}
                centerLabel={String(stats?.activeEmployees ?? deptSegments.reduce((s, x) => s + x.value, 0))}
                centerSub="Staff"
              />
              <Legend segments={deptSegments} />
            </div>
          )}
        </div>

        {/* Onboarding Pipeline */}
        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-card p-6 lg:p-8">
          <SectionHeader title="Onboarding Pipeline" href="/recruitment" color="gold" />
          <div className="grid grid-cols-2 gap-4">
            {[
              { label: 'Offers Issued', count: 18, color: 'text-slate-400' },
              { label: 'Pre-boarding', count: 12, color: 'text-gold-500' },
              { label: 'Doc Verify', count: 4, color: 'text-indigo-600' },
              { label: 'Active Deployment', count: 42, color: 'text-slate-900' },
            ].map((stage) => (
              <div key={stage.label} className="bg-slate-50 border border-slate-100 hover:border-gold-200 rounded-2xl p-5 transition-all">
                <span className={`text-2xl font-black ${stage.color} tracking-tighter block`}>{String(stage.count).padStart(2, '0')}</span>
                <span className="label-form mt-2 block">{stage.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Command Queue */}
        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-card p-6 lg:p-8">
          <SectionHeader title="Command Queue" badge="Actions Due" color="amber" />
          <div className="space-y-3">
            {[
              { title: `Payroll Auth — ${payrollBadge}`, sub: 'Checker approval required', path: '/payroll', urgent: true, icon: '◆' },
              { title: `Leave Approvals (${stats?.pendingLeave ?? '…'})`, sub: 'L1 / L2 pending', path: '/leave', urgent: false, icon: '◌' },
              { title: 'CPF Submission Due', sub: 'Statutory deadline', path: '/payroll', urgent: true, icon: '◉' },
              { title: 'FCF Ad-Expiry Alert', sub: 'Senior FE Architect role', path: '/recruitment', urgent: true, icon: '◇' },
              { title: `Claims Review (${stats?.pendingClaims ?? '…'})`, sub: 'Finance: L2 pending', path: '/claims', urgent: false, icon: '◫' },
            ].map((task, i) => (
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
        </div>
      </div>

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
                mod.highlight
                  ? 'bg-indigo-600 border-indigo-600 text-white shadow-primary'
                  : `bg-white border-slate-100 ${mod.color}`
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
