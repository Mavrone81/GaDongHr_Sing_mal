'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';

// ─── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({
  label, value, sub, accent = 'indigo', trend, href, loading
}: {
  label: string; value: string; sub?: string; accent?: string;
  trend?: { dir: 'up' | 'down'; val: string }; href?: string; loading?: boolean;
}) {
  const Wrapper = href ? Link : 'div';
  return (
    <Wrapper href={href as string} className="bg-white rounded-[1.75rem] border border-slate-100 shadow-2xl shadow-indigo-500/5 p-7 flex flex-col gap-5 group hover:border-indigo-200 transition-all duration-300 relative overflow-hidden">
      <div className="absolute top-0 right-0 w-20 h-20 bg-indigo-500/3 rounded-full blur-2xl opacity-0 group-hover:opacity-100 transition-opacity"></div>
      <p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.3em]">{label}</p>
      <div className="flex items-end gap-3">
        {loading ? (
          <div className="h-9 w-16 bg-slate-100 rounded-xl animate-pulse"></div>
        ) : (
          <h3 className="text-3xl font-black text-slate-900 tracking-tighter leading-none">{value}</h3>
        )}
        {!loading && trend && (
          <span className={`text-[9px] font-black px-2 py-0.5 rounded-full mb-1 ${trend.dir === 'up' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-red-50 text-red-600 border border-red-100'}`}>
            {trend.dir === 'up' ? '↑' : '↓'} {trend.val}
          </span>
        )}
      </div>
      {sub && <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">{sub}</p>}
    </Wrapper>
  );
}

// ─── Section Header ───────────────────────────────────────────────────────────
function SectionHeader({ title, badge, href, color = 'indigo' }: { title: string; badge?: string; href?: string; color?: string }) {
  const colorMap: Record<string, string> = {
    indigo: 'bg-indigo-600', emerald: 'bg-emerald-500', amber: 'bg-amber-500',
    violet: 'bg-violet-600', red: 'bg-red-500', slate: 'bg-slate-700',
  };
  return (
    <div className="flex items-center justify-between mb-6">
      <div className="flex items-center gap-4">
        <div className={`w-1.5 h-8 ${colorMap[color]} rounded-full`}></div>
        <h3 className="text-[11px] font-black text-slate-900 uppercase tracking-[0.25em]">{title}</h3>
        {badge && <span className="text-[8px] font-black px-2.5 py-1 bg-indigo-50 border border-indigo-100 text-indigo-600 rounded-full uppercase tracking-widest">{badge}</span>}
      </div>
      {href && (
        <Link href={href} className="text-[9px] font-black text-slate-400 uppercase tracking-widest hover:text-indigo-600 transition-colors flex items-center gap-2">
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
  latestPayrollRun: { period: string; status: string } | null;
}

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  const cookie = document.cookie.split('; ').find(r => r.startsWith('vorkhive_token='));
  return cookie ? cookie.split('=').slice(1).join('=') : null;
}

function getApiBase(): string {
  if (typeof window === 'undefined') return API;
  return process.env.NEXT_PUBLIC_API_URL || `http://${window.location.hostname}:4000/api`;
}

async function apiFetch(path: string) {
  const token = getToken();
  const res = await fetch(`${getApiBase()}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json();
}

export default function ManagementDashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
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

        // Latest payroll run
        let latestPayrollRun = null;
        if (payrollRunsRes.status === 'fulfilled') {
          const runs = payrollRunsRes.value.runs ?? payrollRunsRes.value ?? [];
          const run = Array.isArray(runs) ? runs[0] : null;
          if (run) {
            latestPayrollRun = {
              period: run.period || run.periodLabel || '',
              status: run.status || 'UNKNOWN',
            };
          }
        }

        setStats({ activeEmployees, newThisMonth, pendingLeave, pendingClaims, departments, latestPayrollRun });
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

  const payrollStatusColor =
    payrollStatus === 'PENDING' ? 'amber' :
    payrollStatus === 'FINALISED' ? 'emerald' :
    payrollStatus === 'APPROVED' ? 'indigo' : 'slate';

  const deptColors = ['bg-slate-950', 'bg-indigo-600', 'bg-indigo-300', 'bg-slate-400', 'bg-slate-200'];

  const maxDeptCount = stats?.departments?.[0]?.count || 1;

  return (
    <div className="flex flex-col gap-8 pb-12 animate-in fade-in slide-in-from-bottom-4 duration-700">

      {/* ── ROW 1: Headline KPIs ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          label="Active Workforce"
          value={loading ? '—' : String(stats?.activeEmployees ?? 0)}
          sub="Employees on duty"
          accent="slate"
          trend={!loading && stats ? { dir: 'up', val: `${stats.newThisMonth} this month` } : undefined}
          href="/employees"
          loading={loading}
        />
        <StatCard
          label="Monthly Payroll"
          value={loading ? '—' : payrollBadge}
          sub={payrollStatusLabel}
          accent="indigo"
          href="/payroll"
          loading={loading}
        />
        <StatCard
          label="Leave Pending"
          value={loading ? '—' : String(stats?.pendingLeave ?? 0)}
          sub="Awaiting L1 / L2 Approval"
          accent="amber"
          href="/leave"
          loading={loading}
        />
        <StatCard
          label="Open Claims"
          value={loading ? '—' : String(stats?.pendingClaims ?? 0)}
          sub="Pending Finance Review"
          accent="violet"
          href="/claims"
          loading={loading}
        />
      </div>

      {/* ── ROW 2: Payroll + Compliance ───────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">

        {/* PAYROLL ENGINE PANEL */}
        <div className="xl:col-span-2 bg-white rounded-[2rem] border border-slate-100 shadow-2xl shadow-indigo-500/5 overflow-hidden">
          <div className="p-8 border-b border-slate-50">
            <SectionHeader title="Payroll Engine" badge={payrollBadge} href="/payroll" color="indigo" />
          </div>

          <div className="p-8 grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-indigo-50/60 p-6 rounded-[1.5rem] border border-indigo-100 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-16 h-16 bg-indigo-600/5 rounded-full blur-xl"></div>
              <p className="text-[9px] font-black text-indigo-500 uppercase tracking-widest mb-3">Net Payout</p>
              {loading ? (
                <div className="h-8 w-24 bg-indigo-100 rounded-lg animate-pulse"></div>
              ) : (
                <h4 className="text-2xl font-black text-slate-900 tracking-tighter">
                  {stats?.latestPayrollRun ? payrollBadge : 'N/A'}
                </h4>
              )}
              <p className="text-[8px] font-black text-indigo-400 uppercase tracking-widest mt-4">
                {stats?.activeEmployees ?? '—'} employees
              </p>
            </div>
            <div className="bg-emerald-50/60 p-6 rounded-[1.5rem] border border-emerald-100">
              <p className="text-[9px] font-black text-emerald-600 uppercase tracking-widest mb-3">Run Status</p>
              {loading ? (
                <div className="h-8 w-24 bg-emerald-100 rounded-lg animate-pulse"></div>
              ) : (
                <h4 className="text-lg font-black text-slate-900 tracking-tighter leading-tight">
                  {payrollStatusLabel}
                </h4>
              )}
              <p className="text-[8px] font-black text-emerald-400 uppercase tracking-widest mt-4">Latest Run</p>
            </div>
            <div className="bg-amber-50/60 p-6 rounded-[1.5rem] border border-amber-100">
              <p className="text-[9px] font-black text-amber-600 uppercase tracking-widest mb-3">Initiation</p>
              <div className="flex items-center gap-2 mt-1">
                <div className={`w-2 h-2 rounded-full animate-pulse ${
                  payrollStatusColor === 'amber' ? 'bg-amber-500' :
                  payrollStatusColor === 'emerald' ? 'bg-emerald-500' :
                  payrollStatusColor === 'indigo' ? 'bg-indigo-500' : 'bg-slate-400'
                }`}></div>
                <span className="text-sm font-black text-amber-700 uppercase tracking-tight">{payrollStatusLabel}</span>
              </div>
              <p className="text-[8px] font-black text-amber-400 uppercase tracking-widest mt-4">Maker: HR Admin</p>
            </div>
          </div>

          <div className="px-8 pb-8">
            <div className="flex gap-4 pt-2">
              <Link
                href="/payroll"
                className="flex-1 py-3 bg-indigo-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-700 shadow-xl shadow-indigo-500/20 transition-all active:scale-95 text-center"
              >
                ⚡ Review & Authorise Payroll
              </Link>
              <Link
                href="/payroll"
                className="px-6 py-3 bg-white border border-slate-200 rounded-2xl text-[10px] font-black text-slate-500 uppercase tracking-widest hover:border-indigo-300 hover:text-indigo-600 transition-all"
              >
                Payslips
              </Link>
            </div>
          </div>
        </div>

        {/* COMPLIANCE + STATUTORY */}
        <div className="flex flex-col gap-6">
          <div className="bg-slate-950 rounded-[2rem] border border-slate-800 p-8 relative overflow-hidden flex-1">
            <div className="absolute top-0 right-0 w-28 h-28 bg-indigo-600/10 rounded-full blur-2xl"></div>
            <h3 className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.3em] mb-7 flex items-center justify-between">
              SG Compliance
              <span className="bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 px-2 py-0.5 rounded-full text-[8px] animate-pulse">LIVE</span>
            </h3>
            <div className="space-y-4">
              {[
                { label: 'CPF e-Submit', status: 'T-3 Days', color: 'amber' },
                { label: 'IRAS AIS Upload', status: 'Verified', color: 'emerald' },
                { label: 'MOM FCF Compliance', status: '2 Breaches', color: 'red' },
                { label: 'SDL Filing', status: 'Pending', color: 'amber' },
              ].map((item) => {
                const colorMap: Record<string, string> = {
                  amber: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
                  emerald: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
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
            <Link href="/reports" className="mt-6 block w-full py-3 bg-white/5 border border-white/10 hover:bg-white/10 text-white rounded-2xl text-[9px] font-black uppercase tracking-widest transition-all text-center">
              Full Compliance Report →
            </Link>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-slate-950 border border-slate-800 p-6 rounded-[1.5rem] text-center group hover:border-indigo-600 transition-all">
              {loading ? (
                <div className="h-8 w-12 bg-slate-800 rounded-lg animate-pulse mx-auto"></div>
              ) : (
                <div className="text-2xl font-black text-white tracking-widest">{stats?.activeEmployees ?? '—'}</div>
              )}
              <div className="text-[8px] font-black text-slate-500 uppercase mt-2 tracking-[0.2em]">Active Staff</div>
            </div>
            <div className="bg-white border border-slate-200 p-6 rounded-[1.5rem] text-center group hover:border-indigo-600 hover:bg-indigo-600 transition-all">
              <div className="text-2xl font-black text-slate-900 group-hover:text-white tracking-widest transition-colors">99.8%</div>
              <div className="text-[8px] font-black text-slate-400 group-hover:text-white/60 uppercase mt-2 tracking-[0.2em] transition-colors">Uptime</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── ROW 3: Workforce + Action Queue ──────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">

        {/* Departmental Loads */}
        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-2xl shadow-indigo-500/5 p-8">
          <SectionHeader title="Departmental Loads" href="/employees" color="slate" />
          {loading ? (
            <div className="space-y-6">
              {[1,2,3,4].map(i => (
                <div key={i} className="flex items-center gap-4">
                  <div className="w-24 h-3 bg-slate-100 rounded animate-pulse"></div>
                  <div className="flex-1 h-2 bg-slate-100 rounded-full animate-pulse"></div>
                  <div className="w-8 h-3 bg-slate-100 rounded animate-pulse"></div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-6">
              {(stats?.departments ?? []).map((dept, idx) => (
                <div key={dept.label} className="flex items-center gap-4">
                  <div className="w-24 text-[9px] font-black text-slate-500 uppercase tracking-tight truncate">{dept.label}</div>
                  <div className="flex-1 h-2 bg-slate-50 border border-slate-100 rounded-full overflow-hidden">
                    <div className={`h-full ${deptColors[idx] ?? 'bg-slate-300'} rounded-full`} style={{ width: `${Math.round((dept.count / maxDeptCount) * 100)}%` }}></div>
                  </div>
                  <div className="w-10 text-right text-[9px] font-black text-slate-400">{dept.count}</div>
                </div>
              ))}
              {(stats?.departments?.length ?? 0) === 0 && (
                <p className="text-[9px] font-black text-slate-300 uppercase tracking-widest text-center py-4">No data</p>
              )}
            </div>
          )}
        </div>

        {/* Onboarding Pipeline */}
        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-2xl shadow-indigo-500/5 p-8">
          <SectionHeader title="Onboarding Pipeline" href="/recruitment" color="indigo" />
          <div className="grid grid-cols-2 gap-4">
            {[
              { label: 'Offers Issued', count: 18, color: 'text-slate-400' },
              { label: 'Pre-boarding', count: 12, color: 'text-indigo-400' },
              { label: 'Doc Verify', count: 4, color: 'text-indigo-600' },
              { label: 'Active Deployment', count: 42, color: 'text-slate-950' },
            ].map((stage) => (
              <div key={stage.label} className="bg-slate-50 border border-slate-100 hover:border-indigo-200 rounded-2xl p-5 transition-all">
                <span className={`text-2xl font-black ${stage.color} tracking-tighter block`}>{String(stage.count).padStart(2,'0')}</span>
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-2 block">{stage.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Action Queue */}
        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-2xl shadow-indigo-500/5 p-8">
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
                  task.urgent
                    ? 'bg-indigo-50/40 border-indigo-100 hover:bg-indigo-50'
                    : 'bg-slate-50 border-slate-100 hover:bg-slate-100'
                }`}
              >
                <span className={`text-lg ${task.urgent ? 'text-indigo-500' : 'text-slate-300'}`}>{task.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-black text-slate-900 uppercase tracking-tight truncate">{task.title}</p>
                  <p className={`text-[9px] font-black mt-1 uppercase tracking-widest truncate ${task.urgent ? 'text-indigo-500' : 'text-slate-400'}`}>{task.sub}</p>
                </div>
                <span className="text-slate-300 group-hover:text-indigo-600 transition-colors font-black">→</span>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* ── ROW 4: Quick Access Module Grid ───────────────────────────────── */}
      <div className="bg-white rounded-[2rem] border border-slate-100 shadow-2xl shadow-indigo-500/5 p-8">
        <SectionHeader title="All Modules" badge="RBAC Enabled" color="indigo" />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {[
            { name: 'Employees',    path: '/employees',     icon: '◈', color: 'hover:border-indigo-400 hover:bg-indigo-50' },
            { name: 'Payroll',      path: '/payroll',       icon: '◆', color: 'hover:border-indigo-400 hover:bg-indigo-50', highlight: true },
            { name: 'Leave',        path: '/leave',         icon: '◌', color: 'hover:border-amber-400 hover:bg-amber-50' },
            { name: 'Claims',       path: '/claims',        icon: '◫', color: 'hover:border-violet-400 hover:bg-violet-50' },
            { name: 'Attendance',   path: '/attendance',    icon: '◉', color: 'hover:border-sky-400 hover:bg-sky-50' },
            { name: 'Recruitment',  path: '/recruitment',   icon: '◇', color: 'hover:border-emerald-400 hover:bg-emerald-50' },
            { name: 'Performance',  path: '/performance',   icon: '▣', color: 'hover:border-violet-400 hover:bg-violet-50' },
            { name: 'Training',     path: '/training',      icon: '◑', color: 'hover:border-amber-400 hover:bg-amber-50' },
            { name: 'Reports',      path: '/reports',       icon: '▤', color: 'hover:border-emerald-400 hover:bg-emerald-50' },
            { name: 'Settings',     path: '/settings',      icon: '◎', color: 'hover:border-slate-400 hover:bg-slate-50' },
          ].map((mod) => (
            <Link
              key={mod.name}
              href={mod.path}
              className={`flex flex-col items-center gap-4 p-6 rounded-2xl border transition-all group cursor-pointer active:scale-95 ${
                mod.highlight
                  ? 'bg-indigo-600 border-indigo-600 text-white shadow-xl shadow-indigo-500/20'
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
