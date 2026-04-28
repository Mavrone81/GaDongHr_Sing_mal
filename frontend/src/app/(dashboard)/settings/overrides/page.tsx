'use client';

export default function OverridesPage() {
  return (
    <div className="flex flex-col gap-6 p-8 bg-white border border-slate-100 rounded-[2.5rem] shadow-2xl shadow-indigo-500/5">
      <div className="flex items-center gap-3">
        <div className="w-2 h-8 bg-red-500 rounded-full animate-pulse" />
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tighter">System Overrides</h1>
          <p className="text-[10px] font-black text-red-500 uppercase tracking-widest mt-1">SuperAdmin Only · Danger Zone</p>
        </div>
      </div>
      <div className="bg-red-50 p-6 rounded-2xl border border-red-100">
        <p className="text-sm font-bold text-red-700">Emergency controls for overriding forced payroll blocks, resetting clearance checkpoints, or rolling back erroneous GIRO executions.</p>
      </div>
    </div>
  );
}
