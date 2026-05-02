'use client';

import React, { useState, useEffect, useCallback } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CpfRate {
  id: string;
  citizenStatus: 'SC_PR' | 'PR_YEAR1' | 'PR_YEAR2' | 'FOREIGNER';
  ageMin: number;
  ageMax: number | null;
  employeeRate: number;
  employerRate: number;
  owCeiling: number;
  awCeiling: number;
  effectiveDate: string;
  isActive: boolean;
}

interface SdlConfig {
  id: string;
  rate: number;
  minAmount: number;
  maxAmount: number;
  salaryCap: number;
  effectiveDate: string;
  isActive: boolean;
}

interface FwlRate {
  id: string;
  passType: 'WP' | 'S_PASS';
  sector: string;
  tier: string;
  dailyRate: number;
  effectiveDate: string;
  isActive: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function apiBase() {
  const h = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  return `http://${h}:4000/api`;
}

function getToken(): string {
  if (typeof document === 'undefined') return '';
  return document.cookie.split('vorkhive_token=')[1]?.split(';')[0] ?? '';
}

function pct(v: number) { return `${(v * 100).toFixed(2).replace(/\.00$/, '')}%`; }

const STATUS_LABELS: Record<string, string> = {
  SC_PR: 'SC / SPR (3rd Year+)',
  PR_YEAR1: 'SPR Year 1',
  PR_YEAR2: 'SPR Year 2',
  FOREIGNER: 'Foreigner',
};

const STATUS_ORDER = ['SC_PR', 'PR_YEAR1', 'PR_YEAR2', 'FOREIGNER'];

const SECTOR_LABELS: Record<string, string> = {
  SERVICES: 'Services',
  CONSTRUCTION: 'Construction',
  MARINE: 'Marine',
  PROCESS: 'Process',
  MANUFACTURING: 'Manufacturing',
};

const TIER_LABELS: Record<string, string> = {
  TIER1: 'Tier 1',
  TIER2: 'Tier 2',
  BASIC_SKILLED: 'Basic Skilled',
  HIGHER_SKILLED: 'Higher Skilled',
};

// ─── Inline editable cell ─────────────────────────────────────────────────────

function EditableCell({ value, onSave, suffix = '' }: { value: string | number; onSave: (v: string) => Promise<void>; suffix?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const [saving, setSaving] = useState(false);

  const commit = async () => {
    if (draft === String(value)) { setEditing(false); return; }
    setSaving(true);
    try { await onSave(draft); setEditing(false); } finally { setSaving(false); }
  };

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1">
        <input
          autoFocus
          type="text"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
          className="w-20 border border-indigo-300 rounded-lg px-2 py-0.5 text-xs font-bold text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-400"
        />
        <button onClick={commit} disabled={saving} className="text-[9px] font-black text-green-600 uppercase tracking-widest hover:text-green-800">
          {saving ? '…' : 'Save'}
        </button>
        <button onClick={() => setEditing(false)} className="text-[9px] font-black text-slate-400 uppercase tracking-widest hover:text-slate-600">✕</button>
      </span>
    );
  }

  return (
    <button
      onClick={() => { setDraft(String(value)); setEditing(true); }}
      className="group inline-flex items-center gap-1 text-xs font-bold text-slate-700 hover:text-indigo-600 transition-colors"
      title="Click to edit"
    >
      {value}{suffix}
      <span className="opacity-0 group-hover:opacity-100 text-[8px] text-indigo-400 transition-opacity">✎</span>
    </button>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function RatesPage() {
  const [tab, setTab] = useState<'cpf' | 'sdl' | 'fwl'>('cpf');
  const [cpfRates, setCpfRates] = useState<CpfRate[]>([]);
  const [sdlConfig, setSdlConfig] = useState<SdlConfig | null>(null);
  const [fwlRates, setFwlRates] = useState<FwlRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  const authHeader = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cpfRes, sdlRes, fwlRes] = await Promise.all([
        fetch(`${apiBase()}/components/cpf-rates`, { headers: authHeader() }),
        fetch(`${apiBase()}/components/sdl-config`, { headers: authHeader() }),
        fetch(`${apiBase()}/components/fwl-rates`, { headers: authHeader() }),
      ]);
      if (cpfRes.ok) setCpfRates(await cpfRes.json());
      if (sdlRes.ok) { const d = await sdlRes.json(); setSdlConfig(Object.keys(d).length ? d : null); }
      if (fwlRes.ok) setFwlRates(await fwlRes.json());
    } catch { showToast('Failed to load statutory tables', false); }
    finally { setLoading(false); }
  }, []); // eslint-disable-line

  useEffect(() => { load(); }, [load]);

  const seedDefaults = async () => {
    setSeeding(true);
    try {
      const res = await fetch(`${apiBase()}/components/seed-defaults`, { method: 'POST', headers: authHeader() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      showToast(`Defaults loaded — CPF: ${data.created.cpfRates}, SDL: ${data.created.sdlConfig}, FWL: ${data.created.fwlRates} records created`);
      await load();
    } catch (e: any) { showToast(e.message || 'Seed failed', false); }
    finally { setSeeding(false); }
  };

  const saveCpf = async (id: string, field: keyof CpfRate, rawVal: string) => {
    const val = parseFloat(rawVal);
    if (isNaN(val)) { showToast('Invalid number', false); return; }
    const body: any = {};
    if (field === 'employeeRate') body.employeeRate = val / 100;
    else if (field === 'employerRate') body.employerRate = val / 100;
    else if (field === 'owCeiling') body.owCeiling = val;
    else if (field === 'awCeiling') body.awCeiling = val;
    const res = await fetch(`${apiBase()}/components/cpf-rates/${id}`, { method: 'PUT', headers: authHeader(), body: JSON.stringify(body) });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error ?? `HTTP ${res.status}`); }
    const updated = await res.json();
    setCpfRates(r => r.map(x => x.id === id ? updated : x));
    showToast('CPF rate updated');
  };

  const saveSdl = async (field: keyof SdlConfig, rawVal: string) => {
    const val = parseFloat(rawVal);
    if (isNaN(val)) { showToast('Invalid number', false); return; }
    const body: any = {};
    if (field === 'rate') body.rate = val / 100;
    else body[field] = val;
    const res = await fetch(`${apiBase()}/components/sdl-config`, { method: 'PUT', headers: authHeader(), body: JSON.stringify(body) });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error ?? `HTTP ${res.status}`); }
    setSdlConfig(await res.json());
    showToast('SDL config updated');
  };

  const saveFwl = async (id: string, rawVal: string) => {
    const val = parseFloat(rawVal);
    if (isNaN(val)) { showToast('Invalid number', false); return; }
    const res = await fetch(`${apiBase()}/components/fwl-rates/${id}`, { method: 'PUT', headers: authHeader(), body: JSON.stringify({ dailyRate: val }) });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error ?? `HTTP ${res.status}`); }
    const updated = await res.json();
    setFwlRates(r => r.map(x => x.id === id ? updated : x));
    showToast('FWL rate updated');
  };

  const isEmpty = !loading && cpfRates.length === 0 && !sdlConfig && fwlRates.length === 0;

  return (
    <div className="flex flex-col gap-6 p-8 bg-white border border-slate-100 rounded-[2.5rem] shadow-2xl shadow-indigo-500/5">

      {/* Toast */}
      {toast && (
        <div className={`fixed top-6 right-6 z-50 px-4 py-3 rounded-2xl shadow-xl text-xs font-black uppercase tracking-widest transition-all ${toast.ok ? 'bg-green-500 text-white' : 'bg-red-500 text-white'}`}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-2 h-8 bg-violet-500 rounded-full" />
          <div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tighter">Statutory Tables</h1>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-0.5">SuperAdmin Only · Singapore 2026 Rates</p>
          </div>
        </div>
        <button
          onClick={seedDefaults}
          disabled={seeding || loading}
          className="flex items-center gap-2 px-4 py-2 rounded-2xl bg-indigo-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-md shadow-indigo-200"
        >
          {seeding ? (
            <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
          ) : (
            <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
          )}
          Load Singapore 2026 Defaults
        </button>
      </div>

      {/* Info banner */}
      <div className="bg-slate-50 px-5 py-3 rounded-2xl border border-slate-100 text-xs font-bold text-slate-500">
        CPF OW ceiling SGD 7,400 · AW ceiling SGD 102,000 · SDL 0.25% · Effective Jan 2026.&nbsp;
        <span className="text-amber-600">Verify PR Year 1/2 graduated rates against CPF Board Table B before payroll execution.</span>
      </div>

      {/* Empty state */}
      {isEmpty && (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-2xl">◎</div>
          <p className="text-sm font-black text-slate-700">Statutory tables are empty</p>
          <p className="text-xs text-slate-400">Click "Load Singapore 2026 Defaults" to populate CPF rates, SDL config and FWL levy rates.</p>
        </div>
      )}

      {/* Tabs */}
      {!isEmpty && (
        <>
          <div className="flex gap-1 bg-slate-100 p-1 rounded-2xl w-fit">
            {(['cpf', 'sdl', 'fwl'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${tab === t ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                {t === 'cpf' ? 'CPF Contributions' : t === 'sdl' ? 'SDL Config' : 'Foreign Worker Levy'}
              </button>
            ))}
          </div>

          {/* CPF Tab */}
          {tab === 'cpf' && (
            <div className="flex flex-col gap-6">
              {STATUS_ORDER.filter(s => cpfRates.some(r => r.citizenStatus === s)).map(status => (
                <div key={status} className="border border-slate-100 rounded-2xl overflow-hidden">
                  <div className="bg-slate-50 px-5 py-3 flex items-center justify-between">
                    <span className="text-[10px] font-black text-slate-700 uppercase tracking-widest">{STATUS_LABELS[status]}</span>
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">OW Ceiling: SGD {cpfRates.find(r => r.citizenStatus === status)?.owCeiling?.toLocaleString()}</span>
                  </div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-100">
                        <th className="text-left px-5 py-2 text-[9px] font-black text-slate-400 uppercase tracking-widest">Age Bracket</th>
                        <th className="text-left px-5 py-2 text-[9px] font-black text-slate-400 uppercase tracking-widest">Employee %</th>
                        <th className="text-left px-5 py-2 text-[9px] font-black text-slate-400 uppercase tracking-widest">Employer %</th>
                        <th className="text-left px-5 py-2 text-[9px] font-black text-slate-400 uppercase tracking-widest">Total %</th>
                        <th className="text-left px-5 py-2 text-[9px] font-black text-slate-400 uppercase tracking-widest">OW Ceiling (SGD)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cpfRates
                        .filter(r => r.citizenStatus === status)
                        .sort((a, b) => a.ageMin - b.ageMin)
                        .map(r => (
                          <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                            <td className="px-5 py-3 font-bold text-slate-700">
                              {r.ageMin === 0 ? '≤' : `${r.ageMin}–`}{r.ageMax ? r.ageMax : '+'} yrs
                            </td>
                            <td className="px-5 py-3">
                              <EditableCell
                                value={(r.employeeRate * 100).toFixed(2).replace(/\.00$/, '')}
                                suffix="%"
                                onSave={v => saveCpf(r.id, 'employeeRate', v)}
                              />
                            </td>
                            <td className="px-5 py-3">
                              <EditableCell
                                value={(r.employerRate * 100).toFixed(2).replace(/\.00$/, '')}
                                suffix="%"
                                onSave={v => saveCpf(r.id, 'employerRate', v)}
                              />
                            </td>
                            <td className="px-5 py-3 font-bold text-indigo-700">
                              {((r.employeeRate + r.employerRate) * 100).toFixed(2).replace(/\.00$/, '')}%
                            </td>
                            <td className="px-5 py-3">
                              <EditableCell
                                value={r.owCeiling}
                                onSave={v => saveCpf(r.id, 'owCeiling', v)}
                              />
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              ))}
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Click any value to edit inline · Enter to save · Esc to cancel</p>
            </div>
          )}

          {/* SDL Tab */}
          {tab === 'sdl' && sdlConfig && (
            <div className="max-w-lg">
              <div className="border border-slate-100 rounded-2xl overflow-hidden">
                <div className="bg-slate-50 px-5 py-3">
                  <span className="text-[10px] font-black text-slate-700 uppercase tracking-widest">Skills Development Levy (SDL)</span>
                </div>
                <div className="divide-y divide-slate-50">
                  {[
                    { label: 'Levy Rate', field: 'rate' as const, value: (sdlConfig.rate * 100).toFixed(4).replace(/0+$/, ''), suffix: '%', hint: 'Enter as percentage, e.g. 0.25' },
                    { label: 'Minimum Payable', field: 'minAmount' as const, value: sdlConfig.minAmount, suffix: ' SGD', hint: 'Per month for wages < salary cap' },
                    { label: 'Maximum Payable', field: 'maxAmount' as const, value: sdlConfig.maxAmount, suffix: ' SGD', hint: 'Per month cap' },
                    { label: 'Salary Cap', field: 'salaryCap' as const, value: sdlConfig.salaryCap, suffix: ' SGD', hint: 'Max wage subject to SDL' },
                  ].map(({ label, field, value, suffix, hint }) => (
                    <div key={field} className="flex items-center justify-between px-5 py-4">
                      <div>
                        <p className="text-xs font-black text-slate-700">{label}</p>
                        <p className="text-[9px] text-slate-400 mt-0.5">{hint}</p>
                      </div>
                      <div className="flex items-center gap-1 text-sm font-black text-slate-800">
                        <EditableCell
                          value={value}
                          suffix={suffix}
                          onSave={v => saveSdl(field, v)}
                        />
                      </div>
                    </div>
                  ))}
                  <div className="flex items-center justify-between px-5 py-4">
                    <p className="text-xs font-black text-slate-500">Effective Date</p>
                    <p className="text-xs font-bold text-slate-600">{new Date(sdlConfig.effectiveDate).toLocaleDateString('en-SG', { year: 'numeric', month: 'short', day: 'numeric' })}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* FWL Tab */}
          {tab === 'fwl' && (
            <div className="flex flex-col gap-6">
              {(['S_PASS', 'WP'] as const).filter(pt => fwlRates.some(r => r.passType === pt)).map(passType => (
                <div key={passType} className="border border-slate-100 rounded-2xl overflow-hidden">
                  <div className="bg-slate-50 px-5 py-3">
                    <span className="text-[10px] font-black text-slate-700 uppercase tracking-widest">
                      {passType === 'S_PASS' ? 'S-Pass Holders' : 'Work Permit Holders'}
                    </span>
                  </div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-100">
                        <th className="text-left px-5 py-2 text-[9px] font-black text-slate-400 uppercase tracking-widest">Sector</th>
                        <th className="text-left px-5 py-2 text-[9px] font-black text-slate-400 uppercase tracking-widest">Tier</th>
                        <th className="text-left px-5 py-2 text-[9px] font-black text-slate-400 uppercase tracking-widest">Daily Rate (SGD)</th>
                        <th className="text-left px-5 py-2 text-[9px] font-black text-slate-400 uppercase tracking-widest">≈ Monthly (×26)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fwlRates
                        .filter(r => r.passType === passType)
                        .sort((a, b) => a.sector.localeCompare(b.sector) || a.tier.localeCompare(b.tier))
                        .map(r => (
                          <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                            <td className="px-5 py-3 font-bold text-slate-700">{SECTOR_LABELS[r.sector] ?? r.sector}</td>
                            <td className="px-5 py-3 text-slate-600">{TIER_LABELS[r.tier] ?? r.tier}</td>
                            <td className="px-5 py-3">
                              <EditableCell
                                value={r.dailyRate.toFixed(2)}
                                onSave={v => saveFwl(r.id, v)}
                              />
                            </td>
                            <td className="px-5 py-3 text-slate-500">{(r.dailyRate * 26).toFixed(2)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              ))}
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                Daily rate = MOM monthly levy ÷ 26 workdays · Verify current levies at mom.gov.sg
              </p>
            </div>
          )}
        </>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map(i => <div key={i} className="h-12 bg-slate-100 rounded-2xl animate-pulse" />)}
        </div>
      )}
    </div>
  );
}
