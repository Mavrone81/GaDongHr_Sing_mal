'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

// ── Employee audit log shape ──────────────────────────────────────────────────
interface EmpAuditLog {
  id: string;
  entityType: string;
  entityId: string;
  entityCode: string | null;
  entityName: string | null;
  action: string;
  actorId: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  changedFields: Record<string, { from?: unknown; to?: unknown; changed?: boolean; sensitive?: boolean }> | null;
  ipAddress: string | null;
  createdAt: string;
}

// ── Payroll audit log shape ───────────────────────────────────────────────────
interface PayrollAuditLog {
  id: string;
  entityType: string;
  entityId: string | null;
  action: string;
  actorId: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
}

type Source = 'employee' | 'payroll';

// ── Shared styling maps ───────────────────────────────────────────────────────
const EMP_ACTION_META: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  CREATE:         { label: 'Created',        bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  UPDATE:         { label: 'Updated',        bg: 'bg-blue-50',    text: 'text-blue-700',    dot: 'bg-blue-500'    },
  DELETE:         { label: 'Deleted',        bg: 'bg-red-50',     text: 'text-red-700',     dot: 'bg-red-500'     },
  VIEW_SENSITIVE: { label: 'Sensitive View', bg: 'bg-amber-50',   text: 'text-amber-700',   dot: 'bg-amber-500'   },
};

const PAYROLL_ACTION_META: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  COMPUTE_ATTENDANCE_WARNING: { label: 'Attendance Warning', bg: 'bg-amber-50',   text: 'text-amber-700',   dot: 'bg-amber-500'   },
  COMPUTE:                    { label: 'Computed',           bg: 'bg-blue-50',    text: 'text-blue-700',    dot: 'bg-blue-500'    },
  APPROVE:                    { label: 'Approved',           bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  FINALISE:                   { label: 'Finalised',          bg: 'bg-indigo-50',  text: 'text-indigo-700',  dot: 'bg-indigo-500'  },
  CANCEL:                     { label: 'Cancelled',          bg: 'bg-red-50',     text: 'text-red-700',     dot: 'bg-red-500'     },
};

function getPayrollMeta(action: string) {
  return PAYROLL_ACTION_META[action] ?? { label: action.replace(/_/g, ' '), bg: 'bg-slate-50', text: 'text-slate-700', dot: 'bg-slate-400' };
}

const ROLE_COLORS: Record<string, string> = {
  SUPER_ADMIN:     'text-indigo-600 bg-indigo-50 border-indigo-200',
  HR_ADMIN:        'text-violet-600 bg-violet-50 border-violet-200',
  HR_MANAGER:      'text-blue-600 bg-blue-50 border-blue-200',
  PAYROLL_OFFICER: 'text-emerald-600 bg-emerald-50 border-emerald-200',
  EMPLOYEE:        'text-slate-600 bg-slate-50 border-slate-200',
};

// ── Employee log row ──────────────────────────────────────────────────────────
function FieldDiff({ field, change }: { field: string; change: { from?: unknown; to?: unknown; changed?: boolean; sensitive?: boolean } }) {
  const label = field.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).replace('Encrypted', ' (encrypted)');
  if (change.sensitive) {
    return (
      <div className="flex items-center gap-2 py-1.5 border-b border-slate-100 last:border-0">
        <span className="text-[10px] font-black text-slate-500 w-40 shrink-0">{label}</span>
        <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">⚠ Sensitive field changed (value not logged)</span>
      </div>
    );
  }
  const fmt = (v: unknown) => {
    if (v === null || v === undefined || v === '') return <span className="italic text-slate-300">empty</span>;
    if (typeof v === 'boolean') return <span className={v ? 'text-emerald-600' : 'text-red-500'}>{v ? 'true' : 'false'}</span>;
    if (typeof v === 'string' && v.match(/^\d{4}-\d{2}-\d{2}/)) {
      try { return new Date(v).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return v; }
    }
    return String(v);
  };
  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-slate-100 last:border-0">
      <span className="text-[10px] font-black text-slate-500 w-40 shrink-0 pt-0.5">{label}</span>
      <div className="flex items-center gap-2 flex-wrap text-xs font-bold">
        <span className="text-slate-400 line-through">{fmt(change.from)}</span>
        <svg className="w-3 h-3 text-slate-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
        <span className="text-slate-900">{fmt(change.to)}</span>
      </div>
    </div>
  );
}

function EmpLogRow({ log }: { log: EmpAuditLog }) {
  const [expanded, setExpanded] = useState(false);
  const meta = EMP_ACTION_META[log.action] ?? EMP_ACTION_META.UPDATE;
  const fieldCount = log.changedFields ? Object.keys(log.changedFields).length : 0;
  const ts = new Date(log.createdAt);
  return (
    <>
      <tr className={`border-b border-slate-100 transition-all cursor-pointer hover:bg-slate-50/80 ${expanded ? 'bg-indigo-50/30' : ''}`}
        onClick={() => fieldCount > 0 && setExpanded(e => !e)}>
        <td className="px-5 py-3.5 whitespace-nowrap">
          <p className="text-[10px] font-black text-slate-800">{ts.toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
          <p className="text-[9px] font-bold text-slate-400 mt-0.5">{ts.toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</p>
        </td>
        <td className="px-5 py-3.5">
          <div className="flex items-center gap-2">
            <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${meta.dot}`} />
            <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-full border ${meta.bg} ${meta.text} border-transparent`}>{meta.label}</span>
          </div>
        </td>
        <td className="px-5 py-3.5">
          <p className="text-xs font-black text-slate-900">{log.entityName ?? '—'}</p>
          {log.entityCode && (
            <Link href={`/employees/${log.entityId}`} onClick={e => e.stopPropagation()}
              className="text-[9px] font-black text-indigo-500 hover:text-indigo-700 uppercase tracking-widest mt-0.5 block">
              {log.entityCode} ↗
            </Link>
          )}
        </td>
        <td className="px-5 py-3.5">
          <p className="text-[10px] font-black text-slate-800">{log.actorEmail ?? '—'}</p>
          {log.actorRole && (
            <span className={`text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border mt-0.5 inline-block ${ROLE_COLORS[log.actorRole] ?? ROLE_COLORS.EMPLOYEE}`}>
              {log.actorRole.replace(/_/g, ' ')}
            </span>
          )}
        </td>
        <td className="px-5 py-3.5">
          {fieldCount > 0 ? (
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black text-slate-600">{fieldCount} field{fieldCount > 1 ? 's' : ''}</span>
              <svg className={`w-3.5 h-3.5 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
            </div>
          ) : <span className="text-[10px] text-slate-300 font-bold">—</span>}
        </td>
        <td className="px-5 py-3.5"><span className="text-[9px] font-mono text-slate-400">{log.ipAddress ?? '—'}</span></td>
      </tr>
      {expanded && log.changedFields && (
        <tr className="bg-indigo-50/20 border-b border-indigo-100">
          <td colSpan={6} className="px-8 py-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm max-w-3xl">
              <p className="label-form mb-3">Field Changes</p>
              {Object.entries(log.changedFields).map(([field, change]) => <FieldDiff key={field} field={field} change={change} />)}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Payroll log row ───────────────────────────────────────────────────────────
function PayrollLogRow({ log }: { log: PayrollAuditLog }) {
  const [expanded, setExpanded] = useState(false);
  const meta = getPayrollMeta(log.action);
  const ts = new Date(log.createdAt);
  const hasDetails = log.details && Object.keys(log.details).length > 0;

  return (
    <>
      <tr className={`border-b border-slate-100 transition-all cursor-pointer hover:bg-slate-50/80 ${expanded ? 'bg-amber-50/20' : ''}`}
        onClick={() => hasDetails && setExpanded(e => !e)}>
        <td className="px-5 py-3.5 whitespace-nowrap">
          <p className="text-[10px] font-black text-slate-800">{ts.toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
          <p className="text-[9px] font-bold text-slate-400 mt-0.5">{ts.toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</p>
        </td>
        <td className="px-5 py-3.5">
          <div className="flex items-center gap-2">
            <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${meta.dot}`} />
            <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-full border ${meta.bg} ${meta.text} border-transparent`}>{meta.label}</span>
          </div>
        </td>
        <td className="px-5 py-3.5">
          <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest">{log.entityType}</p>
          {log.entityId && <p className="text-[9px] font-mono text-slate-400 mt-0.5">{log.entityId.slice(0, 8)}…</p>}
        </td>
        <td className="px-5 py-3.5">
          {/* Details summary inline */}
          {log.action === 'COMPUTE_ATTENDANCE_WARNING' && log.details ? (
            <div>
              <p className="text-[10px] font-black text-amber-700">
                Period {String(log.details['period'] ?? '—')} · {String(log.details['periodStatus'] ?? '—')}
              </p>
              {log.details['lockedBy'] ? (
                <p className="text-[9px] font-bold text-slate-500 mt-0.5">Locked by: {String(log.details['lockedBy'])}</p>
              ) : (
                <p className="text-[9px] font-bold text-slate-400 mt-0.5 italic">Not locked or approved</p>
              )}
            </div>
          ) : (
            <span className="text-[10px] text-slate-400 font-bold">—</span>
          )}
        </td>
        <td className="px-5 py-3.5">
          <p className="text-[10px] font-black text-slate-800">{log.actorEmail ?? '—'}</p>
          {log.actorRole && (
            <span className={`text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border mt-0.5 inline-block ${ROLE_COLORS[log.actorRole] ?? ROLE_COLORS.EMPLOYEE}`}>
              {log.actorRole.replace(/_/g, ' ')}
            </span>
          )}
        </td>
        <td className="px-5 py-3.5">
          {hasDetails ? (
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black text-slate-600">Details</span>
              <svg className={`w-3.5 h-3.5 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
            </div>
          ) : <span className="text-[10px] text-slate-300 font-bold">—</span>}
        </td>
        <td className="px-5 py-3.5"><span className="text-[9px] font-mono text-slate-400">{log.ipAddress ?? '—'}</span></td>
      </tr>
      {expanded && log.details && (
        <tr className="bg-amber-50/20 border-b border-amber-100">
          <td colSpan={7} className="px-8 py-4">
            <div className="bg-white border border-amber-200 rounded-xl p-4 shadow-sm max-w-3xl">
              <p className="text-[9px] font-black text-amber-600 uppercase tracking-widest mb-3">Payroll Error / Warning Details</p>
              {Object.entries(log.details).map(([k, v]) => (
                <div key={k} className="flex items-start gap-3 py-1.5 border-b border-slate-100 last:border-0">
                  <span className="text-[10px] font-black text-slate-500 w-36 shrink-0 pt-0.5">{k.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}</span>
                  <span className="text-[10px] font-bold text-slate-800 break-all">{v === null || v === undefined ? <span className="italic text-slate-300">—</span> : String(v)}</span>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function AuditPage() {
  const [source, setSource] = useState<Source>('employee');

  // Employee audit state
  const [empLogs, setEmpLogs]   = useState<EmpAuditLog[]>([]);
  const [empTotal, setEmpTotal] = useState(0);
  const [empPage, setEmpPage]   = useState(1);

  // Payroll audit state
  const [prLogs, setPrLogs]   = useState<PayrollAuditLog[]>([]);
  const [prTotal, setPrTotal] = useState(0);
  const [prPage, setPrPage]   = useState(1);

  const [loading, setLoading] = useState(true);
  const LIMIT = 50;

  // Shared filters
  const [action, setAction]     = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate]     = useState('');
  const [draftSearch, setDraftSearch] = useState('');
  const [search, setSearch]     = useState('');
  const [logSort, setLogSort]   = useState<{ col: 'timestamp' | 'action' | 'actor' | 'ip'; dir: 'asc' | 'desc' }>({ col: 'timestamp', dir: 'desc' });

  const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

  function getToken() { return document.cookie.split('vorkhive_token=')[1]?.split(';')[0] ?? ''; }

  const fetchEmpLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(empPage), limit: String(LIMIT),
        ...(search   && { search }),
        ...(action   && { action }),
        ...(fromDate && { from: fromDate }),
        ...(toDate   && { to: toDate + 'T23:59:59' }),
      });
      const res = await fetch(`${apiBase}/employees/audit-logs?${params}`, { headers: { Authorization: `Bearer ${getToken()}` } });
      if (res.ok) { const d = await res.json(); setEmpLogs(d.logs ?? []); setEmpTotal(d.total ?? 0); }
    } catch (e) { console.error('emp audit fetch', e); }
    finally { setLoading(false); }
  }, [empPage, search, action, fromDate, toDate, apiBase]);

  const fetchPrLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(prPage), limit: String(LIMIT),
        ...(action   && { action }),
        ...(fromDate && { from: fromDate }),
        ...(toDate   && { to: toDate + 'T23:59:59' }),
      });
      const res = await fetch(`${apiBase}/payroll/audit-logs?${params}`, { headers: { Authorization: `Bearer ${getToken()}` } });
      if (res.ok) { const d = await res.json(); setPrLogs(d.logs ?? []); setPrTotal(d.total ?? 0); }
    } catch (e) { console.error('payroll audit fetch', e); }
    finally { setLoading(false); }
  }, [prPage, action, fromDate, toDate, apiBase]);

  useEffect(() => {
    if (source === 'employee') fetchEmpLogs();
    else fetchPrLogs();
  }, [source, fetchEmpLogs, fetchPrLogs]);

  // Reset page when source changes
  useEffect(() => { setAction(''); setSearch(''); setDraftSearch(''); setFromDate(''); setToDate(''); }, [source]);

  const applySearch = () => { setSearch(draftSearch); setEmpPage(1); };
  const clearFilters = () => { setSearch(''); setDraftSearch(''); setAction(''); setFromDate(''); setToDate(''); setEmpPage(1); setPrPage(1); };

  const page  = source === 'employee' ? empPage  : prPage;
  const total = source === 'employee' ? empTotal : prTotal;
  const pages = Math.ceil(total / LIMIT);
  const setPage = source === 'employee' ? setEmpPage : setPrPage;

  // Sort client-side within current page
  function sortRows<T extends { createdAt: string; action: string; actorEmail?: string | null; ipAddress?: string | null }>(rows: T[]) {
    const d = logSort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      switch (logSort.col) {
        case 'timestamp': return d * a.createdAt.localeCompare(b.createdAt);
        case 'action':    return d * a.action.localeCompare(b.action);
        case 'actor':     return d * ((a.actorEmail ?? '').localeCompare(b.actorEmail ?? ''));
        case 'ip':        return d * ((a.ipAddress ?? '').localeCompare(b.ipAddress ?? ''));
        default: return 0;
      }
    });
  }

  function toggleLogSort(col: typeof logSort.col) {
    setLogSort(prev => prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' });
  }
  function SortIcon({ col }: { col: typeof logSort.col }) {
    return <span className="text-[8px] ml-1">{logSort.col === col ? (logSort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span>;
  }

  const activeFilters = search || action || fromDate || toDate;

  return (
    <div className="flex flex-col gap-6 max-w-[1600px] mx-auto pb-12">

      {/* Header */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-violet-600 rounded-2xl flex items-center justify-center shadow-lg shadow-violet-500/20 shrink-0">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-900 tracking-tight">Audit Log</h1>
            <p className="eyebrow-tight mt-0.5">Immutable · All system events, errors, and data changes</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-full">
            <div className="w-1.5 h-1.5 bg-violet-500 rounded-full" />
            <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">{total.toLocaleString()} records</span>
          </div>
          <button onClick={() => source === 'employee' ? fetchEmpLogs() : fetchPrLogs()}
            className="p-2 hover:bg-slate-100 rounded-lg transition-all text-slate-400 hover:text-slate-600">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      {/* Source tabs */}
      <div className="flex gap-2 bg-white border border-slate-200 rounded-2xl p-2 w-fit shadow-sm">
        {([
          { key: 'employee', label: 'Employee Records', dot: 'bg-violet-500' },
          { key: 'payroll',  label: 'Payroll Actions',  dot: 'bg-amber-500'  },
        ] as { key: Source; label: string; dot: string }[]).map(t => (
          <button key={t.key} onClick={() => setSource(t.key)}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
              source === t.key
                ? 'bg-slate-950 text-white shadow-md'
                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
            }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${t.dot}`} />
            {t.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">

          {/* Search — employee only */}
          {source === 'employee' && (
            <div className="lg:col-span-2">
              <label className="label-form block mb-1.5">Search (employee / actor email)</label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input type="text" value={draftSearch} onChange={e => setDraftSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && applySearch()}
                    placeholder="Name, EMP code, email…"
                    className="w-full pl-9 pr-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-500 font-bold bg-white" />
                </div>
                <button onClick={applySearch} className="px-4 py-2.5 bg-indigo-600 text-white text-[10px] font-black uppercase rounded-lg hover:bg-indigo-700 transition-all">Search</button>
              </div>
            </div>
          )}

          {/* Action filter */}
          <div className={source === 'payroll' ? 'lg:col-span-2' : ''}>
            <label className="label-form block mb-1.5">Action</label>
            <div className="relative">
              <select value={action} onChange={e => { setAction(e.target.value); setPage(1); }}
                className="w-full appearance-none bg-white border border-slate-200 rounded-lg px-4 py-2.5 text-sm font-bold text-slate-700 focus:outline-none focus:border-indigo-500 cursor-pointer pr-8">
                {source === 'employee' ? (
                  <>
                    <option value="">All actions</option>
                    <option value="CREATE">Created</option>
                    <option value="UPDATE">Updated</option>
                    <option value="DELETE">Deleted</option>
                    <option value="VIEW_SENSITIVE">Sensitive View</option>
                  </>
                ) : (
                  <>
                    <option value="">All payroll actions</option>
                    <option value="COMPUTE_ATTENDANCE_WARNING">Attendance Warning</option>
                    <option value="COMPUTE">Computed</option>
                    <option value="APPROVE">Approved</option>
                    <option value="FINALISE">Finalised</option>
                    <option value="CANCEL">Cancelled</option>
                  </>
                )}
              </select>
              <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>

          {/* Date range */}
          <div>
            <label className="label-form block mb-1.5">Date Range</label>
            <div className="flex gap-1.5 items-center">
              <input type="date" value={fromDate} onChange={e => { setFromDate(e.target.value); setPage(1); }}
                className="flex-1 bg-white border border-slate-200 rounded-lg px-2 py-2.5 text-xs font-bold text-slate-700 focus:outline-none focus:border-indigo-500" />
              <span className="text-slate-300 text-xs font-bold shrink-0">→</span>
              <input type="date" value={toDate} onChange={e => { setToDate(e.target.value); setPage(1); }}
                className="flex-1 bg-white border border-slate-200 rounded-lg px-2 py-2.5 text-xs font-bold text-slate-700 focus:outline-none focus:border-indigo-500" />
            </div>
          </div>
        </div>

        {activeFilters && (
          <button onClick={clearFilters} className="mt-3 text-[10px] font-black text-red-400 hover:text-red-600 uppercase tracking-widest flex items-center gap-1.5 transition-all">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            Clear all filters
          </button>
        )}
      </div>

      {/* Log table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20 gap-4">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-violet-600" />
            <p className="eyebrow-tight animate-pulse">Loading audit records…</p>
          </div>
        ) : (source === 'employee' ? empLogs : prLogs).length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <p className="text-sm font-black text-slate-400 uppercase tracking-widest">No audit records found</p>
            <p className="text-xs text-slate-300 font-bold mt-1">
              {source === 'payroll' ? 'Payroll errors and warnings will appear here' : 'Records appear here when employee data is modified'}
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              {source === 'employee' ? (
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 label-form">
                      {([{ col: 'timestamp', label: 'Timestamp' }, { col: 'action', label: 'Action' }] as const).map(h => (
                        <th key={h.col} className="px-5 py-3.5">
                          <button onClick={() => toggleLogSort(h.col)} className="flex items-center hover:text-slate-600 transition-colors">{h.label}<SortIcon col={h.col} /></button>
                        </th>
                      ))}
                      <th className="px-5 py-3.5">Employee</th>
                      <th className="px-5 py-3.5">
                        <button onClick={() => toggleLogSort('actor')} className="flex items-center hover:text-slate-600 transition-colors">Performed By<SortIcon col="actor" /></button>
                      </th>
                      <th className="px-5 py-3.5">Changes</th>
                      <th className="px-5 py-3.5">
                        <button onClick={() => toggleLogSort('ip')} className="flex items-center hover:text-slate-600 transition-colors">IP Address<SortIcon col="ip" /></button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>{sortRows(empLogs).map(log => <EmpLogRow key={log.id} log={log} />)}</tbody>
                </table>
              ) : (
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 label-form">
                      {([{ col: 'timestamp', label: 'Timestamp' }, { col: 'action', label: 'Event' }] as const).map(h => (
                        <th key={h.col} className="px-5 py-3.5">
                          <button onClick={() => toggleLogSort(h.col)} className="flex items-center hover:text-slate-600 transition-colors">{h.label}<SortIcon col={h.col} /></button>
                        </th>
                      ))}
                      <th className="px-5 py-3.5">Entity</th>
                      <th className="px-5 py-3.5">Summary</th>
                      <th className="px-5 py-3.5">
                        <button onClick={() => toggleLogSort('actor')} className="flex items-center hover:text-slate-600 transition-colors">Performed By<SortIcon col="actor" /></button>
                      </th>
                      <th className="px-5 py-3.5">Details</th>
                      <th className="px-5 py-3.5">
                        <button onClick={() => toggleLogSort('ip')} className="flex items-center hover:text-slate-600 transition-colors">IP<SortIcon col="ip" /></button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>{sortRows(prLogs).map(log => <PayrollLogRow key={log.id} log={log} />)}</tbody>
                </table>
              )}
            </div>

            {/* Pagination */}
            {pages > 1 && (
              <div className="flex items-center justify-between px-5 py-4 border-t border-slate-100 bg-slate-50/50">
                <p className="eyebrow-tight">Showing {((page - 1) * LIMIT) + 1}–{Math.min(page * LIMIT, total)} of {total.toLocaleString()}</p>
                <div className="flex items-center gap-2">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                    className="px-3 py-1.5 text-[10px] font-black uppercase border border-slate-200 rounded-lg hover:bg-slate-100 transition-all disabled:opacity-30 disabled:cursor-not-allowed">← Prev</button>
                  <div className="flex items-center gap-1">
                    {Array.from({ length: Math.min(7, pages) }, (_, i) => {
                      const pg = page <= 4 ? i + 1 : page + i - 3;
                      if (pg < 1 || pg > pages) return null;
                      return (
                        <button key={pg} onClick={() => setPage(pg)}
                          className={`w-8 h-8 text-[10px] font-black rounded-lg transition-all ${pg === page ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/20' : 'hover:bg-slate-100 text-slate-500'}`}>
                          {pg}
                        </button>
                      );
                    })}
                  </div>
                  <button onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page === pages}
                    className="px-3 py-1.5 text-[10px] font-black uppercase border border-slate-200 rounded-lg hover:bg-slate-100 transition-all disabled:opacity-30 disabled:cursor-not-allowed">Next →</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <p className="text-[9px] font-black text-slate-300 uppercase tracking-widest text-center">
        Audit logs are append-only · All system events are captured automatically
      </p>
    </div>
  );
}
