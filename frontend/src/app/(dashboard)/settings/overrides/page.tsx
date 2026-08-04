'use client';

export default function OverridesPage() {
  return (
    <div className="flex flex-col gap-6 p-8 bg-paper border border-rule ">
      <div className="flex items-center gap-3">
        <div className="w-2 h-8 bg-ink animate-pulse" />
        <div>
          <h1 className="text-2xl font-black text-ink tracking-tighter">System Overrides</h1>
          <p className="text-[10px] font-black text-ink uppercase tracking-widest mt-1">SuperAdmin Only · Danger Zone</p>
        </div>
      </div>
      <div className="bg-page p-6 border border-ink">
        <p className="text-sm font-bold text-ink">Emergency controls for overriding forced payroll blocks, resetting clearance checkpoints, or rolling back erroneous GIRO executions.</p>
      </div>
    </div>
  );
}
