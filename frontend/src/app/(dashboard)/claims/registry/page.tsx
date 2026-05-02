'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';

const ALLOWED_ROLES = ['SUPER_ADMIN', 'HR_ADMIN', 'HR_MANAGER', 'FINANCE_ADMIN', 'PAYROLL_OFFICER'];

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

function fmtSGD(n: number) {
  return n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface PendingClaim {
  id: string;
  employeeId: string;
  employeeName: string;
  dept: string;
  categoryName: string;
  title: string;
  claimDate: string;
  totalAmount: number;
  gstAmount: number;
}

export default function ClaimsRegistryPage() {
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
    router.replace('/claims');
    return null;
  }

  return <AdminClaimsView />;
}

function AdminClaimsView() {
  const [claims, setClaims] = useState<PendingClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const data = await apiFetch('/claims?status=SUBMITTED&limit=100');
        const list: any[] = data.claims ?? data ?? [];
        setClaims(list.map((c: any) => ({
          id: c.id,
          employeeId: c.employeeId,
          employeeName: c.employee?.fullName ?? c.employeeId,
          dept: c.employee?.department ?? '—',
          categoryName: c.category?.name ?? c.categoryId ?? '—',
          title: c.title ?? c.merchant ?? '',
          claimDate: (c.claimDate ?? c.createdAt ?? '').slice(0, 10),
          totalAmount: typeof c.totalAmount === 'number' ? c.totalAmount : parseFloat(c.totalAmount ?? '0'),
          gstAmount: typeof c.gstAmount === 'number' ? c.gstAmount : parseFloat(c.gstAmount ?? '0'),
        })));
      } catch (e: any) {
        console.error('[ClaimsRegistry] load failed:', e.message);
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
      await apiFetch(`/claims/${id}/approve`, { method: 'PUT' });
      setClaims(prev => prev.filter(c => c.id !== id));
      showToast('Claim approved', 'success');
    } catch (e: any) { showToast(e.message, 'error'); }
  };

  const handleReject = async (id: string) => {
    try {
      await apiFetch(`/claims/${id}/reject`, { method: 'PUT', body: JSON.stringify({ reason: 'Rejected by Finance' }) });
      setClaims(prev => prev.filter(c => c.id !== id));
      showToast('Claim rejected', 'success');
    } catch (e: any) { showToast(e.message, 'error'); }
  };

  const totalPending = claims.reduce((s, c) => s + c.totalAmount, 0);

  return (
    <div className="flex flex-col gap-6 max-w-[1600px] mx-auto pb-12 animate-in fade-in duration-700">

      <div className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-xl shadow-indigo-500/5 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tighter">Claims <span className="text-indigo-600">Audit</span></h1>
          <p className="text-[10px] font-black text-slate-400 mt-1 uppercase tracking-widest">Reimbursement oversight · Policy compliance</p>
        </div>
        <button className="px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest text-indigo-600 bg-indigo-50 border border-indigo-100 hover:bg-indigo-100 transition-all">
          Download Audit Log
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="bg-white p-7 rounded-[1.5rem] border border-slate-100 shadow-lg shadow-indigo-500/5">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Pending Outflow</p>
          {loading
            ? <div className="h-10 w-32 bg-slate-100 rounded-xl animate-pulse" />
            : <p className="text-4xl font-black text-slate-900 tracking-tighter">SGD {fmtSGD(totalPending)}</p>
          }
          <div className="mt-4 flex items-center gap-2">
            <span className="w-2 h-2 bg-amber-500 rounded-full animate-pulse" />
            {loading
              ? <div className="h-3 w-40 bg-slate-100 rounded animate-pulse" />
              : <p className="text-[9px] font-black text-amber-600 uppercase tracking-widest">{claims.length} pending authorization</p>
            }
          </div>
        </div>
        <div className="bg-slate-900 p-7 rounded-[1.5rem] border border-slate-800 shadow-xl">
          <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-3">Avg. Processing</p>
          <p className="text-4xl font-black text-white tracking-tighter">48h</p>
          <p className="text-[9px] font-black text-slate-500 mt-4 uppercase tracking-widest italic">Target: 24h</p>
        </div>
        <div className="bg-indigo-50/60 p-7 rounded-[1.5rem] border border-indigo-100">
          <p className="text-[10px] font-black text-indigo-700 uppercase tracking-widest mb-3">Policy Compliance</p>
          <p className="text-4xl font-black text-indigo-700 tracking-tighter">98.2%</p>
          <p className="text-[9px] font-black text-indigo-400 mt-4 uppercase tracking-widest italic">2 anomalies in Travel</p>
        </div>
      </div>

      <div className="bg-white rounded-[2rem] border border-slate-100 shadow-xl shadow-indigo-500/5 overflow-hidden">
        <div className="px-8 py-6 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
          <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest">
            Authorization Queue {!loading && `(${claims.length})`}
          </h3>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-indigo-600 rounded-full animate-ping" />
            <span className="text-[9px] font-black text-slate-400 uppercase">Live</span>
          </div>
        </div>
        <div className="divide-y divide-slate-50">
          {loading ? (
            [1, 2, 3].map(i => <div key={i} className="h-20 mx-8 my-3 bg-slate-50 rounded-2xl animate-pulse" />)
          ) : claims.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-sm font-black text-slate-300 uppercase tracking-widest">No pending claims</p>
            </div>
          ) : claims.map(c => (
            <div key={c.id} className="flex items-center gap-5 px-8 py-5 hover:bg-slate-50/50 transition-all">
              <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center text-[11px] font-black text-white shrink-0">
                {c.employeeName.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-black text-slate-900 uppercase tracking-tight">{c.employeeName}</p>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">{c.dept} · {c.claimDate}</p>
                {c.title && <p className="text-[9px] font-bold text-slate-400 mt-0.5 truncate">"{c.title}"</p>}
              </div>
              <div className="text-center shrink-0">
                <span className="text-[9px] font-black uppercase px-2.5 py-1 bg-indigo-50 text-indigo-600 border border-indigo-100 rounded-lg tracking-widest">
                  {c.categoryName}
                </span>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-black text-slate-900">SGD {fmtSGD(c.totalAmount)}</p>
                {c.gstAmount > 0 && <p className="text-[9px] font-bold text-slate-400">GST {fmtSGD(c.gstAmount)}</p>}
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => handleReject(c.id)}
                  className="text-[9px] font-black text-red-600 bg-red-50 border border-red-100 uppercase tracking-widest px-4 py-1.5 rounded-lg hover:bg-red-100 transition-all"
                >
                  Reject
                </button>
                <button
                  onClick={() => handleApprove(c.id)}
                  className="text-[9px] font-black text-white bg-indigo-600 uppercase tracking-widest px-4 py-1.5 rounded-lg hover:bg-indigo-700 transition-all"
                >
                  Approve
                </button>
              </div>
            </div>
          ))}
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
