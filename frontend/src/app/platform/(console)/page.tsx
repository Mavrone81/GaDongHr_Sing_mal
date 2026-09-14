'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge, Button, Card, CardHeader, DataTable, EmptyState, Field, Input, Modal, PageHeader, SearchInput, Select, Stat, type Column } from '@/components/ui';
import { usePlatformApi, type Tenant, type AuditEntry, statusLabel, statusTone, dateInputValue, fmtDate, fmtDateTime } from '../_lib/api';

const COUNTRIES = ['SG', 'MY', 'HK', 'ID', 'TH', 'PH', 'VN'];
const SIZES = ['1-10', '11-50', '51-200', '201-500', '500+'];

export default function CompaniesPage() {
  const api = usePlatformApi();
  const router = useRouter();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('ALL');
  const [showCreate, setShowCreate] = useState(false);
  const [cf, setCf] = useState({ companyName: '', fullName: '', workEmail: '', country: 'SG', companySize: '1-10' });
  const [created, setCreated] = useState<{ email: string; tempPassword: string; company: string } | null>(null);
  const [creating, setCreating] = useState(false);

  const loadTenants = useCallback(async () => {
    try { const d = await api('/tenants'); setTenants(d.tenants || []); } catch { /* */ }
    setLoaded(true);
  }, [api]);
  const loadAudit = useCallback(() => { api('/audit').then((d) => setAudit(d.logs || [])).catch(() => {}); }, [api]);

  useEffect(() => { loadTenants(); loadAudit(); }, [loadTenants, loadAudit]);

  async function action(id: string, path: string, body?: object) {
    setErr('');
    try { await api(`/tenants/${id}${path}`, { method: 'POST', body: body ? JSON.stringify(body) : undefined }); await loadTenants(); loadAudit(); }
    catch (e) { setErr(String(e)); }
  }

  async function createCompany(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setCreating(true);
    try {
      const r = await api('/tenants', { method: 'POST', body: JSON.stringify(cf) });
      if (r.owner) {
        setCreated({ email: r.owner.email, tempPassword: r.owner.tempPassword, company: cf.companyName });
        setCf({ companyName: '', fullName: '', workEmail: '', country: 'SG', companySize: '1-10' });
        await loadTenants();
        loadAudit();
      } else setErr(r.error || 'Could not create company');
    } catch { setErr('Could not create company'); }
    setCreating(false);
  }

  const counts = useMemo(() => {
    const by = (s: string) => tenants.filter((t) => t.status === s).length;
    return { total: tenants.length, active: by('ACTIVE'), trialing: by('TRIALING'), suspended: by('SUSPENDED'), users: tenants.reduce((n, t) => n + (t.users || 0), 0) };
  }, [tenants]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return tenants.filter((t) => (status === 'ALL' || t.status === status) && (!needle || `${t.name} ${t.slug} ${t.country}`.toLowerCase().includes(needle)));
  }, [tenants, q, status]);

  const statuses = useMemo(() => Array.from(new Set(tenants.map((t) => t.status))).sort(), [tenants]);

  const columns: Column<Tenant>[] = [
    { key: 'name', label: 'Company', width: 'minmax(180px, 1.6fr)', render: (t) => (
      <div className="flex min-w-0 flex-col">
        <div className="truncate font-semibold text-ink">{t.name}</div>
        <div className="truncate font-mono text-xs text-muted">{t.slug}</div>
      </div>
    ) },
    { key: 'country', label: 'Country', width: '64px', render: (t) => t.country },
    { key: 'plan', label: 'Plan', width: '96px', render: (t) => (t.plan ? <Badge tone="accent">{t.plan}</Badge> : <span className="text-faint">—</span>) },
    { key: 'status', label: 'Status', width: '104px', render: (t) => <Badge tone={statusTone(t.status)}>{statusLabel(t.status)}</Badge> },
    { key: 'trial', label: 'Trial ends', width: '140px', render: (t) => (
      <Input
        type="date"
        aria-label={`Trial end date for ${t.name}`}
        value={dateInputValue(t.trialEndsAt)}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => e.target.value && action(t.id, '/extend-trial', { date: e.target.value })}
        className="h-8 px-2 font-mono text-xs"
      />
    ) },
    { key: 'users', label: 'Users', width: '56px', align: 'right', numeric: true, render: (t) => <span className="font-mono">{t.users}</span> },
    { key: 'actions', label: 'Actions', width: '190px', align: 'right', render: (t) => (
      <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
        <Button size="sm" variant="secondary" onClick={() => action(t.id, '/extend-trial', { days: 14 })}>+14 days</Button>
        {t.status === 'SUSPENDED'
          ? <Button size="sm" variant="secondary" onClick={() => action(t.id, '/resume')}>Resume</Button>
          : <Button size="sm" variant="danger" onClick={() => action(t.id, '/suspend')}>Suspend</Button>}
      </div>
    ) },
  ];

  return (
    <>
      <PageHeader
        title="Companies"
        subtitle={loaded ? `${counts.total} ${counts.total === 1 ? 'tenant' : 'tenants'} · ${counts.active} active · ${counts.trialing} trialing · ${counts.suspended} suspended` : 'Loading…'}
        actions={<Button icon="plus" onClick={() => { setCreated(null); setShowCreate(true); }}>Create company</Button>}
      />

      {err && <div className="rounded-control border border-rule bg-danger-bg px-4 py-2.5 text-sm text-danger" role="alert">{err}</div>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Companies" value={<span className="font-mono">{counts.total}</span>} note="All tenants" />
        <Stat label="Active" value={<span className="font-mono">{counts.active}</span>} note="Paying or converted" />
        <Stat label="Trialing" value={<span className="font-mono">{counts.trialing}</span>} note="On a 14-day trial" />
        <Stat label="Users" value={<span className="font-mono">{counts.users}</span>} note="Across all tenants" />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <SearchInput placeholder="Search company, slug or country…" value={q} onChange={(e) => setQ(e.target.value)} className="sm:w-[320px]" aria-label="Search companies" />
        <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 sm:w-[170px]">
          <option value="ALL">Status: all</option>
          {statuses.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
        </Select>
      </div>

      <div className="grid items-start gap-4 2xl:grid-cols-[minmax(0,1fr)_340px]">
        <DataTable
          aria-label="Companies"
          columns={columns}
          rows={rows}
          rowKey={(t) => t.id}
          rowHeight={56}
          onRowClick={(t) => router.push(`/platform/companies/${t.id}`)}
          mobileCard={(t) => (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><div className="truncate font-semibold text-ink">{t.name}</div><div className="truncate font-mono text-xs text-muted">{t.slug} · {t.country}</div></div>
                <Badge tone={statusTone(t.status)}>{statusLabel(t.status)}</Badge>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted">
                <span>{t.plan ?? 'No plan'}</span>
                <span className="font-mono">{t.users} {t.users === 1 ? 'user' : 'users'}</span>
                {t.trialEndsAt && <span className="font-mono">trial ends {fmtDate(t.trialEndsAt)}</span>}
              </div>
            </div>
          )}
          footer={<><span>{rows.length} of {tenants.length}</span><span className="hidden text-faint md:inline">Click a row for modules, trial and AI settings</span></>}
          empty={loaded
            ? (tenants.length
              ? <EmptyState icon="search" title="No companies match" description="Try a different search or clear the status filter." action={<Button variant="secondary" onClick={() => { setQ(''); setStatus('ALL'); }}>Clear filters</Button>} />
              : <EmptyState icon="building" title="No companies yet" description="Create the first tenant. It gets an isolated workspace, an owner account and a 14-day trial." action={<Button icon="plus" onClick={() => setShowCreate(true)}>Create company</Button>} />)
            : 'Loading…'}
        />

        <Card padding="px-5 pt-[18px] pb-1.5">
          <CardHeader title="Recent platform audit" action={<Link href="/platform/audit" className="hover:text-ink">Full log</Link>} />
          {audit.slice(0, 8).map((a, i) => (
            <div key={i} className="flex flex-col gap-0.5 border-t border-rule py-2.5">
              <div className="flex justify-between gap-2.5">
                <span className="truncate font-mono text-[12.5px] text-accent">{a.action}</span>
                <span className="shrink-0 font-mono text-xs text-muted">{fmtDateTime(a.createdAt)}</span>
              </div>
              {a.tenantId && <div className="font-mono text-xs text-muted">{tenants.find((t) => t.id === a.tenantId)?.name ?? a.tenantId.slice(0, 8)}</div>}
            </div>
          ))}
          {!audit.length && <div className="border-t border-rule py-4 text-sm text-muted">No audit entries yet.</div>}
        </Card>
      </div>

      <Modal
        open={showCreate}
        onClose={() => { setShowCreate(false); setCreated(null); }}
        title={created ? 'Company created' : 'Create a company'}
        caption={created ? undefined : 'Provisions an isolated workspace and an owner account on a 14-day trial.'}
        footer={created
          ? <Button onClick={() => { setShowCreate(false); setCreated(null); }}>Done</Button>
          : <><Button type="button" variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button><Button type="submit" form="create-company" disabled={creating}>{creating ? 'Creating…' : 'Create company'}</Button></>}
      >
        {created ? (
          <div className="flex flex-col gap-3">
            <p className="text-muted">Share these one-time owner credentials with <span className="font-semibold text-ink">{created.company}</span>. They sign in at the normal login.</p>
            <div className="rounded-control bg-pill px-3 py-2"><span className="text-muted">Email </span><span className="font-mono text-ink">{created.email}</span></div>
            <div className="rounded-control bg-pill px-3 py-2"><span className="text-muted">Temporary password </span><span className="font-mono text-ink">{created.tempPassword}</span></div>
          </div>
        ) : (
          <form id="create-company" onSubmit={createCompany} className="flex flex-col gap-4">
            <Field label="Company name" required><Input value={cf.companyName} onChange={(e) => setCf({ ...cf, companyName: e.target.value })} required /></Field>
            <Field label="Owner full name" required><Input value={cf.fullName} onChange={(e) => setCf({ ...cf, fullName: e.target.value })} required /></Field>
            <Field label="Owner work email" required><Input type="email" value={cf.workEmail} onChange={(e) => setCf({ ...cf, workEmail: e.target.value })} required /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Country"><Select value={cf.country} onChange={(e) => setCf({ ...cf, country: e.target.value })}>{COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}</Select></Field>
              <Field label="Company size"><Select value={cf.companySize} onChange={(e) => setCf({ ...cf, companySize: e.target.value })}>{SIZES.map((sz) => <option key={sz} value={sz}>{sz}</option>)}</Select></Field>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
