'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetchRaw } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { PageHeader, Card, CardHeader, Badge, Button, Stat, Modal, Field, Input, Select, EmptyState, Icon } from '@/components/ui';

const HR_ROLES = ['HR_ADMIN', 'HR_MANAGER', 'SUPER_ADMIN', 'FINANCE_ADMIN'];

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/**
 * Sequential ramp for the leave heatmap: ten steps of the accent, light to
 * full. The previous token conversion had collapsed this to two shades (four
 * identical "page" steps, six identical "accent" steps), so the map could only
 * say "some" or "a lot". Alpha modifiers on tokens work since foundation v2.
 */
const HEAT = ['bg-accent/[0.04]', 'bg-accent/10', 'bg-accent/20', 'bg-accent/30', 'bg-accent/40', 'bg-accent/50', 'bg-accent/60', 'bg-accent/75', 'bg-accent/90', 'bg-accent'];

/**
 * "SGD 1,234", or an em dash when the value is missing. Each analytics endpoint
 * is fetched separately and can come back as {} (the API down, a tenant with no
 * data yet); calling .toLocaleString on undefined used to take the page down.
 */
const sgd = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? `SGD ${v.toLocaleString()}` : '—');

function Bar({ pct, className = 'bg-accent' }: { pct: number; className?: string }) {
  return (
    <div className="flex-1 h-2 rounded-full bg-pill overflow-hidden" aria-hidden="true">
      <div className={`h-full rounded-full ${className}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function AnalyticsPage() {
  const { user } = useAuth();
  const role = (user?.role || '').toUpperCase();
  const allowed = HR_ROLES.includes(role);

  const currentPeriod = new Date().toISOString().slice(0, 7);
  const currentYear   = String(new Date().getFullYear());
  const [period, setPeriod] = useState(currentPeriod);
  const [year, setYear]     = useState(currentYear);
  const [showBudgetModal, setShowBudgetModal] = useState(false);

  const [data, setData] = useState<any>({});
  const [loading, setLoading] = useState(true);

  async function loadAll() {
    setLoading(true);
    try {
      const [headcount, attrition, costPerHire, leaveHeat, otTrend, trainingRoi, payrollRatio, pdpa] = await Promise.all([
        apiFetchRaw(`/reports/analytics/headcount?period=${period}`).then(r => r.json()).catch(() => null),
        apiFetchRaw(`/reports/analytics/attrition?months=12`).then(r => r.json()).catch(() => null),
        apiFetchRaw(`/reports/analytics/cost-per-hire?period=${year}`).then(r => r.json()).catch(() => null),
        apiFetchRaw(`/reports/analytics/leave-heatmap?year=${year}`).then(r => r.json()).catch(() => null),
        apiFetchRaw(`/reports/analytics/ot-cost-trend?months=6`).then(r => r.json()).catch(() => null),
        apiFetchRaw(`/reports/analytics/training-roi?year=${year}`).then(r => r.json()).catch(() => null),
        apiFetchRaw(`/reports/analytics/payroll-revenue-ratio?period=${year}`).then(r => r.json()).catch(() => null),
        apiFetchRaw(`/reports/analytics/pdpa-retention`).then(r => r.json()).catch(() => null),
      ]);
      setData({ headcount, attrition, costPerHire, leaveHeat, otTrend, trainingRoi, payrollRatio, pdpa });
    } catch (err) {
      console.error('[analytics]', err);
    } finally { setLoading(false); }
  }

  useEffect(() => { if (user && allowed) loadAll(); }, [user, period, year, allowed]);

  if (!allowed) {
    return (
      <Card padding="p-0" className="max-w-2xl mx-auto mt-10">
        <EmptyState
          icon="lock"
          title="You don’t have access to analytics"
          description="This dashboard is open to HR and finance roles only."
          action={<Link href="/reports" className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-control border border-rule bg-paper text-sm font-semibold text-ink hover:bg-pill">Back to reports</Link>}
        />
      </Card>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="w-9 h-9 border-2 border-rule border-t-accent animate-spin rounded-full" role="status" aria-label="Loading analytics" />
      </div>
    );
  }

  const { headcount, attrition, costPerHire, leaveHeat, otTrend, trainingRoi, payrollRatio, pdpa } = data;
  const highAttrition = attrition?.attritionRatePct > 15;

  return (
    <div className="flex flex-col gap-5 pb-10">
      <PageHeader
        title="HR analytics"
        subtitle="Headcount, attrition, costs and compliance."
        actions={<Button variant="secondary" icon="plus" onClick={() => setShowBudgetModal(true)}>Set a budget</Button>}
      />

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Period" className="w-44">
          <Input type="month" value={period} onChange={e => setPeriod(e.target.value)} />
        </Field>
        <Field label="Year" className="w-28">
          <Input type="number" value={year} onChange={e => setYear(e.target.value)} />
        </Field>
      </div>

      {/* Top KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat
          label="Active headcount"
          value={headcount?.actual ?? '—'}
          note={headcount?.budget !== null && headcount?.budget !== undefined
            ? `Budget ${headcount.budget} · ${headcount.variancePct > 0 ? '+' : ''}${headcount.variancePct}%`
            : 'Budget not set'}
        />
        <Stat
          label="Attrition, 12 months"
          value={attrition?.attritionRatePct != null ? `${attrition.attritionRatePct}%` : '—'}
          note={attrition?.leaversCount != null ? (
            <span className="inline-flex flex-wrap items-center gap-1.5">
              {attrition.leaversCount} leavers
              {highAttrition && <Badge tone="warn">Above 15%</Badge>}
            </span>
          ) : undefined}
        />
        <Stat
          label="Cost per hire"
          value={costPerHire ? sgd(costPerHire.costPerHire) : '—'}
          note={costPerHire?.hires != null ? `${costPerHire.hires} hires in ${year}` : undefined}
        />
        <Stat
          label="Payroll to revenue"
          value={payrollRatio?.payrollToRevenueRatioPct !== undefined ? `${payrollRatio.payrollToRevenueRatioPct}%` : '—'}
          note={payrollRatio?.revenue ? `Revenue ${sgd(payrollRatio.revenue)}` : 'Revenue not set'}
        />
      </div>

      {/* Headcount by department */}
      {headcount && (
        <Card>
          <CardHeader title="Headcount by department" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2.5">
            {Object.entries(headcount.byDepartment || {}).map(([dept, n]) => {
              const total = headcount.actual || 1;
              const pct = Math.round(((n as number) / total) * 100);
              return (
                <div key={dept} className="flex items-center gap-3 text-[13px]">
                  <span className="font-semibold text-ink w-36 truncate">{dept}</span>
                  <Bar pct={pct} />
                  <span className="text-muted w-20 text-right tabular-nums">{n as number} ({pct}%)</span>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Attrition breakdowns */}
      {attrition && (
        <Card>
          <CardHeader title="Attrition breakdown" caption={`Rolling ${attrition.windowMonths} months`} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <p className="text-[12.5px] font-semibold text-muted mb-2.5">By length of service</p>
              <div className="flex flex-col gap-2">
                {Object.entries(attrition.byTenure || {}).map(([t, n]) => (
                  <div key={t} className="flex items-center gap-3 text-[13px]">
                    <span className="font-semibold text-ink w-14">{t}</span>
                    <Bar pct={Math.min(100, (n as number) * 10)} className="bg-ink/60" />
                    <span className="text-muted w-8 text-right tabular-nums">{n as number}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[12.5px] font-semibold text-muted mb-2.5">By department</p>
              <div className="flex flex-col gap-2">
                {Object.entries(attrition.byDepartment || {}).slice(0, 8).map(([d, n]) => (
                  <div key={d} className="flex items-center gap-3 text-[13px]">
                    <span className="font-semibold text-ink w-32 truncate">{d}</span>
                    <Bar pct={Math.min(100, (n as number) * 10)} className="bg-ink/60" />
                    <span className="text-muted w-8 text-right tabular-nums">{n as number}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Leave heatmap */}
      {leaveHeat && (
        <Card>
          <CardHeader title="Leave taken by month" caption={`${leaveHeat.year} · ${leaveHeat.totalDays} days in total`} />
          <div className="grid grid-cols-6 sm:grid-cols-12 gap-1.5">
            {(leaveHeat.monthlyDaysTaken || []).map((days: number, i: number) => {
              const max = Math.max(1, ...(leaveHeat.monthlyDaysTaken || []));
              const intensity = Math.round((days / max) * 9);
              return (
                <div key={i} className="text-center">
                  <div
                    className={`aspect-square rounded-control ${HEAT[intensity] || HEAT[0]} flex items-center justify-center`}
                    title={`${MONTH_LABELS[i]}: ${days} days`}
                  >
                    <span className={`text-xs font-bold tabular-nums ${intensity > 6 ? 'text-on-accent' : 'text-ink'}`}>{days}</span>
                  </div>
                  <p className="text-xs text-muted mt-1">{MONTH_LABELS[i]}</p>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-2 mt-3 text-xs text-muted" aria-hidden="true">
            Fewer
            <span className="flex gap-0.5">{[0, 3, 6, 9].map(k => <span key={k} className={`w-4 h-3 ${HEAT[k]}`} />)}</span>
            More
          </div>
          {Object.keys(leaveHeat.byLeaveType || {}).length > 0 && (
            <div className="mt-4 pt-4 border-t border-rule grid grid-cols-2 sm:grid-cols-3 gap-2">
              {Object.entries(leaveHeat.byLeaveType || {}).slice(0, 6).map(([t, n]) => (
                <div key={t} className="flex items-center justify-between gap-2 px-3 py-2 rounded-control bg-page text-[13px]">
                  <span className="font-semibold text-ink truncate">{t}</span>
                  <span className="font-bold text-ink tabular-nums">{n as number}d</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* OT cost trend */}
      {otTrend?.periods && (
        <Card>
          <CardHeader title="Overtime cost" caption="Last 6 months" />
          <div className="grid grid-cols-6 gap-2 sm:gap-3">
            {otTrend.periods.map((p: any, i: number) => {
              const max = Math.max(1, ...otTrend.periods.map((x: any) => x.totalCost || 0));
              const h = Math.max(8, Math.round(((p.totalCost || 0) / max) * 100));
              return (
                <div key={i} className="text-center min-w-0">
                  <div className="h-32 flex items-end justify-center">
                    <div className="w-full bg-accent rounded-t-control" style={{ height: `${h}%` }} title={`SGD ${p.totalCost}`} />
                  </div>
                  <p className="text-xs text-muted mt-1.5 tabular-nums">{p.period.slice(5)}</p>
                  <p className="text-xs font-semibold text-ink tabular-nums truncate">{sgd(p.totalCost || 0)}</p>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Training ROI */}
      {trainingRoi && (
        <Card>
          <CardHeader title="Training return" caption={trainingRoi.year} />
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Mini label="Programmes"        value={trainingRoi.trainings} />
            <Mini label="Total cost"        value={sgd(trainingRoi.totalCost)} />
            <Mini label="Cost per hour"     value={sgd(trainingRoi.costPerHour)} />
            <Mini label="Cost per completion" value={sgd(trainingRoi.costPerCompletion)} />
          </dl>
        </Card>
      )}

      {/* PDPA retention */}
      {pdpa && (
        <Card>
          <CardHeader title="PDPA retention" caption="Former employees’ records nearing the 7-year retention limit" />
          {!pdpa.approachingDeletion ? (
            <p className="flex items-center gap-2 text-sm text-muted">
              <Icon name="check" size={16} className="text-ok" />
              No records are close to the 7-year deletion threshold.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-semibold text-ink tabular-nums">{pdpa.approachingDeletion} record{pdpa.approachingDeletion === 1 ? '' : 's'} past 6.5 years since termination</p>
              {(pdpa.records || []).slice(0, 10).map((r: any) => (
                <div key={r.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-control bg-warn-bg text-[13px]">
                  <span className="min-w-0 truncate">
                    <span className="font-semibold text-ink">{r.name}</span>
                    <span className="text-muted"> · {r.code}</span>
                  </span>
                  <span className="font-semibold text-ink tabular-nums shrink-0">{r.daysSinceTermination} days</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {showBudgetModal && (
        <BudgetModal onClose={() => setShowBudgetModal(false)} onSuccess={() => { setShowBudgetModal(false); loadAll(); }} year={year} period={period} />
      )}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: any }) {
  return (
    <div className="px-3.5 py-3 rounded-control bg-page border border-rule">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-sm font-bold text-ink mt-0.5 tabular-nums">{value}</dd>
    </div>
  );
}

function BudgetModal({ onClose, onSuccess, year, period }: { onClose: () => void; onSuccess: () => void; year: string; period: string }) {
  const [form, setForm] = useState({ category: 'headcount', periodKey: period, value: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setSaving(true); setError('');
    const res = await apiFetchRaw('/reports/analytics/budget', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: form.category, period: form.periodKey, value: parseFloat(form.value) }),
    });
    if (res.ok) onSuccess();
    else { const e = await res.json(); setError(e.error || 'Failed'); }
    setSaving(false);
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Set a budget or target"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || !form.value} reason={!saving && !form.value ? 'Enter a value' : undefined}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Category">
          <Select value={form.category} onChange={e => {
            setForm({...form, category: e.target.value, periodKey: e.target.value === 'headcount' ? period : year});
          }}>
            <option value="headcount">Headcount target</option>
            <option value="recruitment">Recruitment spend</option>
            <option value="revenue">Annual revenue</option>
          </Select>
        </Field>
        <Field label={form.category === 'headcount' ? 'Period' : 'Year'} help={form.category === 'headcount' ? 'As YYYY-MM.' : 'As YYYY.'}>
          <Input value={form.periodKey} onChange={e => setForm({...form, periodKey: e.target.value})} />
        </Field>
        <Field label="Value" help="In SGD, or a number of people for a headcount target.">
          <Input type="number" value={form.value} onChange={e => setForm({...form, value: e.target.value})} />
        </Field>
        {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      </div>
    </Modal>
  );
}
