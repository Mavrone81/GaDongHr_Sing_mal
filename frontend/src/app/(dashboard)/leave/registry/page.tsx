'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';

const ALLOWED_ROLES = ['SUPER_ADMIN', 'HR_ADMIN', 'HR_MANAGER', 'PAYROLL_OFFICER'];

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  const c = document.cookie.split('; ').find(r => r.startsWith('vorkhive_token='));
  return c ? c.split('=').slice(1).join('=') : null;
}
function apiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? `http://${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:4000/api`;
}
async function apiFetch(path: string, opts: RequestInit = {}) {
  const token = getToken();
  const h: Record<string, string> = { 'Content-Type': 'application/json', ...(opts.headers as Record<string, string> ?? {}) };
  if (token) h['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${apiBase()}${path}`, { ...opts, headers: h });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error ?? `HTTP ${res.status}`); }
  return res.json();
}

function fmtDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
}

interface PendingLeave {
  id: string;
  employeeId: string;
  employeeName: string;
  dept: string;
  leaveTypeName: string;
  from: string;
  to: string;
  days: number;
  reason: string;
}

export default function LeaveRegistryPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-10 h-10 border-4 border-indigo-600/20 border-t-indigo-600 rounded-full animate-spin" />
      </div>
    );
  }

  const role = user?.role?.toUpperCase() ?? '';
  if (!ALLOWED_ROLES.includes(role)) {
    router.replace('/leave');
    return null;
  }

  return <AdminLeaveView />;
}

function AdminLeaveView() {
  const [activeTab, setActiveTab] = useState<'approvals' | 'calendar'>('approvals');
  const [pending, setPending] = useState<PendingLeave[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const data = await apiFetch('/leave/applications?status=PENDING&limit=100');
        const apps = data.applications ?? [];
        setPending(apps.map((a: any) => ({
          id: a.id,
          employeeId: a.employeeId,
          employeeName: a.employee?.fullName ?? a.employeeId,
          dept: a.employee?.department ?? '—',
          leaveTypeName: a.leaveType?.name ?? a.leaveTypeId,
          from: a.startDate.slice(0, 10),
          to: a.endDate.slice(0, 10),
          days: a.totalDays,
          reason: a.reason ?? '',
        })));
      } catch (e: any) {
        console.error('[LeaveRegistry] load failed:', e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const showToast = (msg: string, type: 'success' | 'error') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const handleApprove = async (id: string) => {
    try {
      await apiFetch(`/leave/applications/${id}/approve`, { method: 'PUT' });
      setPending(prev => prev.filter(p => p.id !== id));
      showToast('Leave approved', 'success');
    } catch (e: any) { showToast(e.message, 'error'); }
  };

  const handleReject = async (id: string) => {
    try {
      await apiFetch(`/leave/applications/${id}/reject`, { method: 'PUT', body: JSON.stringify({ reason: 'Rejected by HR' }) });
      setPending(prev => prev.filter(p => p.id !== id));
      showToast('Leave rejected', 'success');
    } catch (e: any) { showToast(e.message, 'error'); }
  };

  return (
    <div className="flex flex-col gap-6 max-w-[1600px] mx-auto pb-12 animate-in fade-in duration-700">

      <div className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-xl shadow-indigo-500/5 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tighter">Leave <span className="text-indigo-600">Management</span></h1>
          <p className="text-[10px] font-black text-slate-400 mt-1 uppercase tracking-widest">Organizational leave portal · Statutory compliance</p>
        </div>
        <button className="px-6 py-2.5 rounded-xl text-[10px] font-black text-indigo-600 bg-indigo-50 border border-indigo-100 hover:bg-indigo-100 transition-all uppercase tracking-widest">
          Export Data
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="bg-white p-7 rounded-[1.5rem] border border-slate-100 shadow-lg shadow-indigo-500/5">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Pending Approval</p>
          {loading ? <div className="h-10 w-16 bg-slate-100 rounded-xl animate-pulse" /> : <p className="text-4xl font-black text-amber-500">{pending.length}</p>}
          <p className="text-[9px] font-black text-amber-600 mt-4 uppercase tracking-widest flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse" />
            Awaiting decision
          </p>
        </div>
        <div className="bg-slate-900 p-7 rounded-[1.5rem] border border-slate-800 shadow-xl">
          <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-3">Currently on Leave</p>
          <p className="text-4xl font-black text-white">—</p>
          <p className="text-[9px] font-black text-slate-500 mt-4 uppercase tracking-widest italic">Live data</p>
        </div>
        <div className="bg-emerald-50/60 p-7 rounded-[1.5rem] border border-emerald-100">
          <p className="text-[10px] font-black text-emerald-700 uppercase tracking-widest mb-3 text-center">Total Submissions</p>
          <p className="text-4xl font-black text-emerald-800 text-center">{loading ? '—' : pending.length}</p>
        </div>
      </div>

      <div className="bg-white border border-slate-100 rounded-[2rem] shadow-xl shadow-indigo-500/5 overflow-hidden">
        <div className="border-b border-slate-100 px-8 flex gap-8 bg-slate-50/50">
          {(['approvals', 'calendar'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`py-5 text-[11px] font-black uppercase tracking-widest border-b-2 transition-all ${activeTab === tab ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
              {tab === 'approvals' ? `Authorization Queue (${loading ? '…' : pending.length})` : 'Team Calendar'}
            </button>
          ))}
        </div>
        <div className="p-8">
          {activeTab === 'approvals' && (
            <div className="flex flex-col gap-3">
              {loading ? (
                [1,2,3].map(i => <div key={i} className="h-20 bg-slate-50 rounded-2xl animate-pulse" />)
              ) : pending.length === 0 ? (
                <div className="py-16 text-center">
                  <p className="text-sm font-black text-slate-300 uppercase tracking-widest">No pending leave applications</p>
                </div>
              ) : pending.map(req => (
                <div key={req.id} className="flex items-center gap-5 p-5 rounded-2xl border bg-slate-50/50 border-slate-100 hover:border-indigo-100 transition-all">
                  <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center text-[11px] font-black text-white shrink-0">
                    {req.employeeName.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-slate-900 uppercase tracking-tight text-sm">{req.employeeName}</p>
                    <p className="text-[10px] font-bold text-slate-500 mt-0.5 uppercase tracking-widest">{req.dept} · {req.leaveTypeName} · {req.days} day{req.days > 1 ? 's' : ''}</p>
                    <p className="text-[10px] font-bold text-slate-400 mt-0.5">{fmtDate(req.from)} → {fmtDate(req.to)}</p>
                    {req.reason && <p className="text-[9px] font-bold text-slate-400 mt-0.5 truncate">"{req.reason}"</p>}
                  </div>
                  <div className="flex gap-3 shrink-0">
                    <button onClick={() => handleReject(req.id)} className="px-5 py-2 bg-red-50 text-red-600 border border-red-100 text-[9px] font-black uppercase tracking-widest rounded-lg hover:bg-red-100 transition-all">Reject</button>
                    <button onClick={() => handleApprove(req.id)} className="px-5 py-2 bg-indigo-600 text-white text-[9px] font-black uppercase tracking-widest rounded-lg hover:bg-indigo-700 shadow-lg shadow-indigo-500/15 transition-all">Approve</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {activeTab === 'calendar' && (
            <div className="h-80 flex flex-col items-center justify-center bg-slate-50 rounded-2xl border border-dashed border-slate-200">
              <div className="w-14 h-14 bg-slate-900 rounded-2xl flex items-center justify-center text-xl mb-4 shadow-xl border border-slate-800">📅</div>
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">Team Availability Calendar</h3>
              <p className="text-[10px] font-bold mt-2 text-slate-400 uppercase tracking-widest text-center max-w-xs">Integrating leave data for team overlap visualization</p>
            </div>
          )}
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[200] animate-in slide-in-from-bottom-8 duration-300">
          <div className={`px-8 py-4 rounded-2xl shadow-2xl flex items-center gap-4 ${toast.type === 'success' ? 'bg-slate-900 border border-slate-700' : 'bg-red-900 border border-red-700'}`}>
            <div className={`w-2 h-2 rounded-full ${toast.type === 'success' ? 'bg-emerald-500' : 'bg-red-400'}`} />
            <span className="text-[10px] font-black text-white uppercase tracking-widest">{toast.msg}</span>
          </div>
        </div>
      )}
    </div>
  );
}
