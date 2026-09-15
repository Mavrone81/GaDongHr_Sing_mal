'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import GaDongLogo from '@/components/GaDongLogo';
import { Button, Card, Field, Input, Select } from '@/components/ui';
import { Notice } from '@/components/employee/RecordParts';

function apiUrl() {
  return process.env.NEXT_PUBLIC_API_URL || `http://${window.location.hostname}:4000/api`;
}

const INDUSTRIES = ['Technology', 'Finance', 'Retail', 'Manufacturing', 'Healthcare', 'F&B', 'Logistics', 'Professional Services', 'Construction', 'Education', 'Other'];

export default function CompanySetupPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    legalName: '', registrationNo: '', industry: 'Technology',
    addressLine1: '', addressLine2: '', postalCode: '', city: '', country: 'SG',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!form.legalName) { setError('Legal company name is required.'); return; }
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl()}/tenants/me/profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Could not save profile.'); setLoading(false); return; }
      router.push('/');
    } catch {
      setError('Could not reach the server. Please try again.');
      setLoading(false);
    }
  }

  const nameMissing = error === 'Legal company name is required.';

  return (
    <div className="min-h-screen bg-page font-sans text-ink">
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-6 px-4 py-8 sm:py-12">
        <GaDongLogo variant="light" markSize={30} />

        <form onSubmit={submit}>
          <Card padding="p-0">
            <div className="px-5 pt-6 pb-5 sm:px-7 border-b border-rule">
              <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-ink">Set up your company</h1>
              <p className="mt-1 text-sm text-muted">A few details so payroll and statutory settings match {form.country === 'SG' ? 'Singapore' : form.country}. You can change them later in Settings.</p>
            </div>

            <div className="flex flex-col gap-5 px-5 py-6 sm:px-7">
              {error && !nameMissing && <Notice tone="danger">{error}</Notice>}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Legal company name" required className="sm:col-span-2" error={nameMissing ? 'Enter the name as registered with ACRA or SSM' : undefined}>
                  <Input value={form.legalName} onChange={(e) => set('legalName', e.target.value)} placeholder="Acme Pte Ltd" required invalid={nameMissing} autoComplete="organization" />
                </Field>
                <Field label="Registration number" help="UEN or SSM number">
                  <Input value={form.registrationNo} onChange={(e) => set('registrationNo', e.target.value)} placeholder="201912345A" />
                </Field>
                <Field label="Industry">
                  <Select value={form.industry} onChange={(e) => set('industry', e.target.value)}>
                    {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
                  </Select>
                </Field>
                <Field label="Address line 1" className="sm:col-span-2">
                  <Input value={form.addressLine1} onChange={(e) => set('addressLine1', e.target.value)} placeholder="1 Raffles Place" autoComplete="address-line1" />
                </Field>
                <Field label="Address line 2" className="sm:col-span-2">
                  <Input value={form.addressLine2} onChange={(e) => set('addressLine2', e.target.value)} placeholder="#20-01" autoComplete="address-line2" />
                </Field>
                <Field label="Postal code">
                  <Input value={form.postalCode} onChange={(e) => set('postalCode', e.target.value)} placeholder="048616" inputMode="numeric" autoComplete="postal-code" />
                </Field>
                <Field label="City">
                  <Input value={form.city} onChange={(e) => set('city', e.target.value)} placeholder="Singapore" autoComplete="address-level2" />
                </Field>
              </div>
            </div>

            <div className="sticky bottom-0 rounded-b-card flex flex-col-reverse gap-2.5 border-t border-rule bg-paper px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
              <Button variant="ghost" onClick={() => router.push('/')}>Skip for now</Button>
              <Button type="submit" disabled={loading}>{loading ? 'Saving…' : 'Finish and go to dashboard'}</Button>
            </div>
          </Card>
        </form>
      </div>
    </div>
  );
}
