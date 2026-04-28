'use client';

export default function PdpaPage() {
  return (
    <div className="flex flex-col gap-6 p-8 bg-white border border-slate-100 rounded-[2.5rem] shadow-2xl shadow-indigo-500/5">
      <div className="flex items-center gap-3">
        <div className="w-2 h-8 bg-violet-500 rounded-full" />
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tighter">PDPA Compliance</h1>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">SuperAdmin Only · Data Privacy & Retention</p>
        </div>
      </div>
      <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
        <p className="text-sm font-bold text-slate-600">Manage NRIC masking algorithms, configure data retention periods, and execute statutory record disposal requests under PDPA 2012.</p>
      </div>
    </div>
  );
}
