'use client';

import { useState, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Claim {
  id: string;
  date: string;
  category: string;
  merchant: string;
  amount: number;
  gst: number;
  description: string;
  receipt: string | null;
  status: 'Pending' | 'Approved' | 'Rejected';
  submittedOn: string;
}

// ─── Claim categories (HR admin controls which are enabled per employee) ──────

const CLAIM_CATEGORIES = [
  { value: 'TRANSPORT', label: 'Transport', icon: '🚌' },
  { value: 'MEAL', label: 'Meals & Entertainment', icon: '🍽️' },
  { value: 'TRAVEL', label: 'Business Travel', icon: '✈️' },
  { value: 'ACCOMMODATION', label: 'Accommodation', icon: '🏨' },
  { value: 'TRAINING', label: 'Training & Education', icon: '📚' },
  { value: 'MEDICAL', label: 'Medical / Dental', icon: '🏥' },
  { value: 'OFFICE', label: 'Office Supplies', icon: '📎' },
  { value: 'TELECOM', label: 'Telecommunication', icon: '📱' },
  { value: 'OTHER', label: 'Other', icon: '◎' },
];

// ─── Submit Claim Modal ───────────────────────────────────────────────────────

interface SubmitModalProps {
  onClose: () => void;
  onSubmit: (c: Omit<Claim, 'id' | 'status' | 'submittedOn'>) => void;
}

function SubmitClaimModal({ onClose, onSubmit }: SubmitModalProps) {
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    category: 'TRANSPORT',
    merchant: '',
    amount: '',
    description: '',
  });
  const [receipt, setReceipt] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const set = (k: string, v: string) => setForm(prev => ({ ...prev, [k]: v }));
  const amountNum = parseFloat(form.amount) || 0;
  const gst = parseFloat((amountNum * 0.09 / 1.09).toFixed(2));

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = (ev) => setReceipt(ev.target?.result as string);
    reader.readAsDataURL(f);
  };

  const handleSubmit = async () => {
    if (!form.merchant.trim() || !form.amount || !form.description.trim()) return;
    setSubmitting(true);
    await new Promise(r => setTimeout(r, 800));
    const cat = CLAIM_CATEGORIES.find(c => c.value === form.category);
    onSubmit({
      date: form.date,
      category: cat?.label ?? form.category,
      merchant: form.merchant,
      amount: amountNum,
      gst,
      description: form.description,
      receipt,
    });
    setSubmitting(false);
    onClose();
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
          {/* Date + Category row */}
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Expense Date</label>
              <input
                type="date"
                value={form.date}
                max={new Date().toISOString().slice(0, 10)}
                onChange={e => set('date', e.target.value)}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 transition-all"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Category</label>
              <select
                value={form.category}
                onChange={e => set('category', e.target.value)}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 transition-all appearance-none"
              >
                {CLAIM_CATEGORIES.map(c => (
                  <option key={c.value} value={c.value}>{c.icon} {c.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Merchant */}
          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Merchant / Payee</label>
            <input
              type="text"
              value={form.merchant}
              onChange={e => set('merchant', e.target.value)}
              placeholder="e.g. Grab, Singapore Airlines, NTUC FairPrice…"
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 transition-all placeholder:font-normal placeholder:text-slate-300"
            />
          </div>

          {/* Amount + GST */}
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Amount (SGD incl. GST)</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-black text-slate-400">$</span>
                <input
                  type="number"
                  value={form.amount}
                  onChange={e => set('amount', e.target.value)}
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                  className="w-full pl-8 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 transition-all"
                />
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">GST (9% auto-calculated)</label>
              <div className="px-4 py-3 bg-indigo-50 border border-indigo-100 rounded-xl">
                <span className="text-sm font-black text-indigo-700">$ {gst.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Description */}
          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Business Purpose</label>
            <textarea
              value={form.description}
              onChange={e => set('description', e.target.value)}
              rows={2}
              placeholder="Describe the business purpose of this expense…"
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 transition-all resize-none placeholder:font-normal placeholder:text-slate-300"
            />
          </div>

          {/* Receipt upload */}
          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Receipt (optional)</label>
            {receipt ? (
              <div className="flex items-center gap-3 px-4 py-3 bg-emerald-50 border border-emerald-100 rounded-xl">
                <svg className="w-4 h-4 text-emerald-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <span className="text-[11px] font-black text-emerald-700 uppercase tracking-widest flex-1">Receipt attached</span>
                <button onClick={() => setReceipt(null)} className="text-[10px] font-black text-red-400 hover:text-red-600 uppercase transition-all">Remove</button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-3 px-4 py-3 bg-slate-50 border border-dashed border-slate-300 rounded-xl text-[11px] font-bold text-slate-400 hover:border-indigo-400 hover:text-indigo-500 hover:bg-indigo-50/30 transition-all"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
                Attach receipt (JPG, PNG, PDF)
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/*,.pdf" className="hidden" onChange={handleFile} />
          </div>
        </div>

        <div className="px-8 py-5 border-t border-slate-100 bg-slate-50/50 flex justify-between items-center shrink-0">
          <div className="text-sm font-black text-slate-900">
            Total: <span className="text-indigo-600">SGD {amountNum.toFixed(2)}</span>
          </div>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-6 py-3 bg-white border border-slate-200 text-slate-500 font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-slate-50 transition-all">Cancel</button>
            <button
              onClick={handleSubmit}
              disabled={!form.merchant.trim() || !form.amount || !form.description.trim() || submitting}
              className="px-8 py-3 bg-indigo-600 text-white font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-500/20 disabled:opacity-50 disabled:pointer-events-none flex items-center gap-2"
            >
              {submitting ? (
                <><svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>Submitting…</>
              ) : 'Submit Claim'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Status styling ───────────────────────────────────────────────────────────

function statusStyle(s: Claim['status']) {
  if (s === 'Approved') return 'bg-emerald-50 text-emerald-700 border-emerald-100';
  if (s === 'Rejected') return 'bg-red-50 text-red-600 border-red-100';
  return 'bg-amber-50 text-amber-600 border-amber-100';
}

function fmtDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ─── Employee claims view ─────────────────────────────────────────────────────

const INITIAL_CLAIMS: Claim[] = [
  { id: 'CLM-001', date: '2026-04-01', category: 'Transport', merchant: 'Grab Holdings', amount: 45.50, gst: 3.76, description: 'Client visit - Tanjong Pagar', receipt: null, status: 'Approved', submittedOn: '2026-04-02' },
  { id: 'CLM-002', date: '2026-04-15', category: 'Meals & Entertainment', merchant: 'Crystal Jade', amount: 128.00, gst: 10.57, description: 'Team lunch Q2 review', receipt: null, status: 'Pending', submittedOn: '2026-04-15' },
];

function EmployeeClaimsView() {
  const [showModal, setShowModal] = useState(false);
  const [claims, setClaims] = useState<Claim[]>(INITIAL_CLAIMS);
  const [toast, setToast] = useState<string | null>(null);

  const totalApproved = claims.filter(c => c.status === 'Approved').reduce((s, c) => s + c.amount, 0);
  const totalPending = claims.filter(c => c.status === 'Pending').reduce((s, c) => s + c.amount, 0);
  const totalGst = claims.filter(c => c.status === 'Approved').reduce((s, c) => s + c.gst, 0);

  const handleSubmit = (c: Omit<Claim, 'id' | 'status' | 'submittedOn'>) => {
    setClaims(prev => [{
      ...c,
      id: `CLM-${String(prev.length + 3).padStart(3, '0')}`,
      status: 'Pending',
      submittedOn: new Date().toISOString().slice(0, 10),
    }, ...prev]);
    setToast(`Claim of SGD ${c.amount.toFixed(2)} submitted for approval`);
    setTimeout(() => setToast(null), 4000);
  };

  return (
    <div className="flex flex-col gap-6 max-w-[1100px] mx-auto pb-16 animate-in fade-in duration-700">

      {/* Header */}
      <div className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-xl shadow-indigo-500/5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-5">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tighter">My <span className="text-indigo-600">Claims</span></h1>
          <p className="text-sm font-bold text-slate-400 mt-1 uppercase tracking-widest">Submit and track expense reimbursements</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="px-6 py-2.5 bg-indigo-600 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-indigo-700 shadow-lg shadow-indigo-500/20 transition-all flex items-center gap-2"
        >
          <span className="text-base leading-none">+</span> Submit Expense
        </button>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-7 rounded-[1.5rem] border border-slate-100 shadow-lg shadow-indigo-500/5">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Approved (MTD)</p>
          <p className="text-4xl font-black text-emerald-600 tracking-tighter">SGD {totalApproved.toFixed(2)}</p>
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-3">Next payout: 25 May 2026</p>
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

      {/* Eligible categories (HR-configured) */}
      <div className="bg-white rounded-[2rem] border border-slate-100 shadow-xl shadow-indigo-500/5 p-6">
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Your Eligible Claim Categories</p>
        <div className="flex flex-wrap gap-2">
          {CLAIM_CATEGORIES.map(c => (
            <span key={c.value} className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-[10px] font-black text-slate-600 uppercase tracking-wider">
              <span>{c.icon}</span> {c.label}
            </span>
          ))}
        </div>
        <p className="text-[9px] font-bold text-slate-300 uppercase tracking-widest mt-3">Categories configured by HR Admin during onboarding</p>
      </div>

      {/* Claims history */}
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
                {/* Category icon */}
                <div className="w-11 h-11 bg-indigo-50 border border-indigo-100 rounded-2xl flex items-center justify-center text-lg shrink-0">
                  {CLAIM_CATEGORIES.find(cat => cat.label === c.category)?.icon ?? '◎'}
                </div>
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-black text-slate-900 truncate">{c.merchant}</p>
                    <span className="text-[9px] font-black uppercase px-2 py-0.5 bg-slate-100 text-slate-500 rounded-lg tracking-wider">{c.category}</span>
                  </div>
                  <p className="text-[10px] font-bold text-slate-400 mt-0.5">{fmtDate(c.date)} · "{c.description}"</p>
                </div>
                {/* Amount */}
                <div className="text-right shrink-0">
                  <p className="text-sm font-black text-slate-900">SGD {c.amount.toFixed(2)}</p>
                  <p className="text-[9px] font-bold text-slate-400 mt-0.5">GST {c.gst.toFixed(2)}</p>
                </div>
                {/* Status */}
                <div className="shrink-0">
                  <span className={`text-[9px] font-black uppercase px-3 py-1.5 rounded-xl border tracking-widest ${statusStyle(c.status)}`}>
                    {c.status}
                  </span>
                </div>
                {/* Receipt */}
                <div className="w-8 shrink-0 flex justify-center">
                  {c.receipt ? (
                    <div className="w-7 h-7 bg-emerald-100 border border-emerald-200 rounded-lg flex items-center justify-center" title="Receipt attached">
                      <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4" /></svg>
                    </div>
                  ) : (
                    <div className="w-7 h-7 bg-slate-100 border border-slate-200 rounded-lg flex items-center justify-center" title="No receipt">
                      <svg className="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486" /></svg>
                    </div>
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

      {showModal && <SubmitClaimModal onClose={() => setShowModal(false)} onSubmit={handleSubmit} />}

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

// ─── Admin claims view ────────────────────────────────────────────────────────

function AdminClaimsView() {
  const staffClaims = [
    { id: 'CLM-991', staff: 'Sarah Chen', dept: 'Engineering', date: '2026-04-18', category: 'Travel', amount: 1250.00, status: 'Pending', merchant: 'Singapore Airlines', gst: 103.21 },
    { id: 'CLM-992', staff: 'Marcus Tan', dept: 'Operations', date: '2026-04-19', category: 'Meal', amount: 45.20, status: 'Pending', merchant: 'Song Fa Bak Kut Teh', gst: 3.73 },
    { id: 'CLM-993', staff: 'Linda Low', dept: 'HR', date: '2026-04-20', category: 'Transport', amount: 32.10, status: 'Pending', merchant: 'Grab SG', gst: 2.65 },
  ];

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
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">MTD Outflow</p>
          <p className="text-4xl font-black text-slate-900 tracking-tighter">SGD 4,850</p>
          <div className="mt-4 flex items-center gap-2">
            <span className="w-2 h-2 bg-amber-500 rounded-full animate-pulse" />
            <p className="text-[9px] font-black text-amber-600 uppercase tracking-widest">12 pending authorization</p>
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
          <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest">Authorization Queue</h3>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-indigo-600 rounded-full animate-ping" />
            <span className="text-[9px] font-black text-slate-400 uppercase">Live</span>
          </div>
        </div>
        <div className="divide-y divide-slate-50">
          {staffClaims.map(c => (
            <div key={c.id} className="flex items-center gap-5 px-8 py-5 hover:bg-slate-50/50 transition-all">
              <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center text-[11px] font-black text-white shrink-0">
                {c.staff.split(' ').map(n => n[0]).join('')}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-black text-slate-900">{c.staff}</p>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">{c.dept} · {c.id} · {c.date}</p>
              </div>
              <div className="text-center shrink-0">
                <span className="text-[9px] font-black uppercase px-2.5 py-1 bg-indigo-50 text-indigo-600 border border-indigo-100 rounded-lg tracking-widest">{c.category}</span>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-black text-slate-900">SGD {c.amount.toFixed(2)}</p>
                <p className="text-[9px] font-bold text-slate-400">GST {c.gst.toFixed(2)}</p>
              </div>
              <div className="shrink-0">
                <span className={`text-[9px] font-black uppercase px-3 py-1.5 rounded-xl border tracking-widest ${
                  c.status === 'Approved' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-amber-50 text-amber-600 border-amber-100'
                }`}>{c.status}</span>
              </div>
              <div className="flex gap-2 shrink-0">
                <button className="text-[9px] font-black text-slate-400 hover:text-slate-900 uppercase tracking-widest px-3 py-1.5 border border-slate-100 rounded-lg hover:bg-white transition-all">View</button>
                <button className="text-[9px] font-black text-white bg-indigo-600 uppercase tracking-widest px-4 py-1.5 rounded-lg hover:bg-indigo-700 transition-all">Approve</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export default function ClaimsPage() {
  const { user } = useAuth();
  const role = user?.role?.toUpperCase() ?? '';
  const email = (user?.email ?? '').toLowerCase();
  const isAdmin = role === 'SUPER_ADMIN' || role === 'HR_ADMIN' || role === 'FINANCE_ADMIN' || email === 'admin@ezyhrm.sg';
  return isAdmin ? <AdminClaimsView /> : <EmployeeClaimsView />;
}
