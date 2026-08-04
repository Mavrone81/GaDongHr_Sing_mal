export default function DashboardLoading() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-5">
      <div className="relative">
        <div className="w-10 h-10 bg-accent flex items-center justify-center ">
          <span className="font-black text-paper text-base italic">V</span>
        </div>
        <div className="absolute -inset-2 border-2 border-accent border-accent animate-spin rounded-full" />
      </div>
      <p className="text-[10px] font-black text-muted uppercase tracking-[0.3em] animate-pulse">Loading…</p>
    </div>
  );
}
