'use client';

import { useState } from 'react';
import Link from 'next/link';

const offboardingCases = [
  { id: 'OB-003', name: 'James Koh', dept: 'Engineering', type: 'Resignation', lastDay: '2026-04-30', status: 'In Progress', progress: 65, steps: ['Resignation Accepted', 'IT Access Revocation', 'Asset Return', 'Final Pay Computation', 'IR21 Filing', 'Exit Interview'], done: [true, true, false, false, false, false] },
  { id: 'OB-002', name: 'Mei Ling Tan', dept: 'Marketing', type: 'Retirement', lastDay: '2026-04-15', status: 'Clearance Sign-off', progress: 90, steps: ['Resignation Accepted', 'IT Access Revocation', 'Asset Return', 'Final Pay Computation', 'IR21 Filing', 'Exit Interview'], done: [true, true, true, true, false, true] },
  { id: 'OB-001', name: 'Ravi Sharma', dept: 'Operations', type: 'Contract End', lastDay: '2026-03-31', status: 'Completed', progress: 100, steps: ['Resignation Accepted', 'IT Access Revocation', 'Asset Return', 'Final Pay Computation', 'IR21 Filing', 'Exit Interview'], done: [true, true, true, true, true, true] },
];

const statusColor: Record<string, string> = {
  'In Progress':      'bg-amber-50 text-amber-600 border-amber-100',
  'Clearance Sign-off': 'bg-indigo-50 text-indigo-600 border-indigo-100',
  'Completed':        'bg-emerald-50 text-emerald-600 border-emerald-100',
};

export default function OffboardingPage() {
  const [selected, setSelected] = useState<typeof offboardingCases[0] | null>(null);

  return (
    <div className="flex flex-col gap-8 max-w-[1400px] mx-auto pb-20 animate-in fade-in duration-700">

      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 bg-white p-10 rounded-[2.5rem] border border-slate-100 shadow-2xl shadow-indigo-500/5 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-36 h-36 bg-red-500/5 rounded-full blur-3xl" />
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-2 h-2 bg-red-500 rounded-full" />
            <span className="text-[10px] font-black text-red-600 uppercase tracking-[0.4em]">Workforce Separation Layer</span>
          </div>
          <h1 className="text-4xl font-black text-slate-900 tracking-tighter">Offboarding <span className="text-red-500">Management</span></h1>
          <p className="text-sm font-bold text-slate-400 mt-2 uppercase tracking-widest max-w-xl">
            Final pay computation, IR21 tax clearance, asset return, IT access revocation, and exit interview governance.
          </p>
        </div>
        <div className="flex gap-4 relative z-10">
          <button className="px-8 py-4 bg-red-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-red-700 shadow-xl shadow-red-500/20 transition-all active:scale-95">
            + Initiate Offboarding
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { label: 'Active Cases',     value: '2',  color: 'text-amber-600',   bg: 'bg-amber-50 border-amber-100' },
          { label: 'Completed (MTD)',  value: '3',  color: 'text-emerald-600', bg: 'bg-white border-slate-100' },
          { label: 'IR21 Filing Due',  value: '1',  color: 'text-red-600',     bg: 'bg-red-50 border-red-100' },
          { label: 'Assets Pending',   value: '4',  color: 'text-indigo-600',  bg: 'bg-indigo-50 border-indigo-100' },
        ].map((k) => (
          <div key={k.label} className={`p-8 rounded-[2rem] border shadow-2xl shadow-indigo-500/5 ${k.bg}`}>
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-4">{k.label}</p>
            <h3 className={`text-3xl font-black tracking-tighter ${k.color}`}>{k.value}</h3>
          </div>
        ))}
      </div>

      {/* Cases Table */}
      <section className="bg-white rounded-[2.5rem] border border-slate-100 shadow-2xl shadow-indigo-500/5 overflow-hidden">
        <div className="p-8 border-b border-slate-50 flex items-center gap-4">
          <div className="w-2 h-8 bg-red-500 rounded-full" />
          <h3 className="text-lg font-black text-slate-900 uppercase tracking-widest">Separation Cases</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-50">
              <tr>
                <th className="px-8 py-6">Employee</th>
                <th className="px-8 py-6">Separation Type</th>
                <th className="px-8 py-6">Last Day</th>
                <th className="px-8 py-6">Progress</th>
                <th className="px-8 py-6">Status</th>
                <th className="px-8 py-6 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {offboardingCases.map((c) => (
                <tr key={c.id} className="group hover:bg-slate-50/50 transition-all">
                  <td className="px-8 py-5">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-center text-[10px] font-black text-indigo-400 shrink-0">
                        {c.name.split(' ').map(n => n[0]).join('')}
                      </div>
                      <div>
                        <p className="text-xs font-black text-slate-900 uppercase tracking-tight group-hover:text-red-600 transition-colors">{c.name}</p>
                        <p className="text-[9px] font-bold text-slate-400 uppercase mt-0.5">{c.dept} · {c.id}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-8 py-5">
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{c.type}</span>
                  </td>
                  <td className="px-8 py-5">
                    <span className="text-[10px] font-black text-slate-400 uppercase">{c.lastDay}</span>
                  </td>
                  <td className="px-8 py-5">
                    <div className="flex items-center gap-3">
                      <div className="w-32 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${c.progress === 100 ? 'bg-emerald-500' : 'bg-indigo-600'}`} style={{ width: `${c.progress}%` }} />
                      </div>
                      <span className="text-[10px] font-black text-slate-500">{c.progress}%</span>
                    </div>
                  </td>
                  <td className="px-8 py-5">
                    <span className={`text-[9px] font-black px-3 py-1.5 rounded-full border uppercase tracking-widest ${statusColor[c.status]}`}>
                      {c.status}
                    </span>
                  </td>
                  <td className="px-8 py-5 text-right">
                    <button
                      onClick={() => setSelected(c)}
                      className="px-5 py-2 bg-white border border-slate-200 rounded-xl text-[9px] font-black text-slate-500 uppercase tracking-widest hover:border-red-500 hover:text-red-600 transition-all"
                    >
                      Manage
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Offboarding Checklist Modal */}
      {selected && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 backdrop-blur-md p-6 animate-in fade-in duration-300">
          <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-lg overflow-hidden border border-slate-100 animate-in slide-in-from-bottom-8">
            <div className="bg-slate-900 p-8 flex justify-between items-center">
              <div>
                <h3 className="text-xl font-black text-white tracking-tighter uppercase">{selected.name}</h3>
                <p className="text-[9px] font-black text-indigo-400 uppercase tracking-widest mt-1">{selected.type} · Last Day: {selected.lastDay}</p>
              </div>
              <button onClick={() => setSelected(null)} className="w-10 h-10 bg-slate-800 border border-slate-700 rounded-2xl text-slate-400 hover:text-white transition-all font-black text-xl flex items-center justify-center">×</button>
            </div>
            <div className="p-8 space-y-3">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-5">Clearance Checklist</p>
              {selected.steps.map((step, i) => (
                <div key={step} className={`flex items-center gap-4 p-4 rounded-2xl border transition-all ${selected.done[i] ? 'bg-emerald-50 border-emerald-100' : 'bg-slate-50 border-slate-100'}`}>
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${selected.done[i] ? 'bg-emerald-500' : 'bg-slate-200'}`}>
                    {selected.done[i] && <span className="text-white text-xs font-black">✓</span>}
                  </div>
                  <span className={`text-[10px] font-black uppercase tracking-widest ${selected.done[i] ? 'text-emerald-700' : 'text-slate-500'}`}>{step}</span>
                </div>
              ))}
            </div>
            <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-between gap-4">
              <button onClick={() => setSelected(null)} className="px-6 py-3 bg-white border border-slate-200 text-[10px] font-black text-slate-500 uppercase tracking-widest rounded-2xl hover:bg-slate-100 transition-all">Close</button>
              <Link href="/payroll" className="px-8 py-3 bg-indigo-600 text-white text-[10px] font-black uppercase tracking-widest rounded-2xl hover:bg-indigo-700 shadow-xl shadow-indigo-500/20 transition-all">
                Final Pay →
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
