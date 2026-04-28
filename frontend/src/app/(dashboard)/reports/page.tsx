'use client';

export default function ReportsPage() {
  const reports = [
    { name: 'CPF / SDL / FWL Statutory Report', category: 'Statutory', icon: '◆', lastRun: '2026-03-31', freq: 'Monthly', badge: 'MOM Required' },
    { name: 'IRAS AIS / IR8A Annual Filing', category: 'Statutory', icon: '◆', lastRun: '2026-03-01', freq: 'Annual', badge: 'IRAS Required' },
    { name: 'Bank GIRO Reconciliation', category: 'Financial', icon: '◫', lastRun: '2026-03-28', freq: 'Monthly', badge: '' },
    { name: 'Leave Liability Report', category: 'Workforce', icon: '◌', lastRun: '2026-03-31', freq: 'Monthly', badge: '' },
    { name: 'Executive Workforce Dashboard', category: 'Analytics', icon: '▣', lastRun: '2026-04-01', freq: 'Real-time', badge: 'SA Only' },
    { name: 'Attrition & Workforce Analytics', category: 'Analytics', icon: '▣', lastRun: '2026-03-15', freq: 'Quarterly', badge: '' },
    { name: 'MOM Headcount Report', category: 'Statutory', icon: '◆', lastRun: '2026-01-15', freq: 'Annual', badge: 'MOM Required' },
    { name: 'Training & SDL Analytics', category: 'Training', icon: '◑', lastRun: '2026-03-31', freq: 'Monthly', badge: '' },
    { name: 'Payroll Variance Report', category: 'Financial', icon: '◫', lastRun: '2026-03-28', freq: 'Per Run', badge: '' },
    { name: 'Custom Report Builder', category: 'Analytics', icon: '▤', lastRun: '–', freq: 'On-demand', badge: 'Premium' },
  ];

  const categoryColors: Record<string, string> = {
    Statutory: 'bg-red-50 text-red-600 border-red-100',
    Financial: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    Workforce: 'bg-blue-50 text-blue-600 border-blue-100',
    Analytics: 'bg-indigo-50 text-indigo-600 border-indigo-100',
    Training: 'bg-amber-50 text-amber-600 border-amber-100',
  };

  return (
    <div className="flex flex-col gap-10 max-w-[1400px] mx-auto pb-20 animate-in fade-in duration-700">

      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 bg-white p-10 rounded-[2.5rem] border border-slate-100 shadow-2xl shadow-indigo-500/5 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-40 h-40 bg-emerald-500/5 rounded-full blur-3xl"></div>
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-2 h-2 bg-emerald-600 rounded-full"></div>
            <span className="text-[10px] font-black text-emerald-600 uppercase tracking-[0.4em]">Compliance Intelligence Layer</span>
          </div>
          <h1 className="text-4xl font-black text-slate-900 tracking-tighter">Reports <span className="text-emerald-600">& Analytics</span></h1>
          <p className="text-sm font-bold text-slate-400 mt-2 uppercase tracking-widest max-w-xl">
            Statutory filings, workforce analytics, and custom report generation for MOM, IRAS, and CPF Board compliance.
          </p>
        </div>
        <div className="flex gap-4 relative z-10">
          <button className="px-8 py-4 bg-slate-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 shadow-xl shadow-slate-900/10 transition-all active:scale-95">
            Schedule Delivery
          </button>
          <button className="px-8 py-4 bg-emerald-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-emerald-700 shadow-xl shadow-emerald-500/20 transition-all active:scale-95">
            + Custom Report
          </button>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { label: 'Statutory Due This Month', value: '3', status: 'text-red-600', bg: 'bg-red-50 border-red-100' },
          { label: 'Reports Generated (MTD)', value: '47', status: 'text-slate-900', bg: 'bg-white border-slate-100' },
          { label: 'Scheduled Deliveries', value: '12', status: 'text-indigo-600', bg: 'bg-indigo-50 border-indigo-100' },
          { label: 'Audit Trail Events', value: '1,284', status: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-100' },
        ].map((s) => (
          <div key={s.label} className={`p-8 rounded-[2rem] border shadow-2xl shadow-indigo-500/5 ${s.bg}`}>
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-4">{s.label}</p>
            <h3 className={`text-3xl font-black tracking-tighter ${s.status}`}>{s.value}</h3>
          </div>
        ))}
      </div>

      {/* Reports Matrix */}
      <section className="bg-white rounded-[2.5rem] border border-slate-100 shadow-2xl shadow-indigo-500/5 overflow-hidden">
        <div className="p-8 border-b border-slate-50 flex items-center gap-4">
          <div className="w-2 h-8 bg-emerald-600 rounded-full"></div>
          <h3 className="text-lg font-black text-slate-900 uppercase tracking-widest">Report Registry</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-50">
              <tr>
                <th className="px-8 py-7">Report Name</th>
                <th className="px-8 py-7">Category</th>
                <th className="px-8 py-7">Frequency</th>
                <th className="px-8 py-7">Last Generated</th>
                <th className="px-8 py-7 text-center">Generate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {reports.map((r) => (
                <tr key={r.name} className="group hover:bg-slate-50/50 transition-all duration-300">
                  <td className="px-8 py-5">
                    <div className="flex items-center gap-4">
                      <span className="text-lg text-slate-400 group-hover:text-indigo-500 transition-colors">{r.icon}</span>
                      <div className="flex flex-col">
                        <span className="text-xs font-black text-slate-900 uppercase tracking-tight group-hover:text-indigo-600 transition-colors">{r.name}</span>
                        {r.badge && (
                          <span className="mt-1 inline-block text-[8px] font-black px-2 py-0.5 bg-indigo-50 text-indigo-500 border border-indigo-100 rounded-full uppercase tracking-widest w-fit">{r.badge}</span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-8 py-5">
                    <span className={`text-[9px] font-black px-3 py-1.5 rounded-full border uppercase tracking-widest ${categoryColors[r.category]}`}>{r.category}</span>
                  </td>
                  <td className="px-8 py-5">
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{r.freq}</span>
                  </td>
                  <td className="px-8 py-5">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{r.lastRun}</span>
                  </td>
                  <td className="px-8 py-5 text-center">
                    <button className="px-6 py-2 bg-white border border-slate-200 rounded-xl text-[9px] font-black text-slate-500 uppercase tracking-widest hover:border-emerald-600 hover:text-emerald-600 hover:bg-emerald-50 shadow-sm transition-all active:scale-95">
                      Run Now
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
