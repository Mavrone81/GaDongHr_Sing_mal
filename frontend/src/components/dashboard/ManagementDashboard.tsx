'use client';

import React from 'react';
import Link from 'next/link';

// ─── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({
  label, value, sub, accent = 'indigo', trend, href
}: {
  label: string; value: string; sub?: string; accent?: string;
  trend?: { dir: 'up' | 'down'; val: string }; href?: string;
}) {
  const accentMap: Record<string, string> = {
    indigo: 'border-indigo-100 text-indigo-600 bg-indigo-50',
    emerald: 'border-emerald-100 text-emerald-600 bg-emerald-50',
    amber: 'border-amber-100 text-amber-600 bg-amber-50',
    red: 'border-red-100 text-red-600 bg-red-50',
    violet: 'border-violet-100 text-violet-600 bg-violet-50',
    slate: 'border-slate-200 text-slate-600 bg-slate-50',
  };
  const Wrapper = href ? Link : 'div';
  return (
    <Wrapper href={href as string} className="bg-white rounded-[1.75rem] border border-slate-100 shadow-2xl shadow-indigo-500/5 p-7 flex flex-col gap-5 group hover:border-indigo-200 transition-all duration-300 relative overflow-hidden">
      <div className="absolute top-0 right-0 w-20 h-20 bg-indigo-500/3 rounded-full blur-2xl opacity-0 group-hover:opacity-100 transition-opacity"></div>
      <p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.3em]">{label}</p>
      <div className="flex items-end gap-3">
        <h3 className="text-3xl font-black text-slate-900 tracking-tighter leading-none">{value}</h3>
        {trend && (
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

export default function ManagementDashboard() {
  return (
    <div className="flex flex-col gap-8 pb-12 animate-in fade-in slide-in-from-bottom-4 duration-700">

      {/* ── ROW 1: Headline KPIs ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard label="Active Workforce" value="124" sub="Employees on duty" accent="slate" trend={{ dir: 'up', val: '3 this month' }} href="/employees" />
        <StatCard label="Monthly Payroll" value="$245,600" sub="Mar 2026 · Pending Auth" accent="indigo" trend={{ dir: 'up', val: '2.1%' }} href="/payroll" />
        <StatCard label="Leave Pending" value="34" sub="Awaiting L1 / L2 Approval" accent="amber" href="/leave" />
        <StatCard label="Open Claims" value="17" sub="Pending Finance Review" accent="violet" href="/claims" />
      </div>

      {/* ── ROW 2: Payroll + Compliance (Primary Focus) ───────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">

        {/* PAYROLL ENGINE PANEL */}
        <div className="xl:col-span-2 bg-white rounded-[2rem] border border-slate-100 shadow-2xl shadow-indigo-500/5 overflow-hidden">
          <div className="p-8 border-b border-slate-50">
            <SectionHeader title="Payroll Engine" badge="Mar 2026" href="/payroll" color="indigo" />
          </div>

          {/* Payroll Run Status */}
          <div className="p-8 grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-indigo-50/60 p-6 rounded-[1.5rem] border border-indigo-100 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-16 h-16 bg-indigo-600/5 rounded-full blur-xl"></div>
              <p className="text-[9px] font-black text-indigo-500 uppercase tracking-widest mb-3">Net Payout</p>
              <h4 className="text-2xl font-black text-slate-900 tracking-tighter">$201,400</h4>
              <p className="text-[8px] font-black text-indigo-400 uppercase tracking-widest mt-4">124 employees</p>
            </div>
            <div className="bg-emerald-50/60 p-6 rounded-[1.5rem] border border-emerald-100">
              <p className="text-[9px] font-black text-emerald-600 uppercase tracking-widest mb-3">CPF + SDL</p>
              <h4 className="text-2xl font-black text-slate-900 tracking-tighter">$44,200</h4>
              <p className="text-[8px] font-black text-emerald-400 uppercase tracking-widest mt-4">Due 14th Apr</p>
            </div>
            <div className="bg-amber-50/60 p-6 rounded-[1.5rem] border border-amber-100">
              <p className="text-[9px] font-black text-amber-600 uppercase tracking-widest mb-3">Run Status</p>
              <div className="flex items-center gap-2 mt-1">
                <div className="w-2 h-2 bg-amber-500 rounded-full animate-pulse"></div>
                <span className="text-sm font-black text-amber-700 uppercase tracking-tight">Pending Approval</span>
              </div>
              <p className="text-[8px] font-black text-amber-400 uppercase tracking-widest mt-4">Maker: HR Admin</p>
            </div>
          </div>

          {/* Payroll History Bars */}
          <div className="px-8 pb-8">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.3em] mb-5">6-Month Disbursement History</p>
            <div className="flex items-end gap-4 h-24">
              {[
                { month: 'Oct', val: 78 }, { month: 'Nov', val: 82 },
                { month: 'Dec', val: 95 }, { month: 'Jan', val: 80 },
                { month: 'Feb', val: 85 }, { month: 'Mar', val: 100 },
              ].map((d) => (
                <div key={d.month} className="flex-1 flex flex-col items-center gap-2 group">
                  <div className="w-full flex items-end justify-center h-20">
                    <div
                      className="w-full bg-indigo-600 rounded-t-xl group-hover:bg-indigo-700 transition-all"
                      style={{ height: `${d.val}%` }}
                    ></div>
                  </div>
                  <span className="text-[8px] font-black text-slate-400 uppercase">{d.month}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-4 mt-6 pt-6 border-t border-slate-50">
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

          {/* Uptime/headcount mini cards */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-slate-950 border border-slate-800 p-6 rounded-[1.5rem] text-center group hover:border-indigo-600 transition-all">
              <div className="text-2xl font-black text-white tracking-widest">124</div>
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
          <div className="space-y-6">
            {[
              { label: 'Engineering', value: 45, count: 56, color: 'bg-slate-950' },
              { label: 'Sales & Marketing', value: 25, count: 31, color: 'bg-indigo-600' },
              { label: 'Operations', value: 20, count: 25, color: 'bg-indigo-300' },
              { label: 'HR & Finance', value: 10, count: 12, color: 'bg-slate-200' },
            ].map((dept) => (
              <div key={dept.label} className="flex items-center gap-4">
                <div className="w-24 text-[9px] font-black text-slate-500 uppercase tracking-tight truncate">{dept.label}</div>
                <div className="flex-1 h-2 bg-slate-50 border border-slate-100 rounded-full overflow-hidden">
                  <div className={`h-full ${dept.color} rounded-full`} style={{ width: `${dept.value}%` }}></div>
                </div>
                <div className="w-10 text-right text-[9px] font-black text-slate-400">{dept.count}</div>
              </div>
            ))}
          </div>
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
              { title: 'Payroll Auth — Mar 2026', sub: 'Checker approval required', path: '/payroll', urgent: true, icon: '◆' },
              { title: 'Leave Approvals (34)', sub: 'L1 / L2 pending', path: '/leave', urgent: false, icon: '◌' },
              { title: 'CPF Submission Due', sub: 'Deadline: 14 Apr 2026', path: '/payroll', urgent: true, icon: '◉' },
              { title: 'FCF Ad-Expiry Alert', sub: 'Senior FE Architect role', path: '/recruitment', urgent: true, icon: '◇' },
              { title: 'Claims Review (17)', sub: 'Finance: L2 pending', path: '/claims', urgent: false, icon: '◫' },
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
