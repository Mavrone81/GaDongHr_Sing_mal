'use client';

export default function AuditPage() {
  return (
    <div className="flex flex-col gap-6 p-8 bg-white border border-slate-100 rounded-[2.5rem] shadow-2xl shadow-indigo-500/5">
      <div className="flex items-center gap-3">
        <div className="w-2 h-8 bg-violet-500 rounded-full" />
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tighter">System Audit Logs</h1>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">SuperAdmin Only · Immutable Record Ledger</p>
        </div>
      </div>
      <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
        <p className="text-sm font-bold text-slate-600">Read-only immutable tamper-evident audit ledger capturing all user actions, logins, CRUD operations, and emergency overrides across all tenants.</p>
      </div>
    </div>
  );
}
