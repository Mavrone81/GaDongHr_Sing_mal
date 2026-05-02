'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';

// ─── Auth/API helpers ─────────────────────────────────────────────────────────
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

// ─── Types ────────────────────────────────────────────────────────────────────
interface ClaimCategory { id: string; code: string; name: string; maxAmount: number | null; isGstClaimable: boolean; }
interface Claim {
  id: string; date: string; category: string; categoryCode: string;
  merchant: string; amount: number; gst: number;
  description: string; receipt: string | null;
  status: 'Pending' | 'Approved' | 'Rejected'; submittedOn: string;
}

const CATEGORY_ICONS: Record<string, string> = {
  TRANSPORT: '🚌', MEAL: '🍽️', TRAVEL: '✈️', ACCOMMODATION: '🏨',
  TRAINING: '📚', MEDICAL: '🏥', OFFICE: '📎', TELECOM: '📱',
  ENTERTAINMENT: '🥂', OTHER: '◎',
};

function statusStyle(s: Claim['status']) {
  if (s === 'Approved') return 'bg-emerald-50 text-emerald-700 border-emerald-100';
  if (s === 'Rejected') return 'bg-red-50 text-red-600 border-red-100';
  return 'bg-amber-50 text-amber-600 border-amber-100';
}
function fmtDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ─── Shared claim form fields ─────────────────────────────────────────────────
interface ClaimFormState { date: string; categoryId: string; merchant: string; amount: string; description: string; }

// ─── Submit Claim Modal ───────────────────────────────────────────────────────
interface SubmitModalProps {
  onClose: () => void;
  onCreated: (c: Claim) => void;
  categories: ClaimCategory[];
}

function SubmitClaimModal({ onClose, onCreated, categories }: SubmitModalProps) {
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    categoryId: categories[0]?.id ?? '',
    merchant: '',
    amount: '',
    description: '',
  });
  const [receipt, setReceipt] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!form.categoryId && categories.length > 0) setForm(f => ({ ...f, categoryId: categories[0].id }));
  }, [categories]);

  const set = (k: string, v: string) => setForm(prev => ({ ...prev, [k]: v }));
  const amountNum = parseFloat(form.amount) || 0;
  const selectedCat = categories.find(c => c.id === form.categoryId);
  const gst = selectedCat?.isGstClaimable ? parseFloat((amountNum * 0.09 / 1.09).toFixed(2)) : 0;

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = ev => setReceipt(ev.target?.result as string);
    reader.readAsDataURL(f);
  };

  const handleSubmit = async () => {
    if (!form.merchant.trim() || !form.amount || !form.description.trim() || !form.categoryId) return;
    setSubmitting(true); setError(null);
    try {
      const saved = await apiFetch('/claims', {
        method: 'POST',
        body: JSON.stringify({
          categoryId: form.categoryId,
          title: form.merchant,
          description: form.description,
          claimDate: form.date,
          totalAmount: amountNum,
          gstAmount: gst,
        }),
      });
      onCreated({
        id: saved.id,
        date: saved.claimDate.slice(0, 10),
        category: selectedCat?.name ?? form.categoryId,
        categoryCode: selectedCat?.code ?? '',
        merchant: saved.title,
        amount: saved.totalAmount,
        gst: saved.gstAmount ?? 0,
        description: saved.description ?? '',
        receipt: null,
        status: saved.status === 'SUBMITTED' ? 'Pending' : saved.status === 'APPROVED' ? 'Approved' : 'Rejected',
        submittedOn: (saved.submittedAt ?? saved.createdAt).slice(0, 10),
      });
      onClose();
    } catch (e: any) {
      setError(e.message ?? 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-lg border border-slate-100 overflow-hidden animate-in slide-in-from-bottom-8 duration-300 max-h-[90vh] flex flex-col">
        <div className="px-8 py-6 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center shrink-0">
          <div>
            <h3 className="text-lg font-black text-slate-900 uppercase tracking-widest">Submit Claim</h3>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Expense reimbursement request</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 flex items-center justify-center bg-white border border-slate-200 rounded-xl text-slate-400 hover:text-red-500 hover:border-red-200 transition-all text-lg font-black">&times;</button>
        </div>

        <div className="px-8 py-6 flex flex-col gap-5 overflow-y-auto">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Expense Date</label>
              <input type="date" value={form.date} max={new Date().toISOString().slice(0, 10)} onChange={e => set('date', e.target.value)}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 transition-all" />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Category</label>
              <select value={form.categoryId} onChange={e => set('categoryId', e.target.value)}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 transition-all appearance-none">
                {categories.map(c => <option key={c.id} value={c.id}>{CATEGORY_ICONS[c.code] ?? '◎'} {c.name}</option>)}
              </select>
            </div>
          </div>

          {selectedCat?.maxAmount && (
            <div className="px-4 py-3 bg-amber-50 border border-amber-100 rounded-xl">
              <span className="text-[10px] font-black text-amber-700 uppercase tracking-widest">Policy limit: SGD {selectedCat.maxAmount.toFixed(2)} per claim</span>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Merchant / Payee</label>
            <input type="text" value={form.merchant} onChange={e => set('merchant', e.target.value)}
              placeholder="e.g. Grab, Singapore Airlines, NTUC FairPrice…"
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 transition-all placeholder:font-normal placeholder:text-slate-300" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Amount (SGD incl. GST)</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-black text-slate-400">$</span>
                <input type="number" value={form.amount} onChange={e => set('amount', e.target.value)} placeholder="0.00" min="0" step="0.01"
                  className="w-full pl-8 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 transition-all" />
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">GST {selectedCat?.isGstClaimable ? '(9% auto-calculated)' : '(N/A)'}</label>
              <div className="px-4 py-3 bg-indigo-50 border border-indigo-100 rounded-xl">
                <span className="text-sm font-black text-indigo-700">$ {gst.toFixed(2)}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Business Purpose</label>
            <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={2}
              placeholder="Describe the business purpose of this expense…"
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 transition-all resize-none placeholder:font-normal placeholder:text-slate-300" />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Receipt (optional)</label>
            {receipt ? (
              <div className="flex items-center gap-3 px-4 py-3 bg-emerald-50 border border-emerald-100 rounded-xl">
                <svg className="w-4 h-4 text-emerald-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                <span className="text-[11px] font-black text-emerald-700 uppercase tracking-widest flex-1">Receipt attached</span>
                <button onClick={() => setReceipt(null)} className="text-[10px] font-black text-red-400 hover:text-red-600 uppercase transition-all">Remove</button>
              </div>
            ) : (
              <button type="button" onClick={() => fileRef.current?.click()}
                className="flex items-center gap-3 px-4 py-3 bg-slate-50 border border-dashed border-slate-300 rounded-xl text-[11px] font-bold text-slate-400 hover:border-indigo-400 hover:text-indigo-500 hover:bg-indigo-50/30 transition-all">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"/></svg>
                Attach receipt (JPG, PNG, PDF)
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/*,.pdf" className="hidden" onChange={handleFile} />
          </div>

          {error && <p className="text-[10px] font-black text-red-600 bg-red-50 border border-red-100 px-4 py-3 rounded-xl">{error}</p>}
        </div>

        <div className="px-8 py-5 border-t border-slate-100 bg-slate-50/50 flex justify-between items-center shrink-0">
          <div className="text-sm font-black text-slate-900">Total: <span className="text-indigo-600">SGD {amountNum.toFixed(2)}</span></div>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-6 py-3 bg-white border border-slate-200 text-slate-500 font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-slate-50 transition-all">Cancel</button>
            <button onClick={handleSubmit} disabled={!form.merchant.trim() || !form.amount || !form.description.trim() || !form.categoryId || submitting}
              className="px-8 py-3 bg-indigo-600 text-white font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-500/20 disabled:opacity-50 disabled:pointer-events-none flex items-center gap-2">
              {submitting ? <><svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Submitting…</> : 'Submit Claim'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Edit Claim Modal ─────────────────────────────────────────────────────────
interface EditModalProps {
  claim: Claim;
  onClose: () => void;
  onSaved: (updated: Claim) => void;
  categories: ClaimCategory[];
}

function EditClaimModal({ claim, onClose, onSaved, categories }: EditModalProps) {
  const [form, setForm] = useState<ClaimFormState>({
    date: claim.date,
    categoryId: categories.find(c => c.name === claim.category)?.id ?? categories[0]?.id ?? '',
    merchant: claim.merchant,
    amount: String(claim.amount),
    description: claim.description,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: string, v: string) => setForm(prev => ({ ...prev, [k]: v }));
  const amountNum = parseFloat(form.amount) || 0;
  const selectedCat = categories.find(c => c.id === form.categoryId);
  const gst = selectedCat?.isGstClaimable ? parseFloat((amountNum * 0.09 / 1.09).toFixed(2)) : 0;

  const handleSave = async () => {
    if (!form.merchant.trim() || !form.amount || !form.description.trim()) return;
    setSubmitting(true); setError(null);
    try {
      const saved = await apiFetch(`/claims/${claim.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          categoryId: form.categoryId,
          title: form.merchant,
          description: form.description,
          claimDate: form.date,
          totalAmount: amountNum,
          gstAmount: gst,
        }),
      });
      onSaved({
        ...claim,
        date: saved.claimDate.slice(0, 10),
        category: selectedCat?.name ?? claim.category,
        categoryCode: selectedCat?.code ?? claim.categoryCode,
        merchant: saved.title,
        amount: saved.totalAmount,
        gst: saved.gstAmount ?? 0,
        description: saved.description ?? '',
      });
      onClose();
    } catch (e: any) {
      setError(e.message ?? 'Update failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-lg border border-slate-100 overflow-hidden animate-in slide-in-from-bottom-8 duration-300 max-h-[90vh] flex flex-col">
        <div className="px-8 py-6 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center shrink-0">
          <div>
            <h3 className="text-lg font-black text-slate-900 uppercase tracking-widest">Amend Claim</h3>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Edit pending expense · changes saved immediately</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 flex items-center justify-center bg-white border border-slate-200 rounded-xl text-slate-400 hover:text-red-500 hover:border-red-200 transition-all text-lg font-black">&times;</button>
        </div>

        <div className="px-8 py-6 flex flex-col gap-5 overflow-y-auto">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Expense Date</label>
              <input type="date" value={form.date} max={new Date().toISOString().slice(0, 10)} onChange={e => set('date', e.target.value)}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 transition-all" />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Category</label>
              <select value={form.categoryId} onChange={e => set('categoryId', e.target.value)}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 transition-all appearance-none">
                {categories.map(c => <option key={c.id} value={c.id}>{CATEGORY_ICONS[c.code] ?? '◎'} {c.name}</option>)}
              </select>
            </div>
          </div>

          {selectedCat?.maxAmount && (
            <div className="px-4 py-3 bg-amber-50 border border-amber-100 rounded-xl">
              <span className="text-[10px] font-black text-amber-700 uppercase tracking-widest">Policy limit: SGD {selectedCat.maxAmount.toFixed(2)} per claim</span>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Merchant / Payee</label>
            <input type="text" value={form.merchant} onChange={e => set('merchant', e.target.value)}
              placeholder="e.g. Grab, Singapore Airlines, NTUC FairPrice…"
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 transition-all placeholder:font-normal placeholder:text-slate-300" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Amount (SGD incl. GST)</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-black text-slate-400">$</span>
                <input type="number" value={form.amount} onChange={e => set('amount', e.target.value)} placeholder="0.00" min="0" step="0.01"
                  className="w-full pl-8 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 transition-all" />
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">GST {selectedCat?.isGstClaimable ? '(9% auto-calculated)' : '(N/A)'}</label>
              <div className="px-4 py-3 bg-indigo-50 border border-indigo-100 rounded-xl">
                <span className="text-sm font-black text-indigo-700">$ {gst.toFixed(2)}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Business Purpose</label>
            <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={2}
              placeholder="Describe the business purpose of this expense…"
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 transition-all resize-none placeholder:font-normal placeholder:text-slate-300" />
          </div>

          {error && <p className="text-[10px] font-black text-red-600 bg-red-50 border border-red-100 px-4 py-3 rounded-xl">{error}</p>}
        </div>

        <div className="px-8 py-5 border-t border-slate-100 bg-slate-50/50 flex justify-between items-center shrink-0">
          <div className="text-sm font-black text-slate-900">Total: <span className="text-indigo-600">SGD {amountNum.toFixed(2)}</span></div>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-6 py-3 bg-white border border-slate-200 text-slate-500 font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-slate-50 transition-all">Cancel</button>
            <button onClick={handleSave} disabled={!form.merchant.trim() || !form.amount || !form.description.trim() || submitting}
              className="px-8 py-3 bg-indigo-600 text-white font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-500/20 disabled:opacity-50 disabled:pointer-events-none flex items-center gap-2">
              {submitting ? <><svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Saving…</> : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Employee Claims View ─────────────────────────────────────────────────────
function EmployeeClaimsView() {
  const { user } = useAuth();
  const [showModal, setShowModal] = useState(false);
  const [editClaim, setEditClaim] = useState<Claim | null>(null);
  const [categories, setCategories] = useState<ClaimCategory[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [cats, claimsRes] = await Promise.allSettled([
          apiFetch('/claims/categories'),
          user?.employeeId
            ? apiFetch(`/claims?employeeId=${user.employeeId}&limit=100`)
            : apiFetch('/claims?limit=100'),
        ]);
        if (cats.status === 'fulfilled') setCategories((cats.value as ClaimCategory[]).filter((c: any) => c.isActive !== false));
        if (claimsRes.status === 'fulfilled') {
          const list = claimsRes.value.claims ?? [];
          setClaims(list.map((c: any) => ({
            id: c.id,
            date: c.claimDate.slice(0, 10),
            category: c.category?.name ?? c.categoryId,
            categoryCode: c.category?.code ?? '',
            merchant: c.title,
            amount: c.totalAmount,
            gst: c.gstAmount ?? 0,
            description: c.description ?? '',
            receipt: null,
            status: c.status === 'SUBMITTED' ? 'Pending' : c.status === 'APPROVED' ? 'Approved' : c.status === 'REJECTED' ? 'Rejected' : 'Pending',
            submittedOn: (c.submittedAt ?? c.createdAt).slice(0, 10),
          })));
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [user?.employeeId]);

  const totalApproved = claims.filter(c => c.status === 'Approved').reduce((s, c) => s + c.amount, 0);
  const totalPending  = claims.filter(c => c.status === 'Pending').reduce((s, c) => s + c.amount, 0);
  const totalGst      = claims.filter(c => c.status === 'Approved').reduce((s, c) => s + c.gst, 0);

  const handleCreated = (c: Claim) => {
    setClaims(prev => [c, ...prev]);
    setToast(`Claim of SGD ${c.amount.toFixed(2)} submitted for approval`);
    setTimeout(() => setToast(null), 4000);
  };

  const handleSaved = (updated: Claim) => {
    setClaims(prev => prev.map(c => c.id === updated.id ? updated : c));
    setToast(`Claim updated — SGD ${updated.amount.toFixed(2)}`);
    setTimeout(() => setToast(null), 4000);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-10 h-10 border-4 border-indigo-600/20 border-t-indigo-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 max-w-[1100px] mx-auto pb-16 animate-in fade-in duration-700">

      <div className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-xl shadow-indigo-500/5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-5">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tighter">My <span className="text-indigo-600">Claims</span></h1>
          <p className="text-sm font-bold text-slate-400 mt-1 uppercase tracking-widest">Submit and track expense reimbursements</p>
        </div>
        <button onClick={() => setShowModal(true)}
          className="px-6 py-2.5 bg-indigo-600 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-indigo-700 shadow-lg shadow-indigo-500/20 transition-all flex items-center gap-2">
          <span className="text-base leading-none">+</span> Submit Expense
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-7 rounded-[1.5rem] border border-slate-100 shadow-lg shadow-indigo-500/5">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Approved (MTD)</p>
          <p className="text-4xl font-black text-emerald-600 tracking-tighter">SGD {totalApproved.toFixed(2)}</p>
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-3">Approved &amp; ready for payout</p>
        </div>
        <div className="bg-white p-7 rounded-[1.5rem] border border-slate-100 shadow-lg shadow-indigo-500/5">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Pending Review</p>
          <p className="text-4xl font-black text-amber-500 tracking-tighter">SGD {totalPending.toFixed(2)}</p>
          <p className="text-[9px] font-black text-amber-600 uppercase tracking-widest mt-3 flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse" />
            {claims.filter(c => c.status === 'Pending').length} awaiting approval
          </p>
        </div>
        <div className="bg-white p-7 rounded-[1.5rem] border border-slate-100 shadow-lg shadow-indigo-500/5">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">GST Recoverable</p>
          <p className="text-4xl font-black text-indigo-600 tracking-tighter">SGD {totalGst.toFixed(2)}</p>
          <p className="text-[9px] font-black text-emerald-600 uppercase tracking-widest mt-3">IRAS 9% auto-captured</p>
        </div>
      </div>

      {categories.length > 0 && (
        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-xl shadow-indigo-500/5 p-6">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Your Eligible Claim Categories</p>
          <div className="flex flex-wrap gap-2">
            {categories.map(c => (
              <span key={c.id} className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-[10px] font-black text-slate-600 uppercase tracking-wider">
                <span>{CATEGORY_ICONS[c.code] ?? '◎'}</span> {c.name}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-[2rem] border border-slate-100 shadow-xl shadow-indigo-500/5 overflow-hidden">
        <div className="px-8 py-6 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
          <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">My Submissions</h3>
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{claims.length} total</span>
        </div>
        {claims.length === 0 ? (
          <div className="py-20 flex flex-col items-center gap-4">
            <div className="w-16 h-16 bg-slate-50 border-2 border-dashed border-slate-200 rounded-3xl flex items-center justify-center text-2xl">◎</div>
            <p className="text-sm font-black text-slate-400 uppercase tracking-widest">No claims submitted yet</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {claims.map(c => (
              <div key={c.id} className="flex items-center gap-5 px-8 py-5 hover:bg-slate-50/50 transition-all">
                <div className="w-11 h-11 bg-indigo-50 border border-indigo-100 rounded-2xl flex items-center justify-center text-lg shrink-0">
                  {CATEGORY_ICONS[c.categoryCode] ?? '◎'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-black text-slate-900 truncate">{c.merchant}</p>
                    <span className="text-[9px] font-black uppercase px-2 py-0.5 bg-slate-100 text-slate-500 rounded-lg tracking-wider">{c.category}</span>
                  </div>
                  <p className="text-[10px] font-bold text-slate-400 mt-0.5">{fmtDate(c.date)} · "{c.description}"</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-black text-slate-900">SGD {c.amount.toFixed(2)}</p>
                  <p className="text-[9px] font-bold text-slate-400 mt-0.5">GST {c.gst.toFixed(2)}</p>
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  <span className={`text-[9px] font-black uppercase px-3 py-1.5 rounded-xl border tracking-widest ${statusStyle(c.status)}`}>{c.status}</span>
                  {c.status === 'Pending' && (
                    <button onClick={() => setEditClaim(c)}
                      className="text-[9px] font-black uppercase px-3 py-1.5 rounded-xl border border-slate-200 text-slate-400 hover:text-indigo-600 hover:border-indigo-200 hover:bg-indigo-50 tracking-widest transition-all">
                      Edit
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="px-8 py-4 border-t border-slate-100 bg-slate-50/50">
          <p className="text-[9px] font-bold text-slate-300 uppercase tracking-widest text-center">Approved claims are reimbursed with monthly payroll</p>
        </div>
      </div>

      {showModal && <SubmitClaimModal onClose={() => setShowModal(false)} onCreated={handleCreated} categories={categories} />}
      {editClaim && <EditClaimModal claim={editClaim} onClose={() => setEditClaim(null)} onSaved={handleSaved} categories={categories} />}

      {toast && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[200] animate-in slide-in-from-bottom-8 duration-400">
          <div className="bg-slate-900 border border-slate-700 px-8 py-4 rounded-2xl shadow-2xl flex items-center gap-4">
            <div className="w-2 h-2 bg-emerald-500 rounded-full" />
            <span className="text-[10px] font-black text-white uppercase tracking-widest">{toast}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Entry point ──────────────────────────────────────────────────────────────
export default function ClaimsPage() {
  return <EmployeeClaimsView />;
}
