'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';

const ALLOWED_ROLES = ['SUPER_ADMIN', 'HR_ADMIN', 'HR_MANAGER', 'FINANCE_ADMIN', 'PAYROLL_OFFICER'];

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
        <div className="w-10 h-10 border-4 border-accent border-t-accent animate-spin rounded-full" />
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

      <div className="bg-paper p-8 border border-rule flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-black text-ink tracking-tighter">Claims <span className="text-accent">Audit</span></h1>
          <p className="text-[10px] font-black text-muted mt-1 uppercase tracking-widest">Reimbursement oversight · Policy compliance</p>
        </div>
        <button className="px-6 py-2.5 text-[10px] font-black uppercase tracking-widest text-accent bg-page border border-accent hover:bg-page transition-all">
          Download Audit Log
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="bg-paper p-7 border border-rule ">
          <p className="eyebrow-tight mb-3">Pending Outflow</p>
          {loading
            ? <div className="h-10 w-32 bg-page animate-pulse" />
            : <p className="text-4xl font-black text-ink tracking-tighter">SGD {fmtSGD(totalPending)}</p>
          }
          <div className="mt-4 flex items-center gap-2">
            <span className="w-2 h-2 bg-highlight animate-pulse" />
            {loading
              ? <div className="h-3 w-40 bg-page animate-pulse" />
              : <p className="text-[9px] font-black text-ink uppercase tracking-widest">{claims.length} pending authorization</p>
            }
          </div>
        </div>
        <div className="bg-shadow p-7 border border-shadow ">
          <p className="text-[10px] font-black text-accent uppercase tracking-widest mb-3">Avg. Processing</p>
          <p className="text-4xl font-black text-paper tracking-tighter">48h</p>
          <p className="text-[9px] font-black text-muted mt-4 uppercase tracking-widest italic">Target: 24h</p>
        </div>
        <div className="bg-page p-7 border border-accent">
          <p className="text-[10px] font-black text-accent uppercase tracking-widest mb-3">Policy Compliance</p>
          <p className="text-4xl font-black text-accent tracking-tighter">98.2%</p>
          <p className="text-[9px] font-black text-accent mt-4 uppercase tracking-widest italic">2 anomalies in Travel</p>
        </div>
      </div>

      <div className="bg-paper border border-rule overflow-hidden">
        <div className="px-8 py-6 border-b border-rule bg-page flex items-center justify-between">
          <h3 className="text-sm font-black text-ink uppercase tracking-widest">
            Authorization Queue {!loading && `(${claims.length})`}
          </h3>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-accent animate-ping" />
            <span className="text-[9px] font-black text-muted uppercase">Live</span>
          </div>
        </div>
        <div className="divide-y divide-rule">
          {loading ? (
            [1, 2, 3].map(i => <div key={i} className="h-20 mx-8 my-3 bg-page animate-pulse" />)
          ) : claims.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-sm font-black text-muted uppercase tracking-widest">No pending claims</p>
            </div>
          ) : claims.map(c => (
            <div key={c.id} className="flex items-center gap-5 px-8 py-5 hover:bg-page transition-all">
              <div className="w-10 h-10 bg-shadow flex items-center justify-center text-[11px] font-black text-paper shrink-0">
                {c.employeeName.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-black text-ink uppercase tracking-tight">{c.employeeName}</p>
                <p className="text-[10px] font-bold text-muted uppercase tracking-widest mt-0.5">{c.dept} · {c.claimDate}</p>
                {c.title && <p className="text-[9px] font-bold text-muted mt-0.5 truncate">&quot;{c.title}&quot;</p>}
              </div>
              <div className="text-center shrink-0">
                <span className="text-[9px] font-black uppercase px-2.5 py-1 bg-page text-accent border border-accent tracking-widest">
                  {c.categoryName}
                </span>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-black text-ink">SGD {fmtSGD(c.totalAmount)}</p>
                {c.gstAmount > 0 && <p className="text-[9px] font-bold text-muted">GST {fmtSGD(c.gstAmount)}</p>}
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => handleReject(c.id)}
                  className="text-[9px] font-black text-ink bg-page border border-ink uppercase tracking-widest px-4 py-1.5 hover:bg-page transition-all"
                >
                  Reject
                </button>
                <button
                  onClick={() => handleApprove(c.id)}
                  className="text-[9px] font-black text-paper bg-accent uppercase tracking-widest px-4 py-1.5 hover:bg-accent transition-all"
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
          <div className={`px-8 py-4   flex items-center gap-4 ${toast.type === 'success' ? 'bg-shadow border border-shadow' : 'bg-ink border border-ink'}`}>
            <div className={`w-2 h-2  ${toast.type === 'success' ? 'bg-accent' : 'bg-ink'}`} />
            <span className="text-[10px] font-black text-paper uppercase tracking-widest">{toast.msg}</span>
          </div>
        </div>
      )}
    </div>
  );
}
