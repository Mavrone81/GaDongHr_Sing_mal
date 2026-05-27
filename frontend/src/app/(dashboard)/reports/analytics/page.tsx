'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

const HR_ROLES = ['HR_ADMIN', 'HR_MANAGER', 'SUPER_ADMIN', 'FINANCE_ADMIN'];

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export default function AnalyticsPage() {
  const { user } = useAuth();
  const role = (user?.role || '').toUpperCase();
  const allowed = HR_ROLES.includes(role);

  const currentPeriod = new Date().toISOString().slice(0, 7);
  const currentYear   = String(new Date().getFullYear());
  const [period, setPeriod] = useState(currentPeriod);
  const [year, setYear]     = useState(currentYear);
  const [showBudgetModal, setShowBudgetModal] = useState(false);

  const [data, setData] = useState<any>({});
  const [loading, setLoading] = useState(true);

  async function loadAll() {
    setLoading(true);
    try {
      const [headcount, attrition, costPerHire, leaveHeat, otTrend, trainingRoi, payrollRatio, pdpa] = await Promise.all([
        apiFetch(`/reports/analytics/headcount?period=${period}`).then(r => r.json()).catch(() => null),
        apiFetch(`/reports/analytics/attrition?months=12`).then(r => r.json()).catch(() => null),
        apiFetch(`/reports/analytics/cost-per-hire?period=${year}`).then(r => r.json()).catch(() => null),
        apiFetch(`/reports/analytics/leave-heatmap?year=${year}`).then(r => r.json()).catch(() => null),
        apiFetch(`/reports/analytics/ot-cost-trend?months=6`).then(r => r.json()).catch(() => null),
        apiFetch(`/reports/analytics/training-roi?year=${year}`).then(r => r.json()).catch(() => null),
        apiFetch(`/reports/analytics/payroll-revenue-ratio?period=${year}`).then(r => r.json()).catch(() => null),
        apiFetch(`/reports/analytics/pdpa-retention`).then(r => r.json()).catch(() => null),
      ]);
      setData({ headcount, attrition, costPerHire, leaveHeat, otTrend, trainingRoi, payrollRatio, pdpa });
    } catch (err) {
      console.error('[analytics]', err);
    } finally { setLoading(false); }
  }

  useEffect(() => { if (user && allowed) loadAll(); }, [user, period, year, allowed]);

  if (!allowed) {
    return (
      <div className="max-w-2xl mx-auto mt-16 text-center">
        <h2 className="text-lg font-black text-slate-800 mb-2">Access Denied</h2>
        <p className="text-sm text-slate-500">Analytics dashboard is restricted to HR / Finance roles.</p>
      </div>
    );
  }

  if (loading) {
    return <div className="flex items-center justify-center min-h-[400px]"><div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" /></div>;
  }

  const { headcount, attrition, costPerHire, leaveHeat, otTrend, trainingRoi, payrollRatio, pdpa } = data;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-slate-900">HR Analytics</h1>
          <p className="text-xs text-slate-500 mt-0.5 uppercase tracking-widest font-bold">Headcount · Attrition · Costs · Compliance</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Period</label>
            <input type="month" value={period} onChange={e => setPeriod(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-bold" />
          </div>
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Year</label>
            <input type="number" value={year} onChange={e => setYear(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-bold w-24" />
          </div>
          <button onClick={() => setShowBudgetModal(true)} className="self-end px-3 py-1.5 text-xs font-bold text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50">+ Budget</button>
        </div>
      </div>

      {/* Top KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI label="Active Headcount" value={headcount?.actual ?? '—'}
             sub={headcount?.budget !== null && headcount?.budget !== undefined
               ? `Budget ${headcount.budget} · ${headcount.variancePct > 0 ? '+' : ''}${headcount.variancePct}%`
               : 'Budget not set'} accent="indigo" />
        <KPI label="12-Month Attrition" value={attrition ? `${attrition.attritionRatePct}%` : '—'}
             sub={attrition ? `${attrition.leaversCount} leavers` : ''} accent={attrition?.attritionRatePct > 15 ? 'red' : 'emerald'} />
        <KPI label="Cost per Hire" value={costPerHire ? `SGD ${costPerHire.costPerHire.toLocaleString()}` : '—'}
             sub={costPerHire ? `${costPerHire.hires} hires in ${year}` : ''} accent="violet" />
        <KPI label="Payroll / Revenue" value={payrollRatio?.payrollToRevenueRatioPct !== undefined ? `${payrollRatio.payrollToRevenueRatioPct}%` : '—'}
             sub={payrollRatio?.revenue ? `Revenue SGD ${payrollRatio.revenue.toLocaleString()}` : 'Revenue not set'} accent="teal" />
      </div>

      {/* Headcount by department */}
      {headcount && (
        <Section title="Headcount by Department">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {Object.entries(headcount.byDepartment || {}).map(([dept, n]) => {
              const total = headcount.actual || 1;
              const pct = Math.round(((n as number) / total) * 100);
              return (
                <div key={dept} className="flex items-center gap-3 text-xs">
                  <span className="font-bold text-slate-700 w-40 truncate">{dept}</span>
                  <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-500" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="font-bold text-slate-500 w-16 text-right">{n as number} ({pct}%)</span>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* Attrition breakdowns */}
      {attrition && (
        <Section title={`Attrition Breakdown (${attrition.windowMonths}m rolling)`}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
            <div>
              <p className="text-xs font-black text-slate-700 uppercase tracking-wider mb-2">By Tenure</p>
              <div className="space-y-1.5">
                {Object.entries(attrition.byTenure || {}).map(([t, n]) => (
                  <div key={t} className="flex items-center gap-2 text-xs">
                    <span className="font-bold text-slate-700 w-12">{t}</span>
                    <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-rose-500" style={{ width: `${Math.min(100, (n as number) * 10)}%` }} />
                    </div>
                    <span className="font-bold text-slate-500 w-8 text-right">{n as number}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-black text-slate-700 uppercase tracking-wider mb-2">By Department</p>
              <div className="space-y-1.5">
                {Object.entries(attrition.byDepartment || {}).slice(0, 8).map(([d, n]) => (
                  <div key={d} className="flex items-center gap-2 text-xs">
                    <span className="font-bold text-slate-700 w-32 truncate">{d}</span>
                    <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-rose-400" style={{ width: `${Math.min(100, (n as number) * 10)}%` }} />
                    </div>
                    <span className="font-bold text-slate-500 w-8 text-right">{n as number}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Section>
      )}

      {/* Leave heatmap */}
      {leaveHeat && (
        <Section title={`Leave Utilisation — ${leaveHeat.year}`}>
          <div className="grid grid-cols-12 gap-1 mb-3">
            {(leaveHeat.monthlyDaysTaken || []).map((days: number, i: number) => {
              const max = Math.max(1, ...leaveHeat.monthlyDaysTaken);
              const intensity = Math.round((days / max) * 9);
              const shades = ['bg-slate-50','bg-indigo-50','bg-indigo-100','bg-indigo-200','bg-indigo-300','bg-indigo-400','bg-indigo-500','bg-indigo-600','bg-indigo-700','bg-indigo-800'];
              return (
                <div key={i} className="text-center">
                  <div className={`aspect-square rounded ${shades[intensity] || 'bg-slate-50'} flex items-center justify-center`}>
                    <span className={`text-[10px] font-bold ${intensity > 4 ? 'text-white' : 'text-slate-600'}`}>{days}</span>
                  </div>
                  <p className="text-[9px] font-bold text-slate-400 mt-1">{MONTH_LABELS[i]}</p>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-slate-500">Total: <strong>{leaveHeat.totalDays}</strong> days taken</p>
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
            {Object.entries(leaveHeat.byLeaveType || {}).slice(0, 6).map(([t, n]) => (
              <div key={t} className="p-2 bg-slate-50 rounded-lg text-xs">
                <span className="font-bold text-slate-700">{t}</span>
                <span className="float-right font-black text-slate-900">{n as number}d</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* OT cost trend */}
      {otTrend?.periods && (
        <Section title="OT Cost Trend (6 months)">
          <div className="grid grid-cols-6 gap-2">
            {otTrend.periods.map((p: any, i: number) => {
              const max = Math.max(1, ...otTrend.periods.map((x: any) => x.totalCost || 0));
              const h = Math.max(8, Math.round(((p.totalCost || 0) / max) * 100));
              return (
                <div key={i} className="text-center">
                  <div className="h-32 flex items-end justify-center">
                    <div className="w-full bg-amber-500 rounded-t" style={{ height: `${h}%` }} title={`SGD ${p.totalCost}`}>
                    </div>
                  </div>
                  <p className="text-[10px] font-bold text-slate-500 mt-1">{p.period.slice(5)}</p>
                  <p className="text-[10px] font-black text-slate-700">SGD {(p.totalCost || 0).toLocaleString()}</p>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* Training ROI */}
      {trainingRoi && (
        <Section title={`Training ROI — ${trainingRoi.year}`}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Mini label="Programs"   value={trainingRoi.trainings} />
            <Mini label="Total Cost" value={`SGD ${trainingRoi.totalCost.toLocaleString()}`} />
            <Mini label="Cost / Hour" value={`SGD ${trainingRoi.costPerHour.toLocaleString()}`} />
            <Mini label="Cost / Completion" value={`SGD ${trainingRoi.costPerCompletion.toLocaleString()}`} />
          </div>
        </Section>
      )}

      {/* PDPA retention */}
      {pdpa && (
        <Section title="PDPA — Records Approaching 7-Year Retention Limit">
          {pdpa.approachingDeletion === 0 ? (
            <p className="text-sm text-slate-500">No records currently approaching the 7-year deletion threshold.</p>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-amber-700 font-bold">{pdpa.approachingDeletion} record(s) past 6.5 years post-termination</p>
              {(pdpa.records || []).slice(0, 10).map((r: any) => (
                <div key={r.id} className="flex items-center justify-between text-xs bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                  <div>
                    <span className="font-bold text-slate-700">{r.name}</span>
                    <span className="text-slate-400"> · {r.code}</span>
                  </div>
                  <span className="font-bold text-amber-700">{r.daysSinceTermination} days</span>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {showBudgetModal && (
        <BudgetModal onClose={() => setShowBudgetModal(false)} onSuccess={() => { setShowBudgetModal(false); loadAll(); }} year={year} period={period} />
      )}
    </div>
  );
}

function KPI({ label, value, sub, accent }: { label: string; value: any; sub?: string; accent: string }) {
  const colors: Record<string, string> = {
    indigo: 'text-indigo-700', emerald: 'text-emerald-700', red: 'text-red-600', violet: 'text-violet-700', teal: 'text-teal-700',
  };
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4">
      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{label}</p>
      <p className={`text-xl sm:text-2xl font-black ${colors[accent] || 'text-slate-700'}`}>{value}</p>
      {sub && <p className="text-[10px] font-bold text-slate-400 mt-1">{sub}</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-6">
      <h3 className="text-xs font-black text-slate-700 uppercase tracking-widest mb-3">{title}</h3>
      {children}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: any }) {
  return (
    <div className="p-3 bg-slate-50 rounded-xl">
      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{label}</p>
      <p className="text-sm font-black text-slate-900 mt-1">{value}</p>
    </div>
  );
}

function BudgetModal({ onClose, onSuccess, year, period }: { onClose: () => void; onSuccess: () => void; year: string; period: string }) {
  const [form, setForm] = useState({ category: 'headcount', periodKey: period, value: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setSaving(true); setError('');
    const res = await apiFetch('/reports/analytics/budget', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: form.category, period: form.periodKey, value: parseFloat(form.value) }),
    });
    if (res.ok) onSuccess();
    else { const e = await res.json(); setError(e.error || 'Failed'); }
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-slate-200">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-black text-slate-900">Set Budget / Target</h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 text-lg">×</button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1.5">Category</label>
            <select value={form.category} onChange={e => {
              setForm({...form, category: e.target.value, periodKey: e.target.value === 'headcount' ? period : year});
            }} className="w-full border border-slate-200 rounded-xl px-4 py-2 text-sm">
              <option value="headcount">Headcount target</option>
              <option value="recruitment">Recruitment spend</option>
              <option value="revenue">Annual revenue</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1.5">
              {form.category === 'headcount' ? 'Period (YYYY-MM)' : 'Year (YYYY)'}
            </label>
            <input value={form.periodKey} onChange={e => setForm({...form, periodKey: e.target.value})} className="w-full border border-slate-200 rounded-xl px-4 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1.5">Value (SGD or headcount)</label>
            <input type="number" value={form.value} onChange={e => setForm({...form, value: e.target.value})} className="w-full border border-slate-200 rounded-xl px-4 py-2 text-sm" />
          </div>
          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 font-bold">{error}</div>}
          <div className="flex gap-3">
            <button onClick={save} disabled={saving || !form.value} className="flex-1 py-2.5 bg-indigo-600 text-white text-xs font-black uppercase tracking-widest rounded-xl hover:bg-indigo-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={onClose} className="px-5 py-2.5 border border-slate-200 text-slate-600 text-xs font-black uppercase tracking-widest rounded-xl hover:bg-slate-50">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}
