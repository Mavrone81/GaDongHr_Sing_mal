'use client';

import { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api';

// ── CSV utility ───────────────────────────────────────────────────────────────
function downloadCsv(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const escape = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers, ...rows].map(r => r.map(escape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function Toast({ msg, type, onClose }: { msg: string; type: 'ok' | 'err'; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 4000); return () => clearTimeout(t); }, [onClose]);
  return (
    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[200] animate-in slide-in-from-bottom-6 duration-300">
      <div className={`px-8 py-4 rounded-2xl shadow-2xl flex items-center gap-3 ${type === 'ok' ? 'bg-slate-900 border border-slate-700' : 'bg-red-900 border border-red-700'}`}>
        <div className={`w-2 h-2 rounded-full ${type === 'ok' ? 'bg-emerald-400' : 'bg-red-400'}`} />
        <span className="text-[11px] font-black text-white uppercase tracking-widest">{msg}</span>
        <button onClick={onClose} className="ml-4 text-white/50 hover:text-white text-xs">✕</button>
      </div>
    </div>
  );
}

// ── Run selector modal (for payroll-linked reports) ───────────────────────────
function RunSelectorModal({ title, onSelect, onClose }: { title: string; onSelect: (runId: string, period: string) => void; onClose: () => void }) {
  const [runs, setRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    apiFetch('/payroll/runs?limit=20')
      .then(d => setRuns(d.runs ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
      <div className="w-full max-w-md bg-white rounded-[2rem] shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-8 py-6 border-b border-slate-100">
          <div>
            <h2 className="text-base font-black text-slate-900 tracking-tighter">{title}</h2>
            <p className="eyebrow-tight mt-0.5">Select a payroll run</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all">✕</button>
        </div>
        <div className="p-6 flex flex-col gap-2 max-h-80 overflow-y-auto">
          {loading ? (
            [1,2,3].map(i => <div key={i} className="h-12 bg-slate-100 rounded-xl animate-pulse" />)
          ) : runs.length === 0 ? (
            <p className="text-sm text-slate-400 font-bold text-center py-8">No payroll runs found</p>
          ) : runs.map(r => (
            <button key={r.id} onClick={() => onSelect(r.id, r.period)}
              className="flex items-center justify-between px-5 py-3.5 bg-slate-50 border border-slate-200 rounded-xl hover:border-indigo-400 hover:bg-indigo-50 transition-all text-left">
              <div>
                <span className="text-sm font-black text-slate-900">{r.period}</span>
                <span className="ml-3 label-form">{r.runType}</span>
              </div>
              <span className={`text-[9px] font-black px-2.5 py-1 rounded-lg uppercase tracking-widest border ${
                r.status === 'FINALISED' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
                r.status === 'APPROVED' ? 'bg-indigo-50 text-indigo-700 border-indigo-100' :
                'bg-amber-50 text-amber-700 border-amber-100'
              }`}>{r.status}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Report runners ────────────────────────────────────────────────────────────
async function runWorkforceReport() {
  const data = await apiFetch('/employees?limit=500');
  const emps = data.employees ?? data ?? [];
  downloadCsv(`workforce-headcount-${new Date().toISOString().slice(0,10)}.csv`,
    ['Employee Code', 'Full Name', 'Department', 'Designation', 'Employment Type', 'Nationality', 'Start Date', 'Status'],
    emps.map((e: any) => [e.employeeCode, e.fullName, e.department, e.designation, e.employmentType, e.nationality, e.startDate?.slice(0,10), e.isActive ? 'Active' : 'Inactive'])
  );
}

async function runAttritionReport() {
  const data = await apiFetch('/employees?limit=500');
  const emps = data.employees ?? data ?? [];
  const now = new Date();
  const rows = emps.map((e: any) => {
    const start = new Date(e.startDate);
    const tenure = ((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 365.25)).toFixed(1);
    return [e.employeeCode, e.fullName, e.department, e.employmentType, e.startDate?.slice(0,10), e.endDate?.slice(0,10) ?? '—', `${tenure} yrs`, e.isActive ? 'Active' : 'Terminated'];
  });
  downloadCsv(`attrition-analytics-${new Date().toISOString().slice(0,10)}.csv`,
    ['Employee Code', 'Full Name', 'Department', 'Employment Type', 'Start Date', 'End Date', 'Tenure', 'Status'],
    rows
  );
}

async function runMomReport() {
  const data = await apiFetch('/employees?limit=500');
  const emps = data.employees ?? data ?? [];
  downloadCsv(`mom-headcount-${new Date().toISOString().slice(0,10)}.csv`,
    ['Employee Code', 'Full Name', 'Nationality', 'Citizenship Status', 'Pass Type', 'Department', 'Employment Type', 'Gender', 'Start Date'],
    emps.map((e: any) => [e.employeeCode, e.fullName, e.nationality, e.citizenshipStatus ?? '—', e.passType ?? '—', e.department, e.employmentType, e.gender ?? '—', e.startDate?.slice(0,10)])
  );
}

async function runLeaveLiabilityReport() { /* replaced by LeaveLiabilityModal */ }

async function runPayrollVarianceReport() {
  const data = await apiFetch('/payroll/runs?limit=2&status=FINALISED');
  const runs = data.runs ?? [];
  if (runs.length < 2) throw new Error('Need at least 2 finalised payroll runs to compare');
  const [r1, r2] = await Promise.all([
    apiFetch(`/payroll/runs/${runs[0].id}/payslips`),
    apiFetch(`/payroll/runs/${runs[1].id}/payslips`),
  ]);
  const ps1Map: Record<string, any> = {};
  for (const p of (r1.payslips ?? r1 ?? [])) ps1Map[p.employeeId] = p;
  const rows: any[][] = [];
  for (const p of (r2.payslips ?? r2 ?? [])) {
    const prev = ps1Map[p.employeeId];
    const diff = prev ? (Number(p.netPay ?? 0) - Number(prev.netPay ?? 0)).toFixed(2) : '—';
    rows.push([p.employeeId, runs[1].period, p.grossPay ?? '—', p.netPay ?? '—', runs[0].period, prev?.netPay ?? '—', diff]);
  }
  downloadCsv(`payroll-variance-${runs[1].period}-vs-${runs[0].period}.csv`,
    ['Employee ID', 'Current Period', 'Gross Pay', 'Net Pay', 'Prior Period', 'Prior Net Pay', 'Variance'],
    rows
  );
}

// IR8A now handled by Ir8aModal

async function runCpfReportDirect() {
  const data = await apiFetch('/payroll/runs?limit=1&status=FINALISED');
  const runs = data.runs ?? [];
  if (runs.length === 0) throw new Error('No finalised payroll runs found');
  const runId = runs[0].id;
  const token = document.cookie.split('vorkhive_token=')[1]?.split(';')[0];
  const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
  const res = await fetch(`${apiBase}/payroll/cpf-file/${runId}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'CPF file generation failed'); }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `cpf-esubmit-${runs[0].period}.txt`; a.click();
  URL.revokeObjectURL(url);
}

async function runBankGiroForRun(runId: string, period: string) {
  const token = document.cookie.split('vorkhive_token=')[1]?.split(';')[0];
  const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
  const res = await fetch(`${apiBase}/payroll/bank-giro/${runId}?bank=uob`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Bank GIRO generation failed'); }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `bank-giro-${period}.txt`; a.click();
  URL.revokeObjectURL(url);
}

async function runCpfForRun(runId: string, period: string) {
  const token = document.cookie.split('vorkhive_token=')[1]?.split(';')[0];
  const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
  const res = await fetch(`${apiBase}/payroll/cpf-file/${runId}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'CPF file failed'); }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `cpf-esubmit-${period}.txt`; a.click();
  URL.revokeObjectURL(url);
}

async function fetchPayrollBreakdownData(runId: string) {
  const [psData, empData] = await Promise.all([
    apiFetch(`/payroll/runs/${runId}/payslips`),
    apiFetch('/employees?limit=500'),
  ]);
  const payslips: any[] = psData.payslips ?? psData ?? [];
  const employees: any[] = empData.employees ?? empData ?? [];
  const empMap: Record<string, any> = {};
  for (const e of employees) empMap[e.id] = e;
  return payslips.map(ps => ({ ...ps, employeeName: empMap[ps.employeeId]?.fullName ?? ps.employeeId, employeeCode: empMap[ps.employeeId]?.employeeCode ?? '—' }));
}

async function runSdlReport() {
  const data = await apiFetch('/payroll/runs?limit=10&status=FINALISED');
  const runs = data.runs ?? [];
  if (runs.length === 0) throw new Error('No finalised payroll runs found');
  const rows: any[][] = [];
  for (const r of runs.slice(0, 3)) {
    try {
      const ps = await apiFetch(`/payroll/runs/${r.id}/payslips`);
      for (const p of (ps.payslips ?? ps ?? [])) {
        rows.push([r.period, p.employeeId, p.grossPay ?? '—', p.sdl ?? '—', p.fwl ?? '—']);
      }
    } catch {}
  }
  downloadCsv(`sdl-analytics-${new Date().toISOString().slice(0,10)}.csv`,
    ['Period', 'Employee ID', 'Gross Pay', 'SDL', 'FWL'],
    rows
  );
}

// ── Leave Liability Modal ─────────────────────────────────────────────────────
function LeaveLiabilityModal({ onClose, onToast }: { onClose: () => void; onToast: (m: string, t: 'ok'|'err') => void }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    setLoading(true);
    try {
      const d = await apiFetch(`/reports/leave-liability?year=${year}`);
      setData(d);
    } catch (e: any) {
      onToast(e.message || 'Failed to generate leave liability report', 'err');
    } finally { setLoading(false); }
  };

  const handleCsv = () => {
    if (!data) return;
    downloadCsv(`leave-liability-${year}.csv`,
      ['Employee Code', 'Full Name', 'Department', 'Leave Type', 'Leave Code', 'Entitled Days', 'Carry Forward', 'Used Days', 'Pending Days', 'Unused Days', 'Daily Rate (SGD)', 'Liability (SGD)'],
      data.rows.map((r: any) => [r.employeeCode, r.fullName, r.department, r.leaveType, r.leaveCode, r.entitledDays, r.carryForward, r.usedDays, r.pendingDays, r.unusedDays, r.dailyRate, r.liability])
    );
    onToast('Leave liability CSV downloaded', 'ok');
  };

  const fmt = (v: number | null | undefined) => v == null ? '—' : `$${Number(v).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const byDept: Record<string, any[]> = data?.rows?.reduce((acc: Record<string, any[]>, r: any) => {
    if (!acc[r.department]) acc[r.department] = [];
    acc[r.department].push(r);
    return acc;
  }, {}) ?? {};

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
      <div className="w-full max-w-5xl bg-white rounded-[2rem] shadow-2xl flex flex-col overflow-hidden max-h-[90vh]">
        <div className="flex items-center justify-between px-8 py-5 border-b border-slate-100 flex-shrink-0">
          <div>
            <h2 className="text-base font-black text-slate-900 tracking-tighter">Leave Liability Report</h2>
            <p className="eyebrow-tight mt-0.5">Accrued leave liability for finance accrual reporting</p>
          </div>
          <div className="flex items-center gap-3">
            {data && <button onClick={handleCsv} className="px-5 py-2 bg-emerald-600 text-white rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-emerald-700 transition-all">Download CSV</button>}
            <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all">✕</button>
          </div>
        </div>
        <div className="flex items-center gap-4 px-8 py-4 border-b border-slate-50 bg-slate-50/50 flex-shrink-0">
          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Year</label>
          <input type="number" value={year} onChange={e => setYear(Number(e.target.value))} min={2020} max={2030}
            className="w-28 px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-indigo-500" />
          <button onClick={generate} disabled={loading}
            className="px-6 py-2 bg-indigo-600 text-white rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-indigo-700 disabled:opacity-50 transition-all flex items-center gap-2">
            {loading ? <><span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />Generating…</> : 'Generate'}
          </button>
        </div>
        {data && (
          <div className="flex flex-wrap gap-3 px-8 py-4 border-b border-slate-50 flex-shrink-0">
            {[
              { label: 'Total Liability', value: fmt(data.totalLiability), color: 'text-emerald-700' },
              { label: 'Headcount', value: String(data.headcount), color: 'text-slate-700' },
              { label: 'Year', value: String(data.year), color: 'text-indigo-700' },
              { label: 'Generated', value: new Date(data.generatedAt).toLocaleDateString('en-SG'), color: 'text-slate-500' },
            ].map(s => (
              <div key={s.label} className="px-4 py-2 bg-white rounded-xl border border-slate-100 text-center">
                <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">{s.label}</p>
                <p className={`text-xs font-black ${s.color}`}>{s.value}</p>
              </div>
            ))}
          </div>
        )}
        <div className="overflow-auto flex-1">
          {!data ? (
            <div className="flex items-center justify-center h-40 text-slate-400 text-sm font-bold">{loading ? 'Loading…' : 'Select year and click Generate'}</div>
          ) : data.rows.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-slate-400 text-sm font-bold">No data for {year}</div>
          ) : (
            <table className="w-full text-left border-collapse text-[11px]">
              <thead className="sticky top-0 bg-slate-50 border-b border-slate-100 label-form">
                <tr>{['Employee', 'Leave Type', 'Entitled', 'C/F', 'Used', 'Pending', 'Unused', 'Daily Rate', 'Liability'].map(h => <th key={h} className="px-4 py-3 whitespace-nowrap">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {Object.entries(byDept).map(([dept, rows]: [string, any[]]) => (
                  <>
                    <tr key={`hdr-${dept}`} className="bg-slate-50">
                      <td colSpan={9} className="px-4 py-2 font-black text-slate-600 text-[10px] uppercase tracking-widest">{dept}</td>
                    </tr>
                    {rows.map((r: any, i: number) => (
                      <tr key={`${r.employeeId}-${r.leaveCode}-${i}`} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-4 py-3"><p className="font-black text-slate-800 whitespace-nowrap">{r.fullName}</p><p className="text-[9px] text-slate-400 font-bold">{r.employeeCode}</p></td>
                        <td className="px-4 py-3 font-bold text-slate-600 whitespace-nowrap">{r.leaveType}</td>
                        <td className="px-4 py-3 text-right font-mono text-slate-600">{r.entitledDays}</td>
                        <td className="px-4 py-3 text-right font-mono text-slate-500">{r.carryForward ?? 0}</td>
                        <td className="px-4 py-3 text-right font-mono text-slate-600">{r.usedDays}</td>
                        <td className="px-4 py-3 text-right font-mono text-amber-600">{r.pendingDays ?? 0}</td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-slate-800">{r.unusedDays}</td>
                        <td className="px-4 py-3 text-right font-mono text-slate-500">{fmt(r.dailyRate)}</td>
                        <td className="px-4 py-3 text-right font-mono font-black text-emerald-700">{fmt(r.liability)}</td>
                      </tr>
                    ))}
                    <tr key={`sub-${dept}`} className="bg-blue-50/50">
                      <td colSpan={8} className="px-4 py-2 text-right text-[9px] font-black text-slate-500 uppercase tracking-widest">Dept Total</td>
                      <td className="px-4 py-2 text-right font-mono font-black text-blue-700">{fmt(data.byDepartment[dept])}</td>
                    </tr>
                  </>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ── IR8A Modal ────────────────────────────────────────────────────────────────
function Ir8aModal({ onClose, onToast }: { onClose: () => void; onToast: (m: string, t: 'ok'|'err') => void }) {
  const [year, setYear] = useState(new Date().getFullYear() - 1);
  const [data, setData] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    setLoading(true);
    try {
      const d = await apiFetch(`/reports/ir8a-data/${year}`);
      setData(d.employees ?? d ?? []);
    } catch (e: any) {
      onToast(e.message || 'Failed to generate IR8A data', 'err');
    } finally { setLoading(false); }
  };

  const downloadFlatFile = async () => {
    const token = document.cookie.split('vorkhive_token=')[1]?.split(';')[0];
    const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
    const res = await fetch(`${apiBase}/reports/ir8a-file/${year}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) { const e = await res.json().catch(() => ({})); onToast((e as any).error || 'Flat file generation failed', 'err'); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `IR8A-${year}.txt`; a.click();
    URL.revokeObjectURL(url);
    onToast('IR8A flat file downloaded', 'ok');
  };

  const fmt = (v: number | null | undefined) => v == null ? '—' : `$${Number(v).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
      <div className="w-full max-w-5xl bg-white rounded-[2rem] shadow-2xl flex flex-col overflow-hidden max-h-[90vh]">
        <div className="flex items-center justify-between px-8 py-5 border-b border-slate-100 flex-shrink-0">
          <div>
            <h2 className="text-base font-black text-slate-900 tracking-tighter">IR8A Annual Filing — {year}</h2>
            <p className="eyebrow-tight mt-0.5">IRAS AIS submission data · deadline 1 March {year + 1}</p>
          </div>
          <div className="flex items-center gap-3">
            {data && data.length > 0 && (
              <button onClick={downloadFlatFile}
                className="px-5 py-2 bg-slate-800 text-white rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-slate-900 transition-all">
                Download Flat File
              </button>
            )}
            <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all">✕</button>
          </div>
        </div>
        <div className="flex items-center gap-4 px-8 py-4 border-b border-slate-50 bg-slate-50/50 flex-shrink-0">
          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Year of Assessment</label>
          <input type="number" value={year} onChange={e => setYear(Number(e.target.value))} min={2020} max={2030}
            className="w-28 px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-indigo-500" />
          <button onClick={generate} disabled={loading}
            className="px-6 py-2 bg-indigo-600 text-white rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-indigo-700 disabled:opacity-50 transition-all flex items-center gap-2">
            {loading ? <><span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />Generating…</> : 'Generate'}
          </button>
          <span className="ml-auto text-[9px] font-black text-amber-600 uppercase tracking-widest bg-amber-50 border border-amber-100 px-3 py-1.5 rounded-lg">
            IRAS Deadline: 1 Mar {year + 1}
          </span>
        </div>
        <div className="overflow-auto flex-1">
          {!data ? (
            <div className="flex items-center justify-center h-40 text-slate-400 text-sm font-bold">{loading ? 'Loading…' : 'Select year and click Generate'}</div>
          ) : data.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-slate-400 text-sm font-bold">No finalised payslips for {year}</div>
          ) : (
            <table className="w-full text-left border-collapse text-[11px]">
              <thead className="sticky top-0 bg-slate-50 border-b border-slate-100 label-form">
                <tr>{['Employee', 'NRIC', 'Employment Income', 'Emp CPF', 'Emplr CPF', 'AW Income', 'Other Taxable'].map(h => <th key={h} className="px-4 py-3 whitespace-nowrap">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {data.map((emp: any, i: number) => (
                  <tr key={emp.employeeId ?? i} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-4 py-3"><p className="font-black text-slate-800 whitespace-nowrap">{emp.fullName}</p><p className="text-[9px] text-slate-400 font-bold">{emp.employeeId}</p></td>
                    <td className="px-4 py-3 font-mono text-slate-600 tracking-wider">{emp.nric ?? '—'}</td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-slate-800">{fmt(emp.employmentIncome)}</td>
                    <td className="px-4 py-3 text-right font-mono text-indigo-600">{fmt(emp.employeeCpf)}</td>
                    <td className="px-4 py-3 text-right font-mono text-purple-600">{fmt(emp.employerCpf)}</td>
                    <td className="px-4 py-3 text-right font-mono text-teal-600">{emp.awIncome > 0 ? fmt(emp.awIncome) : '—'}</td>
                    <td className="px-4 py-3 text-right font-mono text-slate-500">{emp.otherTaxableIncome > 0 ? fmt(emp.otherTaxableIncome) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Payroll Breakdown Modal ───────────────────────────────────────────────────
function PayrollBreakdownModal({ runId, period, onClose, onToast }: { runId: string; period: string; onClose: () => void; onToast: (m: string, t: 'ok'|'err') => void }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPayrollBreakdownData(runId)
      .then(setRows)
      .catch(e => onToast(e.message || 'Failed to load breakdown', 'err'))
      .finally(() => setLoading(false));
  }, [runId]);

  const fmt = (v: number | null | undefined) => v == null ? '—' : `$${Number(v).toFixed(2)}`;

  const handleCsv = () => {
    downloadCsv(`payroll-breakdown-${period}.csv`,
      ['Employee Code', 'Full Name', 'Basic Salary (OW)', 'Gross Pay', 'Employee CPF', 'Employer CPF', 'SDL', 'FWL', 'NPL Days', 'NPL Deduction', 'Govt-Paid Days', 'Govt-Paid Amount', 'Net Pay', 'YTD Gross', 'YTD Employee CPF'],
      rows.map(r => [r.employeeCode, r.employeeName, r.basicSalary, r.grossPay, r.employeeCpf, r.employerCpf, r.sdl, r.fwl, r.nplDays, r.nplDeduction, r.govtPaidDays, r.govtPaidAmount, r.netPay, r.ytdGross, r.ytdEmployeeCpf])
    );
    onToast('Payroll breakdown CSV downloaded', 'ok');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
      <div className="w-full max-w-6xl bg-white rounded-[2rem] shadow-2xl flex flex-col overflow-hidden max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-8 py-5 border-b border-slate-100 flex-shrink-0">
          <div>
            <h2 className="text-base font-black text-slate-900 tracking-tighter">Payroll Breakdown — {period}</h2>
            <p className="eyebrow-tight mt-0.5">All payroll calculations per employee (Singapore MOM/CPF/EA)</p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={handleCsv} disabled={loading || rows.length === 0}
              className="px-5 py-2 bg-emerald-600 text-white rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-emerald-700 disabled:opacity-50 transition-all">
              Download CSV
            </button>
            <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all">✕</button>
          </div>
        </div>

        {/* Summary pills */}
        {!loading && rows.length > 0 && (() => {
          const tot = rows.reduce((a, r) => ({
            gross: a.gross + r.grossPay,
            net: a.net + r.netPay,
            empCpf: a.empCpf + r.employeeCpf,
            emplrCpf: a.emplrCpf + r.employerCpf,
            sdl: a.sdl + r.sdl,
          }), { gross: 0, net: 0, empCpf: 0, emplrCpf: 0, sdl: 0 });
          return (
            <div className="flex flex-wrap gap-3 px-8 py-4 border-b border-slate-50 bg-slate-50/50 flex-shrink-0">
              {[
                { label: 'Total Gross', value: fmt(tot.gross), color: 'text-slate-700' },
                { label: 'Total Net', value: fmt(tot.net), color: 'text-emerald-700' },
                { label: 'Employee CPF', value: fmt(tot.empCpf), color: 'text-indigo-700' },
                { label: 'Employer CPF', value: fmt(tot.emplrCpf), color: 'text-purple-700' },
                { label: 'SDL', value: fmt(tot.sdl), color: 'text-amber-700' },
                { label: 'Employees', value: String(rows.length), color: 'text-slate-700' },
              ].map(s => (
                <div key={s.label} className="px-4 py-2 bg-white rounded-xl border border-slate-100 text-center">
                  <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">{s.label}</p>
                  <p className={`text-xs font-black ${s.color}`}>{s.value}</p>
                </div>
              ))}
            </div>
          );
        })()}

        {/* Table */}
        <div className="overflow-auto flex-1">
          {loading ? (
            <div className="flex items-center justify-center h-40 text-slate-400 text-sm font-bold">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-slate-400 text-sm font-bold">No payslips found for this run</div>
          ) : (
            <table className="w-full text-left border-collapse text-[11px]">
              <thead className="sticky top-0 bg-slate-50 border-b border-slate-100 label-form">
                <tr>
                  {['Code', 'Employee', 'Basic Salary (OW)', 'Gross Pay', 'Emp CPF', 'Emplr CPF', 'SDL', 'FWL', 'NPL Days', 'NPL Deduct', 'Govt Days', 'Govt Amt', 'Net Pay', 'YTD Gross', 'YTD Emp CPF'].map(h => (
                    <th key={h} className="px-4 py-3 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {rows.map(r => (
                  <tr key={r.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-4 py-3 font-black text-slate-500 whitespace-nowrap">{r.employeeCode}</td>
                    <td className="px-4 py-3 font-bold text-slate-800 whitespace-nowrap">{r.employeeName}</td>
                    <td className="px-4 py-3 text-right font-mono text-slate-600">{fmt(r.basicSalary)}</td>
                    <td className="px-4 py-3 text-right font-mono text-slate-700 font-bold">{fmt(r.grossPay)}</td>
                    <td className="px-4 py-3 text-right font-mono text-indigo-600">{fmt(r.employeeCpf)}</td>
                    <td className="px-4 py-3 text-right font-mono text-purple-600">{fmt(r.employerCpf)}</td>
                    <td className="px-4 py-3 text-right font-mono text-amber-600">{fmt(r.sdl)}</td>
                    <td className="px-4 py-3 text-right font-mono text-slate-400">{r.fwl > 0 ? fmt(r.fwl) : '—'}</td>
                    <td className="px-4 py-3 text-right font-mono text-rose-500">{r.nplDays > 0 ? r.nplDays : '—'}</td>
                    <td className="px-4 py-3 text-right font-mono text-rose-500">{r.nplDeduction > 0 ? fmt(r.nplDeduction) : '—'}</td>
                    <td className="px-4 py-3 text-right font-mono text-teal-600">{r.govtPaidDays > 0 ? r.govtPaidDays : '—'}</td>
                    <td className="px-4 py-3 text-right font-mono text-teal-600">{r.govtPaidAmount > 0 ? fmt(r.govtPaidAmount) : '—'}</td>
                    <td className="px-4 py-3 text-right font-mono font-black text-emerald-700">{fmt(r.netPay)}</td>
                    <td className="px-4 py-3 text-right font-mono text-slate-500">{fmt(r.ytdGross)}</td>
                    <td className="px-4 py-3 text-right font-mono text-slate-500">{fmt(r.ytdEmployeeCpf)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Report definitions ────────────────────────────────────────────────────────
type ReportKey = 'cpf' | 'iras' | 'giro' | 'leave' | 'workforce' | 'attrition' | 'mom' | 'sdl' | 'variance' | 'payroll-breakdown' | 'custom';

interface ReportDef {
  key: ReportKey;
  name: string;
  category: string;
  icon: string;
  freq: string;
  badge: string;
  needsRunSelector?: boolean;
  runSelectorTitle?: string;
}

const REPORTS: ReportDef[] = [
  { key: 'cpf',               name: 'CPF / SDL / FWL Statutory Report',          category: 'Statutory',  icon: '◆', freq: 'Monthly',    badge: 'MOM Required',  needsRunSelector: true, runSelectorTitle: 'Select Payroll Run — CPF e-Submit' },
  { key: 'iras',              name: 'IRAS AIS / IR8A Annual Filing',              category: 'Statutory',  icon: '◆', freq: 'Annual',     badge: 'IRAS Required' },
  { key: 'giro',              name: 'Bank GIRO Reconciliation',                   category: 'Financial',  icon: '◫', freq: 'Monthly',    badge: '',              needsRunSelector: true, runSelectorTitle: 'Select Payroll Run — Bank GIRO' },
  { key: 'payroll-breakdown', name: 'Payroll Calculation Breakdown',              category: 'Financial',  icon: '◫', freq: 'Per Run',    badge: 'Full Detail',   needsRunSelector: true, runSelectorTitle: 'Select Payroll Run — Breakdown Report' },
  { key: 'leave',             name: 'Leave Liability Report',                     category: 'Workforce',  icon: '◌', freq: 'Monthly',    badge: '' },
  { key: 'workforce',         name: 'Executive Workforce Dashboard',              category: 'Analytics',  icon: '▣', freq: 'Real-time',  badge: 'SA Only' },
  { key: 'attrition',         name: 'Attrition & Workforce Analytics',            category: 'Analytics',  icon: '▣', freq: 'Quarterly',  badge: '' },
  { key: 'mom',               name: 'MOM Headcount Report',                       category: 'Statutory',  icon: '◆', freq: 'Annual',     badge: 'MOM Required' },
  { key: 'sdl',               name: 'Training & SDL Analytics',                   category: 'Training',   icon: '◑', freq: 'Monthly',    badge: '' },
  { key: 'variance',          name: 'Payroll Variance Report',                    category: 'Financial',  icon: '◫', freq: 'Per Run',    badge: '' },
  { key: 'custom',            name: 'Custom Report Builder',                      category: 'Analytics',  icon: '▤', freq: 'On-demand',  badge: 'Premium' },
];

const CATEGORY_COLORS: Record<string, string> = {
  Statutory: 'bg-red-50 text-red-600 border-red-100',
  Financial:  'bg-emerald-50 text-emerald-600 border-emerald-100',
  Workforce:  'bg-blue-50 text-blue-600 border-blue-100',
  Analytics:  'bg-indigo-50 text-indigo-600 border-indigo-100',
  Training:   'bg-amber-50 text-amber-600 border-amber-100',
};

// ── Custom report builder modal ───────────────────────────────────────────────
function CustomReportModal({ onClose, onToast }: { onClose: () => void; onToast: (m: string, t: 'ok'|'err') => void }) {
  const [dataset, setDataset] = useState('employees');
  const [fields, setFields] = useState<string[]>(['fullName', 'department', 'designation', 'employmentType', 'startDate']);
  const [running, setRunning] = useState(false);

  const DATASETS: Record<string, string[]> = {
    employees: ['employeeCode', 'fullName', 'department', 'designation', 'employmentType', 'nationality', 'gender', 'startDate', 'endDate', 'workEmail', 'isActive', 'costCentre', 'reportingManager'],
    leave:     ['employeeName', 'leaveType', 'startDate', 'endDate', 'totalDays', 'status', 'reason'],
  };

  const toggle = (f: string) => setFields(p => p.includes(f) ? p.filter(x => x !== f) : [...p, f]);

  const handleRun = async () => {
    if (fields.length === 0) return onToast('Select at least one field', 'err');
    setRunning(true);
    try {
      let rows: any[][] = [];
      if (dataset === 'employees') {
        const data = await apiFetch('/employees?limit=500');
        const emps = data.employees ?? data ?? [];
        rows = emps.map((e: any) => fields.map(f => e[f] ?? ''));
      } else {
        const data = await apiFetch('/leave/applications?limit=500');
        const apps = data.applications ?? [];
        rows = apps.map((a: any) => fields.map(f => {
          if (f === 'employeeName') return a.employee?.fullName ?? a.employeeId;
          if (f === 'leaveType') return a.leaveType?.name ?? a.leaveTypeId;
          return a[f] ?? '';
        }));
      }
      downloadCsv(`custom-report-${dataset}-${new Date().toISOString().slice(0,10)}.csv`, fields, rows);
      onToast('Custom report downloaded', 'ok');
      onClose();
    } catch (e: any) { onToast(e.message, 'err'); }
    finally { setRunning(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-white rounded-[2rem] shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-8 py-6 border-b border-slate-100">
          <div>
            <h2 className="text-base font-black text-slate-900 tracking-tighter">Custom Report Builder</h2>
            <p className="eyebrow-tight mt-0.5">Pick dataset and fields → download CSV</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all">✕</button>
        </div>
        <div className="p-8 flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Dataset</label>
            <select value={dataset} onChange={e => { setDataset(e.target.value); setFields([]); }}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-indigo-500">
              <option value="employees">Employees</option>
              <option value="leave">Leave Applications</option>
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Fields to Include</label>
            <div className="grid grid-cols-2 gap-2 max-h-56 overflow-y-auto">
              {DATASETS[dataset].map(f => (
                <label key={f} className={`flex items-center gap-2 px-3 py-2.5 rounded-xl cursor-pointer border transition-all ${fields.includes(f) ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-slate-300'}`}>
                  <input type="checkbox" checked={fields.includes(f)} onChange={() => toggle(f)} className="w-3.5 h-3.5 accent-indigo-600" />
                  <span className="text-[10px] font-black uppercase tracking-widest">{f}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="flex gap-3 px-8 py-5 border-t border-slate-100 bg-slate-50/50">
          <button onClick={onClose} className="flex-1 py-3 text-[10px] font-black text-slate-500 border border-slate-200 rounded-xl hover:bg-slate-100 uppercase tracking-widest">Cancel</button>
          <button onClick={handleRun} disabled={running || fields.length === 0}
            className="flex-1 py-3 text-[10px] font-black text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-xl uppercase tracking-widest transition-all">
            {running ? 'Generating…' : `Download CSV (${fields.length} fields)`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ReportsPage() {
  const [running, setRunning] = useState<ReportKey | null>(null);
  const [lastRun, setLastRun] = useState<Record<string, string>>({});
  const [rptSort, setRptSort] = useState<{ col: 'name' | 'category' | 'freq'; dir: 'asc' | 'desc' }>({ col: 'category', dir: 'asc' });
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);
  const [runSelector, setRunSelector] = useState<{ key: ReportKey; title: string } | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [leaveLiabilityOpen, setLeaveLiabilityOpen] = useState(false);
  const [ir8aOpen, setIr8aOpen] = useState(false);
  const [breakdownModal, setBreakdownModal] = useState<{ runId: string; period: string } | null>(null);

  const showToast = (msg: string, type: 'ok' | 'err') => setToast({ msg, type });

  const execute = async (key: ReportKey, runId?: string, period?: string) => {
    if (key === 'payroll-breakdown') {
      setBreakdownModal({ runId: runId!, period: period! });
      setLastRun(p => ({ ...p, [key]: new Date().toLocaleDateString('en-SG') }));
      return;
    }
    setRunning(key);
    try {
      switch (key) {
        case 'cpf':       await runCpfForRun(runId!, period!); break;
        case 'iras':      setIr8aOpen(true); setRunning(null); return;
        case 'giro':      await runBankGiroForRun(runId!, period!); break;
        case 'leave':     setLeaveLiabilityOpen(true); setRunning(null); return;
        case 'workforce': await runWorkforceReport(); break;
        case 'attrition': await runAttritionReport(); break;
        case 'mom':       await runMomReport(); break;
        case 'sdl':       await runSdlReport(); break;
        case 'variance':  await runPayrollVarianceReport(); break;
        case 'custom':    setCustomOpen(true); setRunning(null); return;
      }
      setLastRun(p => ({ ...p, [key]: new Date().toLocaleDateString('en-SG') }));
      showToast('Report generated — check your downloads', 'ok');
    } catch (e: any) {
      showToast(e.message || 'Report generation failed', 'err');
    } finally {
      setRunning(null);
    }
  };

  const handleRun = (r: ReportDef) => {
    if (r.key === 'custom') { setCustomOpen(true); return; }
    if (r.needsRunSelector) { setRunSelector({ key: r.key, title: r.runSelectorTitle! }); return; }
    execute(r.key);
  };

  const sortedReports = [...REPORTS].sort((a, b) => {
    const d = rptSort.dir === 'asc' ? 1 : -1;
    switch (rptSort.col) {
      case 'name':     return d * a.name.localeCompare(b.name);
      case 'category': return d * a.category.localeCompare(b.category);
      case 'freq':     return d * a.freq.localeCompare(b.freq);
      default: return 0;
    }
  });
  function toggleRptSort(col: typeof rptSort.col) {
    setRptSort(prev => prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' });
  }
  function RptSortIcon({ col }: { col: typeof rptSort.col }) {
    return <span className="text-[8px] ml-1">{rptSort.col === col ? (rptSort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span>;
  }

  return (
    <div className="flex flex-col gap-10 max-w-[1400px] mx-auto pb-20 animate-in fade-in duration-700">

      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 bg-white p-10 rounded-[2.5rem] border border-slate-100 shadow-2xl shadow-indigo-500/5 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-40 h-40 bg-emerald-500/5 rounded-full blur-3xl" />
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-2 h-2 bg-emerald-600 rounded-full" />
            <span className="text-[10px] font-black text-emerald-600 uppercase tracking-[0.4em]">Compliance Intelligence Layer</span>
          </div>
          <h1 className="text-4xl font-black text-slate-900 tracking-tighter">Reports <span className="text-emerald-600">&amp; Analytics</span></h1>
          <p className="text-sm font-bold text-slate-400 mt-2 uppercase tracking-widest max-w-xl">
            Statutory filings, workforce analytics, and custom report generation for MOM, IRAS, and CPF Board compliance.
          </p>
        </div>
        <div className="flex gap-4 relative z-10">
          <button onClick={() => setCustomOpen(true)}
            className="px-8 py-4 bg-emerald-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-emerald-700 shadow-xl shadow-emerald-500/20 transition-all active:scale-95">
            + Custom Report
          </button>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { label: 'Reports Available', value: String(REPORTS.length), status: 'text-slate-900', bg: 'bg-white border-slate-100' },
          { label: 'Statutory Reports', value: String(REPORTS.filter(r => r.category === 'Statutory').length), status: 'text-red-600', bg: 'bg-red-50 border-red-100' },
          { label: 'Financial Reports', value: String(REPORTS.filter(r => r.category === 'Financial').length), status: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-100' },
          { label: 'Runs This Session', value: String(Object.keys(lastRun).length), status: 'text-indigo-600', bg: 'bg-indigo-50 border-indigo-100' },
        ].map(s => (
          <div key={s.label} className={`p-8 rounded-[2rem] border shadow-2xl shadow-indigo-500/5 ${s.bg}`}>
            <p className="label-form mb-4">{s.label}</p>
            <h3 className={`text-3xl font-black tracking-tighter ${s.status}`}>{s.value}</h3>
          </div>
        ))}
      </div>

      {/* Reports Matrix */}
      <section className="bg-white rounded-[2.5rem] border border-slate-100 shadow-2xl shadow-indigo-500/5 overflow-hidden">
        <div className="p-8 border-b border-slate-50 flex items-center gap-4">
          <div className="w-2 h-8 bg-emerald-600 rounded-full" />
          <h3 className="text-lg font-black text-slate-900 uppercase tracking-widest">Report Registry</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-50">
              <tr>
                {([
                  { col: 'name',     label: 'Report Name' },
                  { col: 'category', label: 'Category' },
                  { col: 'freq',     label: 'Frequency' },
                ] as const).map(h => (
                  <th key={h.col} className="px-8 py-7">
                    <button onClick={() => toggleRptSort(h.col)} className="flex items-center hover:text-slate-600 transition-colors">
                      {h.label}<RptSortIcon col={h.col} />
                    </button>
                  </th>
                ))}
                <th className="px-8 py-7">Last Generated</th>
                <th className="px-8 py-7 text-center">Generate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {sortedReports.map(r => (
                <tr key={r.key} className="group hover:bg-slate-50/50 transition-all duration-300">
                  <td className="px-8 py-5">
                    <div className="flex items-center gap-4">
                      <span className="text-lg text-slate-400 group-hover:text-indigo-500 transition-colors">{r.icon}</span>
                      <div className="flex flex-col">
                        <span className="text-xs font-black text-slate-900 uppercase tracking-tight group-hover:text-indigo-600 transition-colors">{r.name}</span>
                        {r.badge && (
                          <span className="mt-1 inline-block text-[8px] font-black px-2 py-0.5 bg-indigo-50 text-indigo-500 border border-indigo-100 rounded-full uppercase tracking-widest w-fit">{r.badge}</span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-8 py-5">
                    <span className={`text-[9px] font-black px-3 py-1.5 rounded-full border uppercase tracking-widest ${CATEGORY_COLORS[r.category]}`}>{r.category}</span>
                  </td>
                  <td className="px-8 py-5">
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{r.freq}</span>
                  </td>
                  <td className="px-8 py-5">
                    <span className="eyebrow-tight">
                      {lastRun[r.key] ?? '—'}
                    </span>
                  </td>
                  <td className="px-8 py-5 text-center">
                    <button
                      onClick={() => handleRun(r)}
                      disabled={running === r.key}
                      className="px-6 py-2 bg-white border border-slate-200 rounded-xl text-[9px] font-black text-slate-500 uppercase tracking-widest hover:border-emerald-600 hover:text-emerald-600 hover:bg-emerald-50 shadow-sm transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 mx-auto"
                    >
                      {running === r.key ? (
                        <>
                          <span className="w-3 h-3 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
                          Generating…
                        </>
                      ) : 'Run Now'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Run Selector Modal */}
      {runSelector && (
        <RunSelectorModal
          title={runSelector.title}
          onSelect={(runId, period) => { setRunSelector(null); execute(runSelector.key, runId, period); }}
          onClose={() => setRunSelector(null)}
        />
      )}

      {/* Custom Report Modal */}
      {customOpen && (
        <CustomReportModal
          onClose={() => setCustomOpen(false)}
          onToast={showToast}
        />
      )}

      {/* Leave Liability Modal */}
      {leaveLiabilityOpen && (
        <LeaveLiabilityModal
          onClose={() => setLeaveLiabilityOpen(false)}
          onToast={showToast}
        />
      )}

      {/* IR8A Modal */}
      {ir8aOpen && (
        <Ir8aModal
          onClose={() => setIr8aOpen(false)}
          onToast={showToast}
        />
      )}

      {/* Payroll Breakdown Modal */}
      {breakdownModal && (
        <PayrollBreakdownModal
          runId={breakdownModal.runId}
          period={breakdownModal.period}
          onClose={() => setBreakdownModal(null)}
          onToast={showToast}
        />
      )}

      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
