export default function DashboardLoading() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3" role="status">
      <div className="w-8 h-8 border-[3px] border-rule border-t-accent animate-spin rounded-full" />
      <p className="text-sm text-muted">Loading…</p>
    </div>
  );
}
