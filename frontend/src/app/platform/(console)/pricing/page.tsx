'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, PageHeader } from '@/components/ui';
import { usePlatformApi } from '../../_lib/api';

// Plan rows come straight from /platform/pricing and go back with PUT unchanged in shape.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Plan = Record<string, any>;

const TEXTAREA = 'w-full rounded-control border border-rule bg-paper px-3 py-2.5 text-sm text-ink placeholder:text-faint outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20';

export default function PricingPage() {
  const api = usePlatformApi();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try { const d = await api('/pricing'); setPlans(d.plans || []); } catch { /* */ }
    setLoaded(true); setDirty(false);
  }, [api]);
  useEffect(() => { load(); }, [load]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function setField(i: number, field: string, value: any) {
    setPlans((ps) => ps.map((p, idx) => (idx === i ? { ...p, [field]: value } : p)));
    setDirty(true); setSaved(false);
  }
  async function save() {
    setSaving(true); setErr(''); setSaved(false);
    try { await api('/pricing', { method: 'PUT', body: JSON.stringify({ plans }) }); setDirty(false); setSaved(true); }
    catch (e) { setErr(String(e)); }
    setSaving(false);
  }

  return (
    <>
      <PageHeader
        title="Pricing plans"
        subtitle="The single source of truth for the in-app billing page. Saving updates it everywhere at once — keep the marketing site in step."
        actions={<>
          <Button variant="secondary" onClick={load} disabled={!dirty}>Discard changes</Button>
          <Button onClick={save} disabled={saving || !dirty}>{saving ? 'Saving…' : 'Save pricing'}</Button>
        </>}
      />
      {err && <div className="rounded-control border border-rule bg-danger-soft px-4 py-2.5 text-sm text-danger" role="alert">{err}</div>}
      {saved && !dirty && <div className="rounded-control border border-rule bg-tint px-4 py-2.5 text-sm text-ok" role="status">Pricing saved.</div>}

      {loaded && !plans.length && <Card><EmptyState icon="tag" title="No plans returned" description="The pricing endpoint returned nothing to edit." /></Card>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {plans.map((p, i) => (
          <Card key={i} padding="px-5 pt-[18px] pb-5" className={p.active === false ? 'opacity-70' : ''}>
            <CardHeader
              title={p.name || `Plan ${i + 1}`}
              action={<span className="flex gap-1.5">{p.popular && <Badge tone="accent">Popular</Badge>}{p.contact && <Badge tone="neutral">Contact sales</Badge>}{p.active === false && <Badge tone="warn">Inactive</Badge>}</span>}
            />
            <div className="flex flex-col gap-3">
              <Field label="Plan name"><Input value={p.name || ''} onChange={(e) => setField(i, 'name', e.target.value)} placeholder="Growth" /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Price"><Input value={p.price || ''} onChange={(e) => setField(i, 'price', e.target.value)} placeholder="S$9" className="font-mono" /></Field>
                <Field label="Unit"><Input value={p.unit || ''} onChange={(e) => setField(i, 'unit', e.target.value)} placeholder="/ user / mo" /></Field>
              </div>
              <Field label="Tagline"><Input value={p.tagline || ''} onChange={(e) => setField(i, 'tagline', e.target.value)} placeholder="For growing teams that need payroll and compliance." /></Field>
              <Field label="Features" help="One per line.">
                <textarea className={`${TEXTAREA} h-28 resize-y`} value={(p.features || []).join('\n')} onChange={(e) => setField(i, 'features', e.target.value.split('\n').map((x) => x.trim()).filter(Boolean))} />
              </Field>
              <div className="flex flex-wrap gap-x-4 gap-y-2 text-[13px] text-ink">
                <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-accent" checked={!!p.popular} onChange={(e) => setField(i, 'popular', e.target.checked)} />Most popular</label>
                <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-accent" checked={!!p.contact} onChange={(e) => setField(i, 'contact', e.target.checked)} />Contact sales</label>
                <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-accent" checked={p.active !== false} onChange={(e) => setField(i, 'active', e.target.checked)} />Active</label>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
