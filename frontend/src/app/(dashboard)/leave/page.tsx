'use client';

import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';

export default function LeaveManagementPage() {
  const { user } = useAuth();
  const normalizedEmail = (user?.email || '').toLowerCase().trim();
  const isAdmin = 
    user?.role === 'SUPER_ADMIN' || 
    user?.role === 'ADMIN' || 
    user?.role === 'HR_ADMIN' || 
    user?.role === 'HR_MANAGER' ||
    normalizedEmail === 'admin@ezyhrm.sg';

  const [activeTab, setActiveTab] = useState<'approvals' | 'calendar' | 'balances' | 'history'>(isAdmin ? 'approvals' : 'balances');

  // Management View UI (Command Center)
  if (isAdmin) {
    return (
      <div className="flex flex-col gap-6 max-w-[1600px] mx-auto pb-12">
        <div className="flex justify-between items-center bg-white p-8 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1.5 h-full bg-indigo-600"></div>
          <div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight uppercase">Organizational Availability Portal</h1>
            <p className="text-[10px] font-black text-slate-400 mt-1 uppercase tracking-[0.2em]">Synchronized Leave Management & Statutory Entitlement Control</p>
          </div>
          <button className="px-6 py-2.5 rounded-xl text-[10px] font-black text-indigo-600 bg-indigo-50 border border-indigo-100 hover:bg-indigo-100 transition-all uppercase tracking-widest">
            Export Sector Data
          </button>
        </div>

        {/* Global Continuity Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm transition-all hover:shadow-md">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Awaiting Decision Signal</p>
            <p className="text-4xl font-black text-amber-500 mt-3 tabular-nums">14</p>
            <p className="text-[9px] font-black text-amber-600 mt-3 uppercase tracking-widest flex items-center gap-2">
               <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-ping"></span>
               High Latency: 3 Urgent Requests
            </p>
          </div>
          <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800 shadow-xl">
            <p className="text-[9px] font-black text-indigo-400 uppercase tracking-widest">Active Out-of-Office Units</p>
            <p className="text-4xl font-black text-white mt-3 tabular-nums">08</p>
            <p className="text-[9px] font-black text-slate-500 mt-3 uppercase tracking-widest italic">Impact Analysis: 4% Operational Load</p>
          </div>
          <div className="bg-emerald-50/50 p-6 rounded-2xl border border-emerald-100 shadow-sm">
            <p className="text-[9px] font-black text-emerald-700 uppercase tracking-widest text-center">Avg. Review Velocity</p>
            <p className="text-4xl font-black text-emerald-800 mt-3 text-center tabular-nums">1.2d</p>
          </div>
        </div>

        {/* Admin Decision Board */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm mt-4 overflow-hidden min-h-[500px]">
          <div className="border-b border-slate-100 px-8 flex gap-10 text-[11px] font-black uppercase tracking-[0.2em] bg-slate-50/50">
            <button 
              onClick={() => setActiveTab('approvals')}
              className={`py-5 border-b-2 transition-all ${activeTab === 'approvals' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
            >
              Authorization Queue
            </button>
            <button 
              onClick={() => setActiveTab('calendar')}
              className={`py-5 border-b-2 transition-all ${activeTab === 'calendar' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
            >
              Enterprise Heatmap
            </button>
          </div>

          <div className="p-8">
            {activeTab === 'approvals' && (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-slate-100 text-[10px] uppercase tracking-[0.2em] font-black text-slate-400">
                      <th className="pb-5">Employee Identity</th>
                      <th className="pb-5">Leave Designation</th>
                      <th className="pb-5">Temporal Window</th>
                      <th className="pb-5 text-center">Duration</th>
                      <th className="pb-5 text-right">Protocol</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50 text-sm">
                    {[
                      { name: 'Sarah Chen', dept: 'Engineering', type: 'Annual', start: '2026-04-25', end: '2026-04-30', days: 4, avatar: 'SC' },
                      { name: 'Marcus Tan', dept: 'Operations', type: 'Sick', start: '2026-04-20', end: '2026-04-21', days: 2, avatar: 'MT' },
                      { name: 'Linda Low', dept: 'HR', type: 'Childcare', start: '2026-04-22', end: '2026-04-22', days: 1, avatar: 'LL' },
                    ].map((req, i) => (
                      <tr key={i} className="group hover:bg-slate-50 transition-colors">
                        <td className="py-6">
                          <div className="flex items-center gap-4">
                            <div className="h-10 w-10 bg-slate-900 rounded-xl flex items-center justify-center text-white font-black text-[11px] border border-slate-800 shadow-lg">{req.avatar}</div>
                            <div>
                              <p className="font-black text-slate-900 leading-tight uppercase tracking-tight">{req.name}</p>
                              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">{req.dept}</p>
                            </div>
                          </div>
                        </td>
                        <td className="py-6"><span className="px-3 py-1 rounded bg-indigo-50 text-indigo-600 text-[10px] font-black uppercase tracking-widest border border-indigo-100">{req.type}</span></td>
                        <td className="py-6 text-slate-500 font-bold tabular-nums text-xs uppercase">{req.start} <span className="mx-1 text-slate-300">→</span> {req.end}</td>
                        <td className="py-6 text-center font-black text-slate-900 tabular-nums">{req.days}d</td>
                        <td className="py-6 text-right">
                          <div className="flex justify-end gap-3">
                            <button className="px-4 py-2 border border-slate-200 text-slate-600 bg-white text-[10px] font-black uppercase tracking-widest rounded-lg hover:bg-slate-50 transition-all shadow-sm">View Analysis</button>
                            <button className="px-4 py-2 bg-indigo-600 text-white text-[10px] font-black uppercase tracking-widest rounded-lg hover:bg-indigo-700 shadow-xl shadow-indigo-500/10 transition-all">Authorize</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {activeTab === 'calendar' && (
              <div className="h-96 flex flex-col items-center justify-center bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                <div className="w-16 h-16 bg-slate-900 rounded-[1.5rem] flex items-center justify-center text-2xl mb-6 shadow-2xl border border-slate-800">📅</div>
                <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">Enterprise Continuity Heatmap</h3>
                <p className="text-[10px] font-bold mt-3 text-slate-400 uppercase tracking-[0.2em] text-center max-w-sm leading-relaxed">Streaming availability matrix data from leave-service:8003... Visualizing team overlap dynamics.</p>
                <div className="mt-8 flex gap-3">
                   <div className="w-1.5 h-8 bg-indigo-600 rounded-full animate-pulse"></div>
                   <div className="w-1.5 h-8 bg-indigo-400 rounded-full animate-pulse delay-75"></div>
                   <div className="w-1.5 h-8 bg-indigo-200 rounded-full animate-pulse delay-150"></div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Employee Workflow View (Personal Tracker)
  return (
    <div className="flex flex-col gap-8 max-w-[1600px] mx-auto pb-12">
      <div className="flex justify-between items-center bg-white p-8 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden">
        <div className="absolute top-0 left-0 w-1.5 h-full bg-indigo-600"></div>
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight uppercase">Personal Leave Nexus</h1>
          <p className="text-[10px] font-black text-slate-400 mt-1 uppercase tracking-[0.2em]">Manage Statutory Balance & Submission Signal Queue</p>
        </div>
        <div className="flex gap-4">
          <button className="px-6 py-2.5 bg-slate-50 border border-slate-200 text-slate-600 text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-slate-100 shadow-sm transition-all">
             Audit History
          </button>
          <button className="px-6 py-2.5 bg-indigo-600 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-indigo-700 shadow-xl shadow-indigo-500/20 transition-all">
            + New Request Signal
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { label: 'Annual Entitlement', val: '14.5', total: '21', color: 'bg-indigo-600', sub: 'Incl. 3.5d Carry-forward' },
          { label: 'Medical Coverage', val: '12', total: '14', color: 'bg-red-500', sub: 'Statutory capped: 14d' },
          { label: 'Childcare Signal', val: '06', total: '06', color: 'bg-purple-600', sub: 'GPCL - Singapore Resident' },
          { label: 'Pipeline Auth', val: '02', total: 'P', color: 'bg-amber-500', sub: 'Awaiting Manager Feedback' },
        ].map((stat, i) => (
          <div key={i} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden group hover:border-indigo-200 transition-all">
             <div className={`absolute top-0 left-0 w-1 h-full ${stat.color} opacity-80`}></div>
             <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{stat.label}</p>
             <div className="mt-4 flex items-baseline gap-2">
                <span className="text-4xl font-black text-slate-900 tracking-tighter">{stat.val}</span>
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{stat.total !== 'P' ? `/ ${stat.total}d` : 'Pending'}</span>
             </div>
             <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mt-4 group-hover:text-slate-600 transition-colors italic">{stat.sub}</p>
          </div>
        ))}
      </div>

      <div className="bg-white border border-slate-200 shadow-sm rounded-2xl overflow-hidden min-h-[400px]">
        <div className="bg-slate-50/50 border-b border-slate-100 px-8 flex gap-10">
          <button 
            onClick={() => setActiveTab('balances')}
            className={`py-5 text-[11px] font-black uppercase tracking-[0.2em] border-b-2 transition-all ${activeTab === 'balances' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
          >
            Balance Breakdown
          </button>
          <button 
            onClick={() => setActiveTab('history')}
            className={`py-5 text-[11px] font-black uppercase tracking-[0.2em] border-b-2 transition-all ${activeTab === 'history' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
          >
            Submission History
          </button>
        </div>

        <div className="p-8">
          {activeTab === 'balances' && (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-slate-100 text-[10px] uppercase font-black tracking-[0.2em] text-slate-400">
                    <th className="pb-5">Statutory Leave Designation</th>
                    <th className="pb-5 text-right">Accounting Tier</th>
                    <th className="pb-5 text-right">Rollover Bal.</th>
                    <th className="pb-5 text-right">Utilized</th>
                    <th className="pb-5 text-right">Liquid Balance</th>
                  </tr>
                </thead>
                <tbody className="text-sm text-slate-600 divide-y divide-slate-50 font-bold">
                  <tr className="hover:bg-slate-50/50 transition-colors">
                    <td className="py-6 font-black text-slate-900 uppercase tracking-tight">Annual Entitlement (SC/PR)</td>
                    <td className="py-6 text-right uppercase text-[10px]">21 Days / Std</td>
                    <td className="py-6 text-right tabular-nums">3.5 Days</td>
                    <td className="py-6 text-right tabular-nums text-red-600">-10.0 Days</td>
                    <td className="py-6 text-right font-black text-slate-900 tabular-nums text-lg">14.5 Days</td>
                  </tr>
                  <tr className="hover:bg-slate-50/50 transition-colors">
                    <td className="py-6 font-black text-slate-900 uppercase tracking-tight">Medical Coverage (Outpatient)</td>
                    <td className="py-6 text-right uppercase text-[10px]">14 Days / Stat</td>
                    <td className="py-6 text-right tabular-nums">0.0 Days</td>
                    <td className="py-6 text-right tabular-nums text-red-600">-02.0 Days</td>
                    <td className="py-6 text-right font-black text-slate-900 tabular-nums text-lg">12.0 Days</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
