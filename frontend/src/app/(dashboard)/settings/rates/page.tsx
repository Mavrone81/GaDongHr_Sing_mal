'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@/lib/api';
import { Button, Card, CardHeader, EmptyState, Icon, Tabs, useToast } from '@/components/ui';
import { SectionHeader } from '../_components/SectionHeader';
import { Notice } from '../_components/Notice';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CpfRate {
  id: string;
  citizenStatus: 'SC_PR' | 'PR_YEAR1' | 'PR_YEAR2' | 'FOREIGNER';
  ageMin: number;
  ageMax: number | null;
  employeeRate: number;
  employerRate: number;
  owCeiling: number;
  awCeiling: number;
  effectiveDate: string;
  isActive: boolean;
}

interface SdlConfig {
  id: string;
  rate: number;
  minAmount: number;
  maxAmount: number;
  salaryCap: number;
  effectiveDate: string;
  isActive: boolean;
}

interface FwlRate {
  id: string;
  passType: 'WP' | 'S_PASS';
  sector: string;
  tier: string;
  dailyRate: number;
  effectiveDate: string;
  isActive: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pct(v: number) { return `${(v * 100).toFixed(2).replace(/\.00$/, '')}%`; }

const STATUS_LABELS: Record<string, string> = {
  SC_PR: 'SC / SPR (3rd year onwards)',
  PR_YEAR1: 'SPR year 1',
  PR_YEAR2: 'SPR year 2',
  FOREIGNER: 'Foreigner',
};

const STATUS_ORDER = ['SC_PR', 'PR_YEAR1', 'PR_YEAR2', 'FOREIGNER'];

const SECTOR_LABELS: Record<string, string> = {
  SERVICES: 'Services',
  CONSTRUCTION: 'Construction',
  MARINE: 'Marine',
  PROCESS: 'Process',
  MANUFACTURING: 'Manufacturing',
};

const TIER_LABELS: Record<string, string> = {
  TIER1: 'Tier 1',
  TIER2: 'Tier 2',
  BASIC_SKILLED: 'Basic skilled',
  HIGHER_SKILLED: 'Higher skilled',
};

const TH = 'h-10 px-4 text-left text-xs font-bold text-muted whitespace-nowrap';
const TD = 'px-4 py-3 text-[13.5px]';

const ageBracket = (r: CpfRate) => `${r.ageMin === 0 ? '≤' : `${r.ageMin}–`}${r.ageMax ? r.ageMax : '+'} yrs`;

// ─── Inline editable cell ─────────────────────────────────────────────────────

function EditableCell({ value, onSave, suffix = '', label }: { value: string | number; onSave: (v: string) => Promise<void>; suffix?: string; label?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const [saving, setSaving] = useState(false);

  const commit = async () => {
    if (draft === String(value)) { setEditing(false); return; }
    setSaving(true);
    try { await onSave(draft); setEditing(false); } finally { setSaving(false); }
  };

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <input
          autoFocus
          type="text"
          inputMode="decimal"
          aria-label={label ? `New value for ${label}` : 'New value'}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
          className="h-8 w-24 rounded-control border border-accent bg-paper px-2 text-[13px] font-semibold text-ink tabular-nums"
        />
        <Button size="sm" onClick={commit} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          aria-label="Cancel edit"
          className="flex h-8 w-8 items-center justify-center rounded-control text-muted hover:bg-pill hover:text-ink"
        >
          <Icon name="x" size={16} />
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => { setDraft(String(value)); setEditing(true); }}
      className="inline-flex items-center border-b border-dashed border-rule font-semibold text-ink tabular-nums transition-colors hover:border-accent hover:text-accent"
      title="Click to edit"
      aria-label={label ? `Edit ${label}: ${value}${suffix}` : undefined}
    >
      {value}{suffix}
    </button>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function RatesPage() {
  const [tab, setTab] = useState<'cpf' | 'sdl' | 'fwl'>('cpf');
  const [cpfRates, setCpfRates] = useState<CpfRate[]>([]);
  const [sdlConfig, setSdlConfig] = useState<SdlConfig | null>(null);
  const [fwlRates, setFwlRates] = useState<FwlRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const { toast } = useToast();
  const [cpfSort, setCpfSort] = useState<{ col: 'age' | 'emp' | 'ert' | 'tot' | 'ow'; dir: 'asc' | 'desc' }>({ col: 'age', dir: 'asc' });
  const [fwlSort, setFwlSort] = useState<{ col: 'sector' | 'tier' | 'daily'; dir: 'asc' | 'desc' }>({ col: 'sector', dir: 'asc' });

  function cmpCpf(a: CpfRate, b: CpfRate) {
    const d = cpfSort.dir === 'asc' ? 1 : -1;
    switch (cpfSort.col) {
      case 'age': return d * (a.ageMin - b.ageMin);
      case 'emp': return d * (a.employeeRate - b.employeeRate);
      case 'ert': return d * (a.employerRate - b.employerRate);
      case 'tot': return d * ((a.employeeRate + a.employerRate) - (b.employeeRate + b.employerRate));
      case 'ow':  return d * (a.owCeiling - b.owCeiling);
      default: return 0;
    }
  }
  function cmpFwl(a: FwlRate, b: FwlRate) {
    const d = fwlSort.dir === 'asc' ? 1 : -1;
    switch (fwlSort.col) {
      case 'sector': return d * (a.sector.localeCompare(b.sector) || a.tier.localeCompare(b.tier));
      case 'tier':   return d * (a.tier.localeCompare(b.tier) || a.sector.localeCompare(b.sector));
      case 'daily':  return d * (a.dailyRate - b.dailyRate);
      default: return 0;
    }
  }
  function toggleCpfSort(col: typeof cpfSort.col) {
    setCpfSort(prev => prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' });
  }
  function toggleFwlSort(col: typeof fwlSort.col) {
    setFwlSort(prev => prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' });
  }
  function SortHeader({ on, dir, label, onClick }: { on: boolean; dir: 'asc' | 'desc'; label: string; onClick: () => void }) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={`Sort by ${label.toLowerCase()}${on ? (dir === 'asc' ? ', ascending' : ', descending') : ''}`}
        className={`inline-flex items-center gap-1 hover:text-ink ${on ? 'text-ink' : ''}`}
      >
        {label}
        {on && <Icon name="chevronDown" size={13} strokeWidth={2.25} className={dir === 'asc' ? 'rotate-180' : ''} />}
      </button>
    );
  }

  const showToast = (msg: string, ok = true) => {
    // Same call shape as before; the shared toast (root layout) does the display and timing.
    toast(msg, ok ? 'ok' : 'danger');
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cpfData, sdlData, fwlData] = await Promise.all([
        apiFetch('/components/cpf-rates'),
        apiFetch('/components/sdl-config'),
        apiFetch('/components/fwl-rates'),
      ]);
      setCpfRates(cpfData);
      setSdlConfig(Object.keys(sdlData).length ? sdlData : null);
      setFwlRates(fwlData);
    } catch { showToast('Failed to load statutory tables', false); }
    finally { setLoading(false); }
  }, []); // eslint-disable-line

  useEffect(() => { load(); }, [load]);

  const seedDefaults = async () => {
    setSeeding(true);
    try {
      const data = await apiFetch('/components/seed-defaults', { method: 'POST' });
      showToast(`Defaults loaded — CPF: ${data.created.cpfRates}, SDL: ${data.created.sdlConfig}, FWL: ${data.created.fwlRates} records created`);
      await load();
    } catch (e: any) { showToast(e.message || 'Seed failed', false); }
    finally { setSeeding(false); }
  };

  const saveCpf = async (id: string, field: keyof CpfRate, rawVal: string) => {
    const val = parseFloat(rawVal);
    if (isNaN(val)) { showToast('Invalid number', false); return; }
    const body: any = {};
    if (field === 'employeeRate') body.employeeRate = val / 100;
    else if (field === 'employerRate') body.employerRate = val / 100;
    else if (field === 'owCeiling') body.owCeiling = val;
    else if (field === 'awCeiling') body.awCeiling = val;
    const updated = await apiFetch(`/components/cpf-rates/${id}`, { method: 'PUT', body: JSON.stringify(body) });
    setCpfRates(r => r.map(x => x.id === id ? updated : x));
    showToast('CPF rate updated');
  };

  const saveSdl = async (field: keyof SdlConfig, rawVal: string) => {
    const val = parseFloat(rawVal);
    if (isNaN(val)) { showToast('Invalid number', false); return; }
    const body: any = {};
    if (field === 'rate') body.rate = val / 100;
    else body[field] = val;
    setSdlConfig(await apiFetch('/components/sdl-config', { method: 'PUT', body: JSON.stringify(body) }));
    showToast('SDL config updated');
  };

  const saveFwl = async (id: string, rawVal: string) => {
    const val = parseFloat(rawVal);
    if (isNaN(val)) { showToast('Invalid number', false); return; }
    const updated = await apiFetch(`/components/fwl-rates/${id}`, { method: 'PUT', body: JSON.stringify({ dailyRate: val }) });
    setFwlRates(r => r.map(x => x.id === id ? updated : x));
    showToast('FWL rate updated');
  };

  const isEmpty = !loading && cpfRates.length === 0 && !sdlConfig && fwlRates.length === 0;
  const pct2 = (v: number) => (v * 100).toFixed(2).replace(/\.00$/, '');

  return (
    <>
      <SectionHeader
        title="Statutory tables"
        description="Singapore 2026 CPF, SDL and foreign worker levy rates. Super Admin only."
        actions={
          <Button variant="secondary" icon={seeding ? undefined : 'download'} onClick={seedDefaults} disabled={seeding || loading}>
            {seeding && <span className="h-4 w-4 border-2 border-accent/30 border-t-accent animate-spin rounded-full" />}
            Load Singapore 2026 defaults
          </Button>
        }
      />

      <Notice tone="warn">
        <span className="tabular-nums">CPF ordinary wage ceiling SGD 7,400 · additional wage ceiling SGD 102,000 · SDL 0.25% · effective January 2026.</span>{' '}
        <strong className="font-semibold">Check the SPR year 1 and 2 graduated rates against CPF Board Table B before running payroll.</strong>
      </Notice>

      {isEmpty && (
        <Card padding="p-0">
          <EmptyState
            icon="grid"
            title="Statutory tables are empty"
            description="Load the Singapore 2026 defaults to fill in CPF rates, SDL and foreign worker levy rates."
            action={<Button icon="download" onClick={seedDefaults} disabled={seeding}>Load Singapore 2026 defaults</Button>}
          />
        </Card>
      )}

      {!isEmpty && !loading && (
        <>
          <Tabs
            items={[
              { id: 'cpf', label: 'CPF contributions' },
              { id: 'sdl', label: 'Skills development levy' },
              { id: 'fwl', label: 'Foreign worker levy' },
            ]}
            active={tab}
            onChange={setTab}
          />

          {/* CPF */}
          {tab === 'cpf' && (
            <div className="flex flex-col gap-4">
              {STATUS_ORDER.filter(s => cpfRates.some(r => r.citizenStatus === s)).map(status => {
                const rows = cpfRates.filter(r => r.citizenStatus === status).sort(cmpCpf);
                const ow = cpfRates.find(r => r.citizenStatus === status)?.owCeiling;
                return (
                  <Card key={status} padding="p-0" className="overflow-hidden">
                    <div className="px-5 pt-4">
                      <CardHeader
                        title={STATUS_LABELS[status]}
                        action={<span className="font-medium text-muted tabular-nums">OW ceiling SGD {ow?.toLocaleString()}</span>}
                      />
                    </div>

                    {/* Desktop */}
                    <table className="hidden w-full md:table">
                      <thead className="border-y border-rule bg-pill">
                        <tr>
                          {([
                            { col: 'age', label: 'Age bracket' },
                            { col: 'emp', label: 'Employee %' },
                            { col: 'ert', label: 'Employer %' },
                            { col: 'tot', label: 'Total %' },
                            { col: 'ow',  label: 'OW ceiling (SGD)' },
                          ] as const).map(h => (
                            <th key={h.col} className={TH}>
                              <SortHeader on={cpfSort.col === h.col} dir={cpfSort.dir} label={h.label} onClick={() => toggleCpfSort(h.col)} />
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(r => (
                          <tr key={r.id} className="border-b border-rule last:border-0 hover:bg-page">
                            <td className={`${TD} font-semibold text-ink tabular-nums`}>{ageBracket(r)}</td>
                            <td className={TD}><EditableCell label="employee rate" value={pct2(r.employeeRate)} suffix="%" onSave={v => saveCpf(r.id, 'employeeRate', v)} /></td>
                            <td className={TD}><EditableCell label="employer rate" value={pct2(r.employerRate)} suffix="%" onSave={v => saveCpf(r.id, 'employerRate', v)} /></td>
                            <td className={`${TD} font-bold text-accent tabular-nums`}>{pct2(r.employeeRate + r.employerRate)}%</td>
                            <td className={TD}><EditableCell label="OW ceiling" value={r.owCeiling} onSave={v => saveCpf(r.id, 'owCeiling', v)} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {/* Mobile */}
                    <ul className="flex flex-col md:hidden">
                      {rows.map(r => (
                        <li key={r.id} className="border-t border-rule px-5 py-3.5">
                          <div className="mb-2 flex items-center justify-between">
                            <span className="text-sm font-semibold text-ink tabular-nums">{ageBracket(r)}</span>
                            <span className="text-sm font-bold text-accent tabular-nums">{pct2(r.employeeRate + r.employerRate)}% total</span>
                          </div>
                          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
                            <div className="flex flex-col gap-0.5"><dt className="text-muted">Employee</dt><dd><EditableCell label="employee rate" value={pct2(r.employeeRate)} suffix="%" onSave={v => saveCpf(r.id, 'employeeRate', v)} /></dd></div>
                            <div className="flex flex-col gap-0.5"><dt className="text-muted">Employer</dt><dd><EditableCell label="employer rate" value={pct2(r.employerRate)} suffix="%" onSave={v => saveCpf(r.id, 'employerRate', v)} /></dd></div>
                            <div className="flex flex-col gap-0.5"><dt className="text-muted">OW ceiling (SGD)</dt><dd><EditableCell label="OW ceiling" value={r.owCeiling} onSave={v => saveCpf(r.id, 'owCeiling', v)} /></dd></div>
                          </dl>
                        </li>
                      ))}
                    </ul>
                  </Card>
                );
              })}
              {cpfRates.length === 0 && (
                <Card padding="p-0"><EmptyState icon="grid" title="No CPF rates" description="Load the Singapore 2026 defaults to add them." /></Card>
              )}
              <p className="text-[13px] text-muted">Select any underlined value to edit it. Enter saves, Esc cancels.</p>
            </div>
          )}

          {/* SDL */}
          {tab === 'sdl' && (sdlConfig ? (
            <Card className="max-w-2xl" padding="px-[22px] pt-5 pb-2">
              <CardHeader title="Skills development levy" caption="Charged per employee per month." />
              {[
                { label: 'Levy rate', field: 'rate' as const, value: (sdlConfig.rate * 100).toFixed(4).replace(/0+$/, ''), suffix: '%', hint: 'Enter as a percentage, e.g. 0.25' },
                { label: 'Minimum payable', field: 'minAmount' as const, value: sdlConfig.minAmount, suffix: ' SGD', hint: 'Per month for wages below the salary cap' },
                { label: 'Maximum payable', field: 'maxAmount' as const, value: sdlConfig.maxAmount, suffix: ' SGD', hint: 'Monthly cap' },
                { label: 'Salary cap', field: 'salaryCap' as const, value: sdlConfig.salaryCap, suffix: ' SGD', hint: 'Highest wage subject to SDL' },
              ].map(({ label, field, value, suffix, hint }) => (
                <div key={field} className="flex flex-col gap-2 border-t border-rule py-3.5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-col gap-[3px]">
                    <span className="text-sm font-semibold text-ink">{label}</span>
                    <span className="text-[13px] text-muted">{hint}</span>
                  </div>
                  <div className="text-sm">
                    <EditableCell label={label.toLowerCase()} value={value} suffix={suffix} onSave={v => saveSdl(field, v)} />
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between border-t border-rule py-3.5">
                <span className="text-sm font-semibold text-ink">Effective date</span>
                <span className="text-sm text-ink tabular-nums">{new Date(sdlConfig.effectiveDate).toLocaleDateString('en-SG', { year: 'numeric', month: 'short', day: 'numeric' })}</span>
              </div>
            </Card>
          ) : (
            <Card padding="p-0"><EmptyState icon="grid" title="No SDL configuration" description="Load the Singapore 2026 defaults to add it." /></Card>
          ))}

          {/* FWL */}
          {tab === 'fwl' && (
            <div className="flex flex-col gap-4">
              {(['S_PASS', 'WP'] as const).filter(pt => fwlRates.some(r => r.passType === pt)).map(passType => {
                const rows = fwlRates.filter(r => r.passType === passType).sort(cmpFwl);
                return (
                  <Card key={passType} padding="p-0" className="overflow-hidden">
                    <div className="px-5 pt-4">
                      <CardHeader title={passType === 'S_PASS' ? 'S Pass holders' : 'Work Permit holders'} />
                    </div>

                    {/* Desktop */}
                    <table className="hidden w-full md:table">
                      <thead className="border-y border-rule bg-pill">
                        <tr>
                          {([
                            { col: 'sector', label: 'Sector' },
                            { col: 'tier',   label: 'Tier' },
                            { col: 'daily',  label: 'Daily rate (SGD)' },
                            { col: 'daily',  label: 'About monthly (×26)' },
                          ] as const).map((h, i) => (
                            <th key={i} className={TH}>
                              <SortHeader on={fwlSort.col === h.col} dir={fwlSort.dir} label={h.label} onClick={() => toggleFwlSort(h.col)} />
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(r => (
                          <tr key={r.id} className="border-b border-rule last:border-0 hover:bg-page">
                            <td className={`${TD} font-semibold text-ink`}>{SECTOR_LABELS[r.sector] ?? r.sector}</td>
                            <td className={`${TD} text-ink`}>{TIER_LABELS[r.tier] ?? r.tier}</td>
                            <td className={TD}><EditableCell label="daily rate" value={r.dailyRate.toFixed(2)} onSave={v => saveFwl(r.id, v)} /></td>
                            <td className={`${TD} text-muted tabular-nums`}>{(r.dailyRate * 26).toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {/* Mobile */}
                    <ul className="flex flex-col md:hidden">
                      {rows.map(r => (
                        <li key={r.id} className="flex items-center justify-between gap-3 border-t border-rule px-5 py-3.5">
                          <div className="flex flex-col">
                            <span className="text-sm font-semibold text-ink">{SECTOR_LABELS[r.sector] ?? r.sector}</span>
                            <span className="text-[13px] text-muted">{TIER_LABELS[r.tier] ?? r.tier} · about <span className="tabular-nums">{(r.dailyRate * 26).toFixed(2)}</span>/month</span>
                          </div>
                          <div className="text-sm"><EditableCell label="daily rate" value={r.dailyRate.toFixed(2)} onSave={v => saveFwl(r.id, v)} /></div>
                        </li>
                      ))}
                    </ul>
                  </Card>
                );
              })}
              {fwlRates.length === 0 && (
                <Card padding="p-0"><EmptyState icon="grid" title="No levy rates" description="Load the Singapore 2026 defaults to add them." /></Card>
              )}
              <p className="text-[13px] text-muted">Daily rate = MOM monthly levy ÷ 26 working days. Verify current levies at mom.gov.sg.</p>
            </div>
          )}
        </>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading statutory tables">
          {[1, 2, 3].map(i => <div key={i} className="h-12 rounded-control bg-pill animate-pulse" />)}
        </div>
      )}
    </>
  );
}
