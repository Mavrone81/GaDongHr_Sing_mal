'use client';

export default function TrainingPage() {
  const courses = [
    { name: 'Workplace Safety & Health (WSH)', provider: 'SSG Approved', seats: 20, enrolled: 14, date: '2026-05-10', sdl: true, grant: 'ETS' },
    { name: 'Data Protection Officer (DPO) Fundamentals', provider: 'IAPP', seats: 10, enrolled: 6, date: '2026-05-18', sdl: false, grant: 'SFEC' },
    { name: 'Leadership & Management Programme', provider: 'Internal', seats: 15, enrolled: 15, date: '2026-04-28', sdl: true, grant: '' },
    { name: 'Excel for HR Analytics', provider: 'SkillsFuture', seats: 25, enrolled: 9, date: '2026-06-02', sdl: false, grant: 'SkillsFuture' },
  ];

  return (
    <div className="flex flex-col gap-10 max-w-[1400px] mx-auto pb-20 animate-in fade-in duration-700">

      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 bg-white p-10 rounded-[2.5rem] border border-slate-100 shadow-2xl shadow-indigo-500/5 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-36 h-36 bg-amber-500/5 rounded-full blur-3xl"></div>
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-2 h-2 bg-amber-500 rounded-full"></div>
            <span className="text-[10px] font-black text-amber-600 uppercase tracking-[0.4em]">Learning & Development Layer</span>
          </div>
          <h1 className="text-4xl font-black text-slate-900 tracking-tighter">Training <span className="text-amber-600">& Development</span></h1>
          <p className="text-sm font-bold text-slate-400 mt-2 uppercase tracking-widest max-w-xl">
            Course management, SDL / ETS / SFEC grant tracking, and SkillsFuture absentee payroll claims.
          </p>
        </div>
        <div className="flex gap-4 relative z-10">
          <button className="px-8 py-4 bg-amber-500 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-amber-600 shadow-xl shadow-amber-500/20 transition-all active:scale-95">
            + Schedule Course
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { label: 'Active Courses', value: '4', color: 'text-amber-600' },
          { label: 'Total Enrolled', value: '44', color: 'text-slate-900' },
          { label: 'SDL Claimable (MTD)', value: '$2,340', color: 'text-emerald-600' },
          { label: 'Grants Pending', value: '3', color: 'text-indigo-600' },
        ].map((k) => (
          <div key={k.label} className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-2xl shadow-indigo-500/5">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-4">{k.label}</p>
            <h3 className={`text-3xl font-black tracking-tighter ${k.color}`}>{k.value}</h3>
          </div>
        ))}
      </div>

      {/* Courses Table */}
      <section className="bg-white rounded-[2.5rem] border border-slate-100 shadow-2xl shadow-indigo-500/5 overflow-hidden">
        <div className="p-8 border-b border-slate-50 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <div className="w-2 h-8 bg-amber-500 rounded-full"></div>
            <h3 className="text-lg font-black text-slate-900 uppercase tracking-widest">Course Registry</h3>
          </div>
          <button className="px-6 py-3 bg-white border border-slate-200 text-[10px] font-black text-slate-500 uppercase tracking-widest rounded-xl hover:bg-slate-50 transition-all">
            SDL Report
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-50">
              <tr>
                <th className="px-8 py-7">Course</th>
                <th className="px-8 py-7">Provider</th>
                <th className="px-8 py-7">Date</th>
                <th className="px-8 py-7">Enrolment</th>
                <th className="px-8 py-7">Grant</th>
                <th className="px-8 py-7 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {courses.map((c) => (
                <tr key={c.name} className="group hover:bg-slate-50/50 transition-all">
                  <td className="px-8 py-5">
                    <div className="flex flex-col">
                      <span className="text-xs font-black text-slate-900 uppercase tracking-tight group-hover:text-amber-600 transition-colors">{c.name}</span>
                      {c.sdl && (
                        <span className="mt-1 text-[8px] font-black px-2 py-0.5 bg-amber-50 text-amber-600 border border-amber-100 rounded-full uppercase w-fit">SDL Eligible</span>
                      )}
                    </div>
                  </td>
                  <td className="px-8 py-5">
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{c.provider}</span>
                  </td>
                  <td className="px-8 py-5">
                    <span className="text-[10px] font-black text-slate-400 uppercase">{c.date}</span>
                  </td>
                  <td className="px-8 py-5">
                    <div className="flex items-center gap-3">
                      <div className="w-24 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-amber-500 rounded-full"
                          style={{ width: `${(c.enrolled / c.seats) * 100}%` }}
                        ></div>
                      </div>
                      <span className="text-[10px] font-black text-slate-500">{c.enrolled}/{c.seats}</span>
                    </div>
                  </td>
                  <td className="px-8 py-5">
                    {c.grant ? (
                      <span className="text-[9px] font-black px-3 py-1.5 bg-emerald-50 text-emerald-600 border border-emerald-100 rounded-full uppercase tracking-widest">{c.grant}</span>
                    ) : (
                      <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest">—</span>
                    )}
                  </td>
                  <td className="px-8 py-5 text-right">
                    <div className="flex justify-end gap-2">
                      <button className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-[9px] font-black text-slate-500 uppercase hover:border-amber-500 hover:text-amber-600 transition-all">Nominate</button>
                      <button className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-[9px] font-black text-slate-500 uppercase hover:border-indigo-500 hover:text-indigo-600 transition-all">Manage</button>
                    </div>
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
