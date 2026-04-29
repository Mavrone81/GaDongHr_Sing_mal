'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

interface AuditLog {
  id: string;
  entityType: string;
  entityId: string;
  entityCode: string | null;
  entityName: string | null;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'VIEW_SENSITIVE';
  actorId: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  changedFields: Record<string, { from?: unknown; to?: unknown; changed?: boolean; sensitive?: boolean }> | null;
  ipAddress: string | null;
  createdAt: string;
}

const ACTION_META: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  CREATE:         { label: 'Created',   bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  UPDATE:         { label: 'Updated',   bg: 'bg-blue-50',    text: 'text-blue-700',    dot: 'bg-blue-500'    },
  DELETE:         { label: 'Deleted',   bg: 'bg-red-50',     text: 'text-red-700',     dot: 'bg-red-500'     },
  VIEW_SENSITIVE: { label: 'Sensitive View', bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' },
};

const ROLE_COLORS: Record<string, string> = {
  SUPER_ADMIN:     'text-indigo-600 bg-indigo-50 border-indigo-200',
  HR_ADMIN:        'text-violet-600 bg-violet-50 border-violet-200',
  HR_MANAGER:      'text-blue-600 bg-blue-50 border-blue-200',
  PAYROLL_OFFICER: 'text-emerald-600 bg-emerald-50 border-emerald-200',
  EMPLOYEE:        'text-slate-600 bg-slate-50 border-slate-200',
};

function FieldDiff({ field, change }: { field: string; change: { from?: unknown; to?: unknown; changed?: boolean; sensitive?: boolean } }) {
  const label = field.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).replace('Encrypted', ' (encrypted)');

  if (change.sensitive) {
    return (
      <div className="flex items-center gap-2 py-1.5 border-b border-slate-100 last:border-0">
        <span className="text-[10px] font-black text-slate-500 w-40 shrink-0">{label}</span>
        <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
          ⚠ Sensitive field changed (value not logged)
        </span>
      </div>
    );
  }

  const fmt = (v: unknown) => {
    if (v === null || v === undefined || v === '') return <span className="italic text-slate-300">empty</span>;
    if (typeof v === 'boolean') return <span className={v ? 'text-emerald-600' : 'text-red-500'}>{v ? 'true' : 'false'}</span>;
    if (v instanceof Date || (typeof v === 'string' && v.match(/^\d{4}-\d{2}-\d{2}/))) {
      try { return new Date(v as string).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return String(v); }
    }
    return String(v);
  };

  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-slate-100 last:border-0">
      <span className="text-[10px] font-black text-slate-500 w-40 shrink-0 pt-0.5">{label}</span>
      <div className="flex items-center gap-2 flex-wrap text-xs font-bold">
        <span className="text-slate-400 line-through">{fmt(change.from)}</span>
        <svg className="w-3 h-3 text-slate-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-slate-900">{fmt(change.to)}</span>
      </div>
    </div>
  );
}

function LogRow({ log }: { log: AuditLog }) {
  const [expanded, setExpanded] = useState(false);
  const meta = ACTION_META[log.action] ?? ACTION_META.UPDATE;
  const fieldCount = log.changedFields ? Object.keys(log.changedFields).length : 0;
  const ts = new Date(log.createdAt);

  return (
    <>
      <tr
        className={`border-b border-slate-100 transition-all cursor-pointer hover:bg-slate-50/80 ${expanded ? 'bg-indigo-50/30' : ''}`}
        onClick={() => fieldCount > 0 && setExpanded(e => !e)}
      >
        {/* Timestamp */}
        <td className="px-5 py-3.5 whitespace-nowrap">
          <p className="text-[10px] font-black text-slate-800">{ts.toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
          <p className="text-[9px] font-bold text-slate-400 mt-0.5">{ts.toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</p>
        </td>

        {/* Action */}
        <td className="px-5 py-3.5">
          <div className="flex items-center gap-2">
            <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${meta.dot}`} />
            <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-full border ${meta.bg} ${meta.text} border-transparent`}>
              {meta.label}
            </span>
          </div>
        </td>

        {/* Employee */}
        <td className="px-5 py-3.5">
          <p className="text-xs font-black text-slate-900">{log.entityName ?? '—'}</p>
          {log.entityCode && (
            <Link
              href={`/employees/${log.entityId}`}
              onClick={e => e.stopPropagation()}
              className="text-[9px] font-black text-indigo-500 hover:text-indigo-700 uppercase tracking-widest mt-0.5 block"
            >
              {log.entityCode} ↗
            </Link>
          )}
        </td>

        {/* Actor */}
        <td className="px-5 py-3.5">
          <p className="text-[10px] font-black text-slate-800">{log.actorEmail ?? '—'}</p>
          {log.actorRole && (
            <span className={`text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border mt-0.5 inline-block ${ROLE_COLORS[log.actorRole] ?? ROLE_COLORS.EMPLOYEE}`}>
              {log.actorRole.replace(/_/g, ' ')}
            </span>
          )}
        </td>

        {/* Changes */}
        <td className="px-5 py-3.5">
          {fieldCount > 0 ? (
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black text-slate-600">{fieldCount} field{fieldCount > 1 ? 's' : ''}</span>
              <svg className={`w-3.5 h-3.5 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          ) : (
            <span className="text-[10px] text-slate-300 font-bold">—</span>
          )}
        </td>

        {/* IP */}
        <td className="px-5 py-3.5">
          <span className="text-[9px] font-mono text-slate-400">{log.ipAddress ?? '—'}</span>
        </td>
      </tr>

      {/* Expanded diff */}
      {expanded && log.changedFields && (
        <tr className="bg-indigo-50/20 border-b border-indigo-100">
          <td colSpan={6} className="px-8 py-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm max-w-3xl">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3">Field Changes</p>
              {Object.entries(log.changedFields).map(([field, change]) => (
                <FieldDiff key={field} field={field} change={change} />
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function AuditPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const LIMIT = 50;

  // Filters
  const [search, setSearch]     = useState('');
  const [action, setAction]     = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate]     = useState('');
  const [draftSearch, setDraftSearch] = useState('');

  const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const token = document.cookie.split('ezyhrm_token=')[1]?.split(';')[0];
      const params = new URLSearchParams({
        page: String(page),
        limit: String(LIMIT),
        ...(search && { search }),
        ...(action && { action }),
        ...(fromDate && { from: fromDate }),
        ...(toDate && { to: toDate + 'T23:59:59' }),
      });
      const res = await fetch(`${apiBase}/employees/audit-logs?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs ?? []);
        setTotal(data.total ?? 0);
      }
    } catch (err) {
      console.error('Failed to fetch audit logs:', err);
    } finally {
      setLoading(false);
    }
  }, [page, search, action, fromDate, toDate, apiBase]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const applySearch = () => { setSearch(draftSearch); setPage(1); };
  const clearFilters = () => { setSearch(''); setDraftSearch(''); setAction(''); setFromDate(''); setToDate(''); setPage(1); };
  const pages = Math.ceil(total / LIMIT);

  const actionCounts = logs.reduce((acc, l) => { acc[l.action] = (acc[l.action] || 0) + 1; return acc; }, {} as Record<string, number>);

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
            <h1 className="text-xl font-black text-slate-900 tracking-tight">Employee Data Audit Log</h1>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-0.5">
              Immutable · All creates, updates & deletes to employee records
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-full">
            <div className="w-1.5 h-1.5 bg-violet-500 rounded-full" />
            <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">{total.toLocaleString()} total records</span>
          </div>
          <button onClick={fetchLogs} className="p-2 hover:bg-slate-100 rounded-lg transition-all text-slate-400 hover:text-slate-600">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Creates', key: 'CREATE',  icon: '＋', color: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
          { label: 'Updates', key: 'UPDATE',  icon: '✎',  color: 'bg-blue-50 border-blue-200 text-blue-700' },
          { label: 'Deletes', key: 'DELETE',  icon: '✕',  color: 'bg-red-50 border-red-200 text-red-700' },
          { label: 'Total',   key: '_total',  icon: '≡',  color: 'bg-violet-50 border-violet-200 text-violet-700' },
        ].map(s => (
          <div key={s.key} className={`rounded-xl border p-4 ${s.color}`}>
            <p className="text-[9px] font-black uppercase tracking-widest opacity-70 mb-1">{s.label}</p>
            <p className="text-2xl font-black">{s.key === '_total' ? total.toLocaleString() : (actionCounts[s.key] ?? 0).toLocaleString()}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Search */}
          <div className="lg:col-span-2">
            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">Search (employee / actor email)</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  value={draftSearch}
                  onChange={e => setDraftSearch(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && applySearch()}
                  placeholder="Name, EMP code, email…"
                  className="w-full pl-9 pr-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-500 font-bold bg-white"
                />
              </div>
              <button onClick={applySearch} className="px-4 py-2.5 bg-indigo-600 text-white text-[10px] font-black uppercase rounded-lg hover:bg-indigo-700 transition-all">
                Search
              </button>
            </div>
          </div>

          {/* Action filter */}
          <div>
            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">Action</label>
            <div className="relative">
              <select
                value={action}
                onChange={e => { setAction(e.target.value); setPage(1); }}
                className="w-full appearance-none bg-white border border-slate-200 rounded-lg px-4 py-2.5 text-sm font-bold text-slate-700 focus:outline-none focus:border-indigo-500 cursor-pointer pr-8"
              >
                <option value="">All actions</option>
                <option value="CREATE">Created</option>
                <option value="UPDATE">Updated</option>
                <option value="DELETE">Deleted</option>
                <option value="VIEW_SENSITIVE">Sensitive View</option>
              </select>
              <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>

          {/* Date range */}
          <div>
            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">Date Range</label>
            <div className="flex gap-1.5 items-center">
              <input
                type="date"
                value={fromDate}
                onChange={e => { setFromDate(e.target.value); setPage(1); }}
                className="flex-1 bg-white border border-slate-200 rounded-lg px-2 py-2.5 text-xs font-bold text-slate-700 focus:outline-none focus:border-indigo-500"
              />
              <span className="text-slate-300 text-xs font-bold shrink-0">→</span>
              <input
                type="date"
                value={toDate}
                onChange={e => { setToDate(e.target.value); setPage(1); }}
                className="flex-1 bg-white border border-slate-200 rounded-lg px-2 py-2.5 text-xs font-bold text-slate-700 focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>
        </div>

        {(search || action || fromDate || toDate) && (
          <button onClick={clearFilters} className="mt-3 text-[10px] font-black text-red-400 hover:text-red-600 uppercase tracking-widest flex items-center gap-1.5 transition-all">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
            Clear all filters
          </button>
        )}
      </div>

      {/* Log table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20 gap-4">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-violet-600" />
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest animate-pulse">Loading audit records…</p>
          </div>
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <p className="text-sm font-black text-slate-400 uppercase tracking-widest">No audit records found</p>
            <p className="text-xs text-slate-300 font-bold mt-1">Records appear here when employee data is created or modified</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[9px] font-black text-slate-400 uppercase tracking-widest">
                    <th className="px-5 py-3.5">Timestamp</th>
                    <th className="px-5 py-3.5">Action</th>
                    <th className="px-5 py-3.5">Employee</th>
                    <th className="px-5 py-3.5">Performed By</th>
                    <th className="px-5 py-3.5">Changes</th>
                    <th className="px-5 py-3.5">IP Address</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map(log => <LogRow key={log.id} log={log} />)}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {pages > 1 && (
              <div className="flex items-center justify-between px-5 py-4 border-t border-slate-100 bg-slate-50/50">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  Showing {((page - 1) * LIMIT) + 1}–{Math.min(page * LIMIT, total)} of {total.toLocaleString()}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-3 py-1.5 text-[10px] font-black uppercase border border-slate-200 rounded-lg hover:bg-slate-100 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    ← Prev
                  </button>
                  <div className="flex items-center gap-1">
                    {Array.from({ length: Math.min(7, pages) }, (_, i) => {
                      const pg = page <= 4 ? i + 1 : page + i - 3;
                      if (pg < 1 || pg > pages) return null;
                      return (
                        <button
                          key={pg}
                          onClick={() => setPage(pg)}
                          className={`w-8 h-8 text-[10px] font-black rounded-lg transition-all ${pg === page ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/20' : 'hover:bg-slate-100 text-slate-500'}`}
                        >
                          {pg}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    onClick={() => setPage(p => Math.min(pages, p + 1))}
                    disabled={page === pages}
                    className="px-3 py-1.5 text-[10px] font-black uppercase border border-slate-200 rounded-lg hover:bg-slate-100 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    Next →
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <p className="text-[9px] font-black text-slate-300 uppercase tracking-widest text-center">
        Audit logs are append-only · Changes to employee records are captured automatically
      </p>
    </div>
  );
}
