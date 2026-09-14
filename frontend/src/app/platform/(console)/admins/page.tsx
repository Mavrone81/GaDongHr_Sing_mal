'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, CardHeader, DataTable, EmptyState, Field, Input, PageHeader, Select, type Column } from '@/components/ui';
import { usePlatformApi, type Admin, ROLE_LABEL } from '../../_lib/api';

const ROLES = [
  { id: 'SUPER_ADMIN', label: 'Super admin', note: 'Full control' },
  { id: 'BILLING', label: 'Billing', note: 'Payments and plans' },
  { id: 'SUPPORT', label: 'Support', note: 'Read and impersonate' },
];

export default function AdminsPage() {
  const api = usePlatformApi();
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [form, setForm] = useState({ email: '', name: '', role: 'SUPPORT' });
  const [newAdmin, setNewAdmin] = useState<{ email: string; tempPassword: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try { const d = await api('/admins'); setAdmins(d.admins || []); } catch { /* */ }
    setLoaded(true);
  }, [api]);
  useEffect(() => { load(); }, [load]);

  async function addAdmin(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setAdding(true);
    try {
      const r = await api('/admins', { method: 'POST', body: JSON.stringify(form) });
      if (r.tempPassword) { setNewAdmin({ email: r.admin.email, tempPassword: r.tempPassword }); setForm({ email: '', name: '', role: 'SUPPORT' }); await load(); }
      else setErr(r.error || 'Could not create admin');
    } catch { setErr('Could not create admin'); }
    setAdding(false);
  }
  async function toggle(a: Admin) {
    setErr('');
    try { await api(`/admins/${a.id}/${a.isActive ? 'deactivate' : 'activate'}`, { method: 'POST' }); await load(); }
    catch (e) { setErr(String(e)); }
  }

  const columns: Column<Admin>[] = [
    { key: 'who', label: 'Operator', width: 'minmax(200px, 1.6fr)', render: (a) => (
      <div className="flex min-w-0 flex-col">
        <div className="truncate font-semibold text-ink">{a.name}</div>
        <div className="truncate font-mono text-xs text-muted">{a.email}</div>
      </div>
    ) },
    { key: 'role', label: 'Role', width: '130px', render: (a) => ROLE_LABEL[a.role] ?? a.role },
    { key: 'mfa', label: 'MFA', width: '110px', render: (a) => (a.mfaEnabled ? <Badge tone="ok">On</Badge> : <Badge tone="warn">Pending</Badge>) },
    { key: 'status', label: 'Status', width: '110px', render: (a) => (a.isActive ? <Badge tone="accent">Active</Badge> : <Badge tone="neutral">Disabled</Badge>) },
    { key: 'actions', label: 'Actions', width: '110px', align: 'right', render: (a) => (
      a.isActive
        ? <Button size="sm" variant="danger" onClick={() => toggle(a)}>Disable</Button>
        : <Button size="sm" variant="secondary" onClick={() => toggle(a)}>Enable</Button>
    ) },
  ];

  return (
    <>
      <PageHeader title="Platform admins" subtitle="Bevora operators who can sign in to this console. Every operator must set up MFA on first sign-in." />
      {err && <div className="rounded-control border border-rule bg-danger-bg px-4 py-2.5 text-sm text-danger" role="alert">{err}</div>}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <DataTable
          aria-label="Platform admins"
          columns={columns}
          rows={admins}
          rowKey={(a) => a.id}
          mobileCard={(a) => (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><div className="truncate font-semibold text-ink">{a.name}</div><div className="truncate font-mono text-xs text-muted">{a.email}</div></div>
                {a.isActive ? <Badge tone="accent">Active</Badge> : <Badge tone="neutral">Disabled</Badge>}
              </div>
              <div className="flex items-center justify-between gap-3 text-[13px] text-muted">
                <span>{ROLE_LABEL[a.role] ?? a.role} · MFA {a.mfaEnabled ? 'on' : 'pending'}</span>
                {a.isActive ? <Button size="sm" variant="danger" onClick={() => toggle(a)}>Disable</Button> : <Button size="sm" variant="secondary" onClick={() => toggle(a)}>Enable</Button>}
              </div>
            </div>
          )}
          footer={<span>{admins.length} {admins.length === 1 ? 'operator' : 'operators'}</span>}
          empty={loaded ? <EmptyState icon="users" title="No platform admins" description="Add the first operator with the form on the right." /> : 'Loading…'}
        />

        <Card padding="px-5 pt-[18px] pb-5">
          {newAdmin ? (
            <div className="flex flex-col gap-4">
              <CardHeader title="Admin created" caption="Share these one-time credentials. They set up MFA on first sign-in." />
              <div className="flex flex-col gap-2 text-sm">
                <div className="rounded-control bg-pill px-3 py-2"><span className="text-muted">Email </span><span className="font-mono text-ink">{newAdmin.email}</span></div>
                <div className="rounded-control bg-pill px-3 py-2"><span className="text-muted">Temporary password </span><span className="font-mono text-ink">{newAdmin.tempPassword}</span></div>
              </div>
              <Button variant="secondary" onClick={() => setNewAdmin(null)}>Add another</Button>
            </div>
          ) : (
            <form onSubmit={addAdmin} className="flex flex-col gap-3">
              <CardHeader title="Add a platform admin" />
              <Field label="Full name" required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
              <Field label="Email" required><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></Field>
              <Field label="Role" help={ROLES.find((r) => r.id === form.role)?.note}>
                <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                  {ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </Select>
              </Field>
              <Button type="submit" disabled={adding} className="mt-1">{adding ? 'Creating…' : 'Create admin'}</Button>
            </form>
          )}
        </Card>
      </div>
    </>
  );
}
