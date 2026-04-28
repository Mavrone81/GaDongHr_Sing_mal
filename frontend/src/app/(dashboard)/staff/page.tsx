'use client';

export default function StaffDirectoryPage() {
  const staff = [
    { name: 'Johnathan Lim', role: 'Engineering Lead', dept: 'Engineering', email: 'jlim@ezyhrm.sg', ext: '201' },
    { name: 'Sarah Tan', role: 'Marketing Manager', dept: 'Marketing', email: 'stan@ezyhrm.sg', ext: '305' },
    { name: 'David Chen', role: 'Finance Director', dept: 'Finance', email: 'dchen@ezyhrm.sg', ext: '402' },
    { name: 'Amanda Leong', role: 'HR Business Partner', dept: 'Human Resources', email: 'aleong@ezyhrm.sg', ext: '107' },
    { name: 'Marcus Ng', role: 'Sales Executive', dept: 'Sales', email: 'mng@ezyhrm.sg', ext: '510' },
    { name: 'Priya Sharma', role: 'Operations Analyst', dept: 'Operations', email: 'psharma@ezyhrm.sg', ext: '620' },
  ];

  return (
    <div className="flex flex-col gap-10 max-w-[1400px] mx-auto pb-20 animate-in fade-in duration-700">
      <div className="bg-white p-10 rounded-[2.5rem] border border-slate-100 shadow-2xl shadow-indigo-500/5">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-2 h-2 bg-indigo-600 rounded-full"></div>
          <span className="text-[10px] font-black text-indigo-600 uppercase tracking-[0.4em]">Internal Directory</span>
        </div>
        <h1 className="text-4xl font-black text-slate-900 tracking-tighter">Staff <span className="text-indigo-600">Directory</span></h1>
        <p className="text-sm font-bold text-slate-400 mt-2 uppercase tracking-widest">Find your colleagues and contact information.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {staff.map((s) => (
          <div key={s.name} className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-2xl shadow-indigo-500/5 group hover:border-indigo-600/20 transition-all">
            <div className="flex items-center gap-4 mb-5">
              <div className="w-14 h-14 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-center text-xs font-black text-indigo-400 group-hover:scale-110 transition-transform duration-500">
                {s.name.split(' ').map((n: string) => n[0]).join('')}
              </div>
              <div>
                <p className="text-sm font-black text-slate-900 uppercase tracking-tight group-hover:text-indigo-600 transition-colors">{s.name}</p>
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-1">{s.role}</p>
              </div>
            </div>
            <div className="space-y-2 pt-4 border-t border-slate-50">
              <div className="flex justify-between items-center">
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Department</span>
                <span className="text-[9px] font-black text-slate-600 uppercase">{s.dept}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Email</span>
                <span className="text-[9px] font-bold text-indigo-600">{s.email}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Ext.</span>
                <span className="text-[9px] font-black text-slate-600">#{s.ext}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
