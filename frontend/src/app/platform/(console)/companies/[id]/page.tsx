'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Badge, Button, Card, CardHeader, EmptyState, Field, Icon, Input, PageHeader, Stat } from '@/components/ui';
import { usePlatformApi, type Tenant, type Mod, type ModuleDef, statusLabel, statusTone, dateInputValue, fmtDate, daysUntil } from '../../../_lib/api';

export default function CompanyPage() {
  const { id } = useParams<{ id: string }>();
  const api = usePlatformApi();
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [detail, setDetail] = useState<{ modules: Mod[]; aiProvider: string } | null>(null);
  const [allModules, setAllModules] = useState<ModuleDef[]>([]);
  const [trialDate, setTrialDate] = useState('');
  const [err, setErr] = useState('');

  const loadTenant = useCallback(async () => {
    try {
      const d = await api('/tenants');
      const t = (d.tenants || []).find((x: Tenant) => x.id === id) ?? null;
      setTenant(t);
      if (t?.trialEndsAt) setTrialDate(dateInputValue(t.trialEndsAt));
    } catch { /* */ }
    setLoaded(true);
  }, [api, id]);

  const loadDetail = useCallback(async () => {
    try { const d = await api(`/tenants/${id}`); setDetail({ modules: d.modules || [], aiProvider: d.aiProvider || 'ollama' }); } catch { /* */ }
  }, [api, id]);

  useEffect(() => {
    loadTenant();
    loadDetail();
    api('/modules').then((d) => setAllModules(d.modules || [])).catch(() => {});
  }, [api, loadTenant, loadDetail]);

  async function action(path: string, body?: object) {
    setErr('');
    try { await api(`/tenants/${id}${path}`, { method: 'POST', body: body ? JSON.stringify(body) : undefined }); await loadTenant(); await loadDetail(); }
    catch (e) { setErr(String(e)); }
  }
  function radioArrows(e: React.KeyboardEvent<HTMLDivElement>) {
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    const radios = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
    const at = radios.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    e.preventDefault();
    radios[(at + step + radios.length) % radios.length].focus();
  }

  async function setAi(provider: string) {
    setErr('');
    try { await api(`/tenants/${id}/ai-provider`, { method: 'POST', body: JSON.stringify({ provider }) }); await loadDetail(); }
    catch (e) { setErr(String(e)); }
  }
  const isDisabled = (code: string) => !!detail?.modules.find((m) => m.moduleCode === code && !m.enabled);

  if (!loaded) return <p className="text-sm text-muted">Loading…</p>;
  if (!tenant) {
    return (
      <Card><EmptyState icon="building" title="Company not found" description="It may have been removed, or the link is wrong." action={<Link href="/platform"><Button variant="secondary">Back to companies</Button></Link>} /></Card>
    );
  }

  const days = daysUntil(tenant.trialEndsAt);
  const trialNote = tenant.status === 'TRIALING' && days !== null ? (days < 0 ? `ended ${-days} ${-days === 1 ? 'day' : 'days'} ago` : days === 0 ? 'ends today' : `${days} ${days === 1 ? 'day' : 'days'} left`) : null;

  return (
    <>
      <div className="flex items-center gap-1.5 text-[13px] text-muted">
        <Link href="/platform" className="font-semibold text-accent hover:text-ink">Companies</Link>
        <Icon name="chevronRight" size={14} className="text-faint" />
        <span className="truncate text-ink">{tenant.name}</span>
      </div>

      <PageHeader
        title={<span className="flex flex-wrap items-center gap-2.5">{tenant.name}<Badge tone={statusTone(tenant.status)}>{statusLabel(tenant.status)}{trialNote ? ` · ${trialNote}` : ''}</Badge></span>}
        subtitle={<span className="font-mono text-[13px]">{tenant.slug} · {tenant.country} · {tenant.users} {tenant.users === 1 ? 'user' : 'users'}{tenant.plan ? ` · ${tenant.plan}` : ''}</span>}
        actions={<>
          <Button variant="secondary" icon="calendar" onClick={() => action('/extend-trial', { days: 14 })}>+14 days</Button>
          {tenant.status === 'SUSPENDED'
            ? <Button variant="secondary" onClick={() => action('/resume')}>Resume</Button>
            : <Button variant="danger" onClick={() => action('/suspend')}>Suspend</Button>}
        </>}
      />

      {err && <div className="rounded-control border border-rule bg-danger-bg px-4 py-2.5 text-sm text-danger" role="alert">{err}</div>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Users" value={<span className="font-mono">{tenant.users}</span>} note="Accounts in this tenant" />
        <Stat label="Status" value={statusLabel(tenant.status)} note={tenant.plan ? `${tenant.plan} plan` : 'No plan recorded'} />
        <Stat label="Trial ends" value={<span className="font-mono text-2xl">{fmtDate(tenant.trialEndsAt)}</span>} note={trialNote ?? (tenant.trialEndsAt ? 'Trial date on record' : 'No trial date')} />
        <Stat label="Country" value={tenant.country} note={tenant.country === 'SG' ? 'CPF, IRAS, MOM rules' : tenant.country === 'MY' ? 'EPF, SOCSO, EIS, PCB rules' : 'Statutory rules by country'} />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card padding="px-5 pt-[18px] pb-5">
          <CardHeader title="Modules" caption="Core modules are always on. Switch optional ones per company." />
          {!allModules.length && <p className="text-sm text-muted">No module catalogue returned.</p>}
          <div className="mt-2 grid gap-2.5 sm:grid-cols-2">
            {allModules.map((m) => {
              const on = !isDisabled(m.code);
              return (
                <button
                  key={m.code}
                  type="button"
                  role="switch"
                  aria-checked={on}
                  disabled={m.isCore}
                  onClick={() => action(`/modules/${m.code}/toggle`, { enabled: !on })}
                  className={`flex items-center justify-between gap-2.5 rounded-control border border-rule px-3.5 py-3 text-left transition-colors ${on ? 'bg-tint' : 'bg-paper'} ${m.isCore ? 'cursor-not-allowed' : 'hover:border-accent'}`}
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <div className="truncate text-[13.5px] font-semibold text-ink">{m.name}</div>
                    <div className="text-xs text-muted">{m.isCore ? 'Core · always on' : on ? 'Enabled' : 'Disabled'}</div>
                  </div>
                  <span aria-hidden="true" className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? 'bg-accent' : 'bg-rule'}`}>
                    <span className={`absolute top-0.5 h-4 w-4 rounded-full transition-all ${on ? 'right-0.5 bg-on-accent' : 'left-0.5 bg-paper'}`} />
                  </span>
                </button>
              );
            })}
          </div>
        </Card>

        <div className="flex flex-col gap-4">
          <Card padding="px-5 pt-[18px] pb-5">
            <CardHeader title="Trial" caption="Set a new end date, or add 14 days from the current one." />
            <div className="flex flex-col gap-3">
              <Field label="Trial ends"><Input type="date" value={trialDate} onChange={(e) => setTrialDate(e.target.value)} className="font-mono" /></Field>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => trialDate && action('/extend-trial', { date: trialDate })} disabled={!trialDate} reason={!trialDate ? 'Pick a date first' : undefined}>Set trial end</Button>
                <Button variant="secondary" onClick={() => action('/extend-trial', { days: 14 })}>+14 days</Button>
              </div>
            </div>
          </Card>

          <Card padding="px-5 pt-[18px] pb-5">
            <CardHeader title="AI assistant" caption="Which model answers this company's HR assistant." />
            {/* One Tab stop; arrows move focus between providers. Arrows do not select:
                picking Claude sends masked HR data to the cloud, so the switch stays a
                deliberate Space, Enter or click. */}
            <div className="flex flex-col gap-2" role="radiogroup" aria-label="AI provider" onKeyDown={radioArrows}>
              {[
                { id: 'ollama', name: 'Ollama · local', note: 'Private. No data leaves the host. Default.' },
                { id: 'claude', name: 'Claude · Anthropic', note: 'Cloud. Higher quality. Personal data is masked before sending.' },
              ].map((p) => {
                const on = (detail?.aiProvider ?? 'ollama') === p.id;
                return (
                  <button key={p.id} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} onClick={() => setAi(p.id)} className={`flex items-start gap-3 rounded-control border px-3.5 py-3 text-left transition-colors ${on ? 'border-accent bg-tint' : 'border-rule bg-paper hover:border-accent'}`}>
                    <span aria-hidden="true" className={`mt-1 h-3.5 w-3.5 shrink-0 rounded-full border-2 ${on ? 'border-accent bg-accent' : 'border-faint'}`} />
                    <span className="flex flex-col gap-0.5">
                      <span className="text-[13.5px] font-semibold text-ink">{p.name}</span>
                      <span className="text-xs text-muted">{p.note}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </Card>

          <Card padding="px-5 pt-[18px] pb-5">
            <CardHeader title="Plan" action={<Link href="/platform/pricing" className="hover:text-ink">Pricing plans</Link>} />
            <div className="flex flex-col gap-2 text-[13.5px]">
              <div className="flex justify-between gap-3"><span className="text-muted">Plan</span><span className="text-ink">{tenant.plan ?? 'Not recorded'}</span></div>
              <div className="flex justify-between gap-3"><span className="text-muted">Status</span><span className="text-ink">{statusLabel(tenant.status)}</span></div>
              <div className="flex justify-between gap-3"><span className="text-muted">Users</span><span className="font-mono text-ink">{tenant.users}</span></div>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
