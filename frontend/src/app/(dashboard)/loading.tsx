export default function DashboardLoading() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-5">
      <div className="relative">
        <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center shadow-xl shadow-indigo-500/30">
          <span className="font-black text-white text-base italic">V</span>
        </div>
        <div className="absolute -inset-2 rounded-2xl border-2 border-indigo-500/20 border-t-indigo-500 animate-spin" />
      </div>
      <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] animate-pulse">Loading…</p>
    </div>
  );
}
