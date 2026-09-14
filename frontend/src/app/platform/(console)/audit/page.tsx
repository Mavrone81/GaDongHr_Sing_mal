'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { DataTable, EmptyState, PageHeader, SearchInput, type Column } from '@/components/ui';
import { usePlatformApi, type AuditEntry, type Tenant, fmtDateTime } from '../../_lib/api';

export default function AuditPage() {
  const api = usePlatformApi();
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    try { const d = await api('/audit'); setLogs(d.logs || []); } catch { /* */ }
    setLoaded(true);
  }, [api]);
  useEffect(() => {
    load();
    api('/tenants').then((d) => setTenants(d.tenants || [])).catch(() => {});
  }, [api, load]);

  const name = (id: string | null) => (id ? tenants.find((t) => t.id === id)?.name ?? null : null);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return logs.map((l, i) => ({ ...l, i })).filter((l) => !needle || `${l.action} ${name(l.tenantId) ?? ''} ${l.tenantId ?? ''}`.toLowerCase().includes(needle));
  }, [logs, q, tenants]); // eslint-disable-line react-hooks/exhaustive-deps

  const columns: Column<AuditEntry & { i: number }>[] = [
    { key: 'when', label: 'When', width: '150px', numeric: true, render: (l) => <span className="font-mono text-[13px] text-muted">{fmtDateTime(l.createdAt)}</span> },
    { key: 'action', label: 'Action', width: 'minmax(180px, 1.2fr)', render: (l) => <span className="font-mono text-[13px] text-accent">{l.action}</span> },
    { key: 'company', label: 'Company', width: 'minmax(160px, 1fr)', render: (l) => (
      l.tenantId
        ? <Link href={`/platform/companies/${l.tenantId}`} onClick={(e) => e.stopPropagation()} className="text-ink hover:text-accent">{name(l.tenantId) ?? <span className="font-mono text-xs">{l.tenantId.slice(0, 8)}</span>}</Link>
        : <span className="text-faint">—</span>
    ) },
  ];

  return (
    <>
      <PageHeader title="Audit log" subtitle="Every operator action on this console, newest first." />
      <SearchInput placeholder="Filter by action or company…" value={q} onChange={(e) => setQ(e.target.value)} className="sm:w-[360px]" aria-label="Filter audit log" />
      <DataTable
        aria-label="Audit log"
        columns={columns}
        rows={rows}
        rowKey={(l) => l.i}
        mobileCard={(l) => (
          <div className="flex flex-col gap-1">
            <div className="flex items-start justify-between gap-3"><span className="font-mono text-[13px] text-accent">{l.action}</span><span className="shrink-0 font-mono text-xs text-muted">{fmtDateTime(l.createdAt)}</span></div>
            {l.tenantId && <Link href={`/platform/companies/${l.tenantId}`} className="text-[13px] text-ink hover:text-accent">{name(l.tenantId) ?? <span className="font-mono text-xs">{l.tenantId.slice(0, 8)}</span>}</Link>}
          </div>
        )}
        rowHeight={46}
        footer={<span>{rows.length} of {logs.length} {logs.length === 1 ? 'entry' : 'entries'}</span>}
        empty={loaded
          ? (logs.length ? <EmptyState icon="search" title="No entries match" description="Try a different action name or company." /> : <EmptyState icon="list" title="No audit entries yet" description="Operator actions will appear here as they happen." />)
          : 'Loading…'}
      />
    </>
  );
}
