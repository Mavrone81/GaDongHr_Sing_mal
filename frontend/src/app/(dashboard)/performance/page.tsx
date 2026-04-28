'use client';

export default function PerformancePage() {
  const cycles = [
    { name: 'Annual Review 2026', period: 'Jan–Dec 2026', phase: 'Self-Assessment', progress: 35, status: 'In Progress' },
    { name: 'Mid-Year Check-in', period: 'Jan–Jun 2026', phase: 'Manager Assessment', progress: 72, status: 'In Progress' },
    { name: 'Probation Review — Q1', period: 'Jan–Mar 2026', phase: 'Calibration', progress: 100, status: 'Completed' },
  ];

  const kpis = [
    { label: 'Avg Score', value: '3.8 / 5.0', sub: 'Enterprise Mean', color: 'indigo' },
    { label: 'Completion Rate', value: '74%', sub: 'Self-Assessment', color: 'emerald' },
    { label: 'PIP Active', value: '3', sub: 'Employees', color: 'amber' },
    { label: 'Promotions Flagged', value: '11', sub: 'Pending Approval', color: 'violet' },
  ];

  return (
    <div className="flex flex-col gap-10 max-w-[1400px] mx-auto pb-20 animate-in fade-in duration-700">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 bg-white p-10 rounded-[2.5rem] border border-slate-100 shadow-2xl shadow-indigo-500/5 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-violet-600/5 rounded-full blur-3xl"></div>
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-2 h-2 bg-violet-600 rounded-full"></div>
            <span className="text-[10px] font-black text-violet-600 uppercase tracking-[0.4em]">Talent Intelligence Layer</span>
          </div>
          <h1 className="text-4xl font-black text-slate-900 tracking-tighter">Performance <span className="text-violet-600">Management</span></h1>
          <p className="text-sm font-bold text-slate-400 mt-2 uppercase tracking-widest">
            Appraisal cycles, KPI calibration, and 360° feedback governance.
          </p>
        </div>
        <div className="flex gap-4 relative z-10">
          <button className="px-8 py-4 bg-violet-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-violet-700 shadow-xl shadow-violet-500/20 transition-all active:scale-95">
            + New Appraisal Cycle
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-2xl shadow-indigo-500/5">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-4">{kpi.label}</p>
            <h3 className="text-3xl font-black text-slate-900 tracking-tighter">{kpi.value}</h3>
            <p className="text-[9px] font-black text-slate-400 uppercase mt-6">{kpi.sub}</p>
          </div>
        ))}
      </div>

      {/* Appraisal Cycles Table */}
      <section className="bg-white rounded-[2.5rem] border border-slate-100 shadow-2xl shadow-indigo-500/5 overflow-hidden">
        <div className="p-8 border-b border-slate-50 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <div className="w-2 h-8 bg-violet-600 rounded-full"></div>
            <h3 className="text-lg font-black text-slate-900 uppercase tracking-widest">Active Appraisal Cycles</h3>
          </div>
          <button className="px-6 py-3 bg-white border border-slate-200 text-[10px] font-black text-slate-500 uppercase tracking-widest rounded-xl hover:bg-slate-50 transition-all">
            Configure KPIs
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-50">
              <tr>
                <th className="px-8 py-6">Cycle Name</th>
                <th className="px-8 py-6">Period</th>
                <th className="px-8 py-6">Current Phase</th>
                <th className="px-8 py-6">Completion</th>
                <th className="px-8 py-6">Status</th>
                <th className="px-8 py-6 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {cycles.map((c) => (
                <tr key={c.name} className="group hover:bg-slate-50/50 transition-all">
                  <td className="px-8 py-5">
                    <span className="text-sm font-black text-slate-900 uppercase tracking-tight group-hover:text-violet-600 transition-colors">{c.name}</span>
                  </td>
                  <td className="px-8 py-5">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{c.period}</span>
                  </td>
                  <td className="px-8 py-5">
                    <span className="text-[10px] font-black text-violet-600 bg-violet-50 px-3 py-1.5 rounded-lg uppercase">{c.phase}</span>
                  </td>
                  <td className="px-8 py-5">
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden w-32">
                        <div className="h-full bg-violet-600 rounded-full" style={{ width: `${c.progress}%` }}></div>
                      </div>
                      <span className="text-[10px] font-black text-slate-500">{c.progress}%</span>
                    </div>
                  </td>
                  <td className="px-8 py-5">
                    <div className="flex items-center gap-2">
                      <div className={`w-1.5 h-1.5 rounded-full ${c.status === 'Completed' ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'}`}></div>
                      <span className="text-[10px] font-black text-slate-500 uppercase">{c.status}</span>
                    </div>
                  </td>
                  <td className="px-8 py-5 text-right">
                    <button className="px-5 py-2 bg-white border border-slate-200 rounded-xl text-[9px] font-black text-slate-500 uppercase tracking-widest hover:border-violet-600 hover:text-violet-600 transition-all">
                      Manage
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
