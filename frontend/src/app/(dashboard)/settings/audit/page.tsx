'use client';

import { useEffect, useState, useCallback, type ReactNode } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { Badge, Button, Card, EmptyState, Field, Icon, Input, SearchInput, Select, Tabs } from '@/components/ui';
import { SectionHeader } from '../_components/SectionHeader';
import { sentenceCase } from '../_components/format';

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
type Tone = 'ok' | 'accent' | 'danger' | 'warn' | 'neutral';

// ── Event label + pill colour ─────────────────────────────────────────────────
const EMP_ACTION_META: Record<string, { label: string; tone: Tone }> = {
  CREATE:         { label: 'Created',        tone: 'ok' },
  UPDATE:         { label: 'Updated',        tone: 'accent' },
  DELETE:         { label: 'Deleted',        tone: 'danger' },
  VIEW_SENSITIVE: { label: 'Sensitive view', tone: 'warn' },
};

const PAYROLL_ACTION_META: Record<string, { label: string; tone: Tone }> = {
  COMPUTE_ATTENDANCE_WARNING: { label: 'Attendance warning', tone: 'warn' },
  COMPUTE:                    { label: 'Computed',           tone: 'neutral' },
  APPROVE:                    { label: 'Approved',           tone: 'accent' },
  FINALISE:                   { label: 'Finalised',          tone: 'ok' },
  CANCEL:                     { label: 'Cancelled',          tone: 'danger' },
};

function getPayrollMeta(action: string) {
  return PAYROLL_ACTION_META[action] ?? { label: sentenceCase(action), tone: 'neutral' as Tone };
}

const fmtDate = (d: Date) => d.toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtTime = (d: Date) => d.toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const humanKey = (k: string) => k.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());

const TH = 'h-[42px] px-4 text-left text-xs font-bold text-muted whitespace-nowrap';
const TD = 'px-4 py-3 align-top';

// ── Shared cells ──────────────────────────────────────────────────────────────
function When({ iso }: { iso: string }) {
  const ts = new Date(iso);
  return (
    <div className="flex flex-col tabular-nums">
      <span className="text-[13px] font-semibold text-ink">{fmtDate(ts)}</span>
      <span className="text-xs text-muted">{fmtTime(ts)}</span>
    </div>
  );
}

function Actor({ email, role }: { email: string | null; role: string | null }) {
  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <span className="max-w-[220px] truncate text-[13px] text-ink">{email ?? '—'}</span>
      {role && <Badge>{sentenceCase(role)}</Badge>}
    </div>
  );
}

function ExpandCue({ expanded, children }: { expanded: boolean; children: ReactNode }) {
  // No onClick of its own: the row/card owns the toggle, this is its keyboard target.
  return (
    <button
      type="button"
      aria-expanded={expanded}
      className="inline-flex items-center gap-1.5 rounded-control px-1.5 py-1 text-[13px] font-semibold text-accent hover:bg-tint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      {children}
      <Icon name="chevronDown" size={14} strokeWidth={2} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
    </button>
  );
}

// ── Employee field diff ───────────────────────────────────────────────────────
function FieldDiff({ field, change }: { field: string; change: { from?: unknown; to?: unknown; changed?: boolean; sensitive?: boolean } }) {
  const label = field.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).replace('Encrypted', ' (encrypted)');
  if (change.sensitive) {
    return (
      <div className="flex flex-col gap-1 border-b border-rule py-2 last:border-0 sm:flex-row sm:items-center sm:gap-3">
        <span className="w-44 shrink-0 text-[13px] font-semibold text-muted">{label}</span>
        <Badge tone="warn">Sensitive field changed — value not logged</Badge>
      </div>
    );
  }
  const fmt = (v: unknown) => {
    if (v === null || v === undefined || v === '') return <span className="italic text-faint">empty</span>;
    if (typeof v === 'boolean') return <span className={v ? 'text-ok' : 'text-ink'}>{v ? 'true' : 'false'}</span>;
    if (typeof v === 'string' && v.match(/^\d{4}-\d{2}-\d{2}/)) {
      try { return new Date(v).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return v; }
    }
    return String(v);
  };
  return (
    <div className="flex flex-col gap-1 border-b border-rule py-2 last:border-0 sm:flex-row sm:items-start sm:gap-3">
      <span className="w-44 shrink-0 text-[13px] font-semibold text-muted">{label}</span>
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className="text-muted line-through">{fmt(change.from)}</span>
        <Icon name="arrowRight" size={14} className="text-faint" />
        <span className="font-semibold text-ink">{fmt(change.to)}</span>
      </div>
    </div>
  );
}

function DetailPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="max-w-3xl rounded-control border border-rule bg-paper px-4 py-3">
      <p className="mb-1.5 text-[13px] font-bold text-ink">{title}</p>
      {children}
    </div>
  );
}

// ── Employee log (table row or mobile card) ───────────────────────────────────
function EmpLogRow({ log, layout }: { log: EmpAuditLog; layout: 'row' | 'card' }) {
  const [expanded, setExpanded] = useState(false);
  const meta = EMP_ACTION_META[log.action] ?? EMP_ACTION_META.UPDATE;
  const fieldCount = log.changedFields ? Object.keys(log.changedFields).length : 0;
  const toggle = () => fieldCount > 0 && setExpanded(e => !e);

  const entity = (
    <div className="flex min-w-0 flex-col">
      <span className="truncate text-[13px] font-semibold text-ink">{log.entityName ?? '—'}</span>
      {log.entityCode && (
        <Link href={`/employees/${log.entityId}`} onClick={e => e.stopPropagation()}
          className="inline-flex items-center gap-0.5 text-xs font-semibold text-accent hover:underline">
          {log.entityCode}<Icon name="chevronRight" size={12} strokeWidth={2} />
        </Link>
      )}
    </div>
  );
  const changes = fieldCount > 0
    ? <ExpandCue expanded={expanded}><span className="tabular-nums">{fieldCount}</span> field{fieldCount > 1 ? 's' : ''}</ExpandCue>
    : <span className="text-[13px] text-faint">—</span>;
  const diff = expanded && log.changedFields && (
    <DetailPanel title="Field changes">
      {Object.entries(log.changedFields).map(([field, change]) => <FieldDiff key={field} field={field} change={change} />)}
    </DetailPanel>
  );

  if (layout === 'card') {
    return (
      <Card padding="p-4" className={fieldCount > 0 ? 'cursor-pointer' : ''} onClick={toggle}>
        <div className="flex items-start justify-between gap-3">
          <When iso={log.createdAt} />
          <Badge tone={meta.tone}>{meta.label}</Badge>
        </div>
        <div className="mt-3 flex flex-col gap-2">
          {entity}
          <Actor email={log.actorEmail} role={log.actorRole} />
          <div className="flex items-center justify-between gap-3">
            {changes}
            <span className="font-mono text-xs text-muted">{log.ipAddress ?? '—'}</span>
          </div>
        </div>
        {diff && <div className="mt-3">{diff}</div>}
      </Card>
    );
  }

  return (
    <>
      <tr className={`border-b border-rule transition-colors ${fieldCount > 0 ? 'cursor-pointer hover:bg-page' : ''} ${expanded ? 'bg-page' : ''}`}
        onClick={toggle}>
        <td className={`${TD} whitespace-nowrap`}><When iso={log.createdAt} /></td>
        <td className={TD}><Badge tone={meta.tone}>{meta.label}</Badge></td>
        <td className={TD}>{entity}</td>
        <td className={TD}><Actor email={log.actorEmail} role={log.actorRole} /></td>
        <td className={TD}>{changes}</td>
        <td className={TD}><span className="font-mono text-xs text-muted">{log.ipAddress ?? '—'}</span></td>
      </tr>
      {diff && (
        <tr className="border-b border-rule bg-page">
          <td colSpan={6} className="px-6 py-4">{diff}</td>
        </tr>
      )}
    </>
  );
}

// ── Payroll log (table row or mobile card) ────────────────────────────────────
function PayrollLogRow({ log, layout }: { log: PayrollAuditLog; layout: 'row' | 'card' }) {
  const [expanded, setExpanded] = useState(false);
  const meta = getPayrollMeta(log.action);
  const hasDetails = log.details && Object.keys(log.details).length > 0;
  const toggle = () => hasDetails && setExpanded(e => !e);

  const entity = (
    <div className="flex flex-col">
      <span className="text-[13px] font-semibold text-ink">{sentenceCase(log.entityType)}</span>
      {log.entityId && <span className="font-mono text-xs text-muted">{log.entityId.slice(0, 8)}…</span>}
    </div>
  );
  const summary = log.action === 'COMPUTE_ATTENDANCE_WARNING' && log.details ? (
    <div className="flex flex-col">
      <span className="text-[13px] font-semibold text-ink">
        Period {String(log.details['period'] ?? '—')} · {String(log.details['periodStatus'] ?? '—')}
      </span>
      {log.details['lockedBy'] ? (
        <span className="text-xs text-muted">Locked by {String(log.details['lockedBy'])}</span>
      ) : (
        <span className="text-xs italic text-muted">Not locked or approved</span>
      )}
    </div>
  ) : <span className="text-[13px] text-faint">—</span>;
  const cue = hasDetails ? <ExpandCue expanded={expanded}>Details</ExpandCue> : <span className="text-[13px] text-faint">—</span>;
  const detail = expanded && log.details && (
    <DetailPanel title="Payroll error or warning details">
      {Object.entries(log.details).map(([k, v]) => (
        <div key={k} className="flex flex-col gap-1 border-b border-rule py-2 last:border-0 sm:flex-row sm:items-start sm:gap-3">
          <span className="w-40 shrink-0 text-[13px] font-semibold text-muted">{humanKey(k)}</span>
          <span className="break-all text-[13px] text-ink">{v === null || v === undefined ? <span className="italic text-faint">—</span> : String(v)}</span>
        </div>
      ))}
    </DetailPanel>
  );

  if (layout === 'card') {
    return (
      <Card padding="p-4" className={hasDetails ? 'cursor-pointer' : ''} onClick={toggle}>
        <div className="flex items-start justify-between gap-3">
          <When iso={log.createdAt} />
          <Badge tone={meta.tone}>{meta.label}</Badge>
        </div>
        <div className="mt-3 flex flex-col gap-2">
          {entity}
          {summary}
          <Actor email={log.actorEmail} role={log.actorRole} />
          <div className="flex items-center justify-between gap-3">
            {cue}
            <span className="font-mono text-xs text-muted">{log.ipAddress ?? '—'}</span>
          </div>
        </div>
        {detail && <div className="mt-3">{detail}</div>}
      </Card>
    );
  }

  return (
    <>
      <tr className={`border-b border-rule transition-colors ${hasDetails ? 'cursor-pointer hover:bg-page' : ''} ${expanded ? 'bg-page' : ''}`}
        onClick={toggle}>
        <td className={`${TD} whitespace-nowrap`}><When iso={log.createdAt} /></td>
        <td className={TD}><Badge tone={meta.tone}>{meta.label}</Badge></td>
        <td className={TD}>{entity}</td>
        <td className={TD}>{summary}</td>
        <td className={TD}><Actor email={log.actorEmail} role={log.actorRole} /></td>
        <td className={TD}>{cue}</td>
        <td className={TD}><span className="font-mono text-xs text-muted">{log.ipAddress ?? '—'}</span></td>
      </tr>
      {detail && (
        <tr className="border-b border-rule bg-page">
          <td colSpan={7} className="px-6 py-4">{detail}</td>
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
      const d = await apiFetch(`/employees/audit-logs?${params}`);
      setEmpLogs(d.logs ?? []); setEmpTotal(d.total ?? 0);
    } catch (e) { console.error('emp audit fetch', e); }
    finally { setLoading(false); }
  }, [empPage, search, action, fromDate, toDate]);

  const fetchPrLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(prPage), limit: String(LIMIT),
        ...(action   && { action }),
        ...(fromDate && { from: fromDate }),
        ...(toDate   && { to: toDate + 'T23:59:59' }),
      });
      const d = await apiFetch(`/payroll/audit-logs?${params}`);
      setPrLogs(d.logs ?? []); setPrTotal(d.total ?? 0);
    } catch (e) { console.error('payroll audit fetch', e); }
    finally { setLoading(false); }
  }, [prPage, action, fromDate, toDate]);

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
  function SortHeader({ col, label }: { col: typeof logSort.col; label: string }) {
    const on = logSort.col === col;
    return (
      <button
        type="button"
        onClick={() => toggleLogSort(col)}
        aria-label={`Sort by ${label.toLowerCase()}${on ? (logSort.dir === 'asc' ? ', ascending' : ', descending') : ''}`}
        className={`inline-flex items-center gap-1 hover:text-ink ${on ? 'text-ink' : ''}`}
      >
        {label}
        {on && <Icon name="chevronDown" size={13} strokeWidth={2.25} className={logSort.dir === 'asc' ? 'rotate-180' : ''} />}
      </button>
    );
  }

  const activeFilters = search || action || fromDate || toDate;
  const rows = source === 'employee' ? empLogs : prLogs;

  return (
    <>
      <SectionHeader
        title="Audit log"
        description="Append-only. Every employee data change and payroll event is captured automatically."
        actions={
          <>
            <Badge><span className="tabular-nums">{total.toLocaleString()}</span>&nbsp;records</Badge>
            <Button variant="secondary" size="sm" onClick={() => source === 'employee' ? fetchEmpLogs() : fetchPrLogs()}>
              Refresh
            </Button>
          </>
        }
      />

      <Tabs
        items={[
          { id: 'employee', label: 'Employee records' },
          { id: 'payroll', label: 'Payroll actions' },
        ]}
        active={source}
        onChange={setSource}
      />

      {/* Filters */}
      <Card padding="p-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">

          {/* Search — employee only */}
          {source === 'employee' && (
            <div className="flex flex-col gap-1.5 lg:col-span-2">
              <span className="text-[12.5px] font-semibold text-muted">Search employee or actor email</span>
              <div className="flex gap-2">
                <SearchInput
                  value={draftSearch}
                  onChange={e => setDraftSearch(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && applySearch()}
                  placeholder="Name, employee code, email…"
                  aria-label="Search employee or actor email"
                  className="h-[42px] flex-1"
                />
                <Button onClick={applySearch} className="h-[42px]">Search</Button>
              </div>
            </div>
          )}

          {/* Action filter */}
          <Field label="Action" className={source === 'payroll' ? 'lg:col-span-2' : ''}>
            <Select value={action} onChange={e => { setAction(e.target.value); setPage(1); }}>
              {source === 'employee' ? (
                <>
                  <option value="">All actions</option>
                  <option value="CREATE">Created</option>
                  <option value="UPDATE">Updated</option>
                  <option value="DELETE">Deleted</option>
                  <option value="VIEW_SENSITIVE">Sensitive view</option>
                </>
              ) : (
                <>
                  <option value="">All payroll actions</option>
                  <option value="COMPUTE_ATTENDANCE_WARNING">Attendance warning</option>
                  <option value="COMPUTE">Computed</option>
                  <option value="APPROVE">Approved</option>
                  <option value="FINALISE">Finalised</option>
                  <option value="CANCEL">Cancelled</option>
                </>
              )}
            </Select>
          </Field>

          {/* Date range */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-semibold text-muted">Date range</span>
            <div className="flex items-center gap-1.5">
              <Input type="date" aria-label="From date" value={fromDate} onChange={e => { setFromDate(e.target.value); setPage(1); }} className="px-2 text-[13px]" />
              <span className="shrink-0 text-[13px] text-muted">to</span>
              <Input type="date" aria-label="To date" value={toDate} onChange={e => { setToDate(e.target.value); setPage(1); }} className="px-2 text-[13px]" />
            </div>
          </div>
        </div>

        {activeFilters && (
          <div className="mt-3">
            <Button variant="ghost" size="sm" icon="x" onClick={clearFilters}>Clear all filters</Button>
          </div>
        )}
      </Card>

      {/* Log */}
      {loading ? (
        <Card padding="p-0">
          <div className="flex items-center justify-center gap-4 py-20">
            <div className="animate-spin h-8 w-8 border-t-2 border-b-2 border-accent rounded-full" />
            <p className="text-sm text-muted">Loading audit records…</p>
          </div>
        </Card>
      ) : rows.length === 0 ? (
        <Card padding="p-0">
          <EmptyState
            icon="list"
            title="No audit records found"
            description={activeFilters
              ? 'Nothing matches these filters. Clear them to see everything.'
              : source === 'payroll' ? 'Payroll errors and warnings will appear here.' : 'Records appear here when employee data is modified.'}
          />
        </Card>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-card border border-rule bg-paper shadow-card md:block">
            <div className="overflow-x-auto">
              {source === 'employee' ? (
                <table className="w-full min-w-[820px] text-left">
                  <thead className="border-b border-rule bg-pill">
                    <tr>
                      <th className={TH}><SortHeader col="timestamp" label="Time" /></th>
                      <th className={TH}><SortHeader col="action" label="Action" /></th>
                      <th className={TH}>Employee</th>
                      <th className={TH}><SortHeader col="actor" label="Performed by" /></th>
                      <th className={TH}>Changes</th>
                      <th className={TH}><SortHeader col="ip" label="IP address" /></th>
                    </tr>
                  </thead>
                  <tbody>{sortRows(empLogs).map(log => <EmpLogRow key={log.id} log={log} layout="row" />)}</tbody>
                </table>
              ) : (
                <table className="w-full min-w-[900px] text-left">
                  <thead className="border-b border-rule bg-pill">
                    <tr>
                      <th className={TH}><SortHeader col="timestamp" label="Time" /></th>
                      <th className={TH}><SortHeader col="action" label="Event" /></th>
                      <th className={TH}>Entity</th>
                      <th className={TH}>Summary</th>
                      <th className={TH}><SortHeader col="actor" label="Performed by" /></th>
                      <th className={TH}>Details</th>
                      <th className={TH}><SortHeader col="ip" label="IP" /></th>
                    </tr>
                  </thead>
                  <tbody>{sortRows(prLogs).map(log => <PayrollLogRow key={log.id} log={log} layout="row" />)}</tbody>
                </table>
              )}
            </div>
          </div>

          {/* Mobile cards */}
          <div className="flex flex-col gap-3 md:hidden">
            {source === 'employee'
              ? sortRows(empLogs).map(log => <EmpLogRow key={log.id} log={log} layout="card" />)
              : sortRows(prLogs).map(log => <PayrollLogRow key={log.id} log={log} layout="card" />)}
          </div>

          {/* Pagination */}
          {pages > 1 && (
            <div className="flex flex-col items-center justify-between gap-3 text-[13px] text-muted sm:flex-row">
              <p className="tabular-nums">Showing {((page - 1) * LIMIT) + 1}–{Math.min(page * LIMIT, total)} of {total.toLocaleString()}</p>
              <div className="flex items-center gap-1.5">
                <Button size="sm" variant="secondary" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
                <div className="flex items-center gap-1">
                  {Array.from({ length: Math.min(7, pages) }, (_, i) => {
                    const pg = page <= 4 ? i + 1 : page + i - 3;
                    if (pg < 1 || pg > pages) return null;
                    return (
                      <button key={pg} type="button" onClick={() => setPage(pg)} aria-current={pg === page ? 'page' : undefined}
                        className={`h-8 min-w-[2rem] rounded-control px-2 text-[13px] font-semibold tabular-nums transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${pg === page ? 'bg-accent text-on-accent' :'text-muted hover:bg-pill hover:text-ink'}`}>
                        {pg}
                      </button>
                    );
                  })}
                </div>
                <Button size="sm" variant="secondary" onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page === pages}>Next</Button>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
