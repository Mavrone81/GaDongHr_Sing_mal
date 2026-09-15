'use client';

/**
 * Benefits — group insurance, claims, dependents, open enrollment, and the
 * flexi-benefits wallet. Employees see their own plans and claims; HR gets the
 * admin tabs (plans, enrollments, claims, open enrollment, flexi).
 *
 * Rebuilt to the "Clean workspace" kit (2026-09). Presentation only — every
 * fetch, action and modal save lives in useBenefits or the modal components and
 * is unchanged. See useBenefits.ts for the logic.
 */

import React, { useState } from 'react';
import { TONES } from '@/lib/statusTone';
import { apiFetchRaw } from '@/lib/api';
import { PageHeader, Card, CardHeader, Stat, Tabs, DataTable, Button, Field, Input, Select, Textarea, Modal, EmptyState, Icon } from '@/components/ui';
import type { Column } from '@/components/ui';
import {
  useBenefits,
  type Plan, type Enrollment, type Dependent, type Claim, type OpenEnrollmentPeriod,
  type FlexiCategory, type FlexiWallet, type FlexiClaim, type FlexiWalletConfig,
} from './useBenefits';

const PLAN_TYPES = ['GHS', 'GTL', 'PA', 'DENTAL', 'OUTPATIENT', 'OTHER'];

const TYPE_LABELS: Record<string, string> = {
  GHS: 'Hospitalisation & Surgical', GTL: 'Term Life', PA: 'Personal Accident',
  DENTAL: 'Dental', OUTPATIENT: 'Outpatient', OTHER: 'Other',
};

/**
 * Status by weight and fill, not hue — the palette has no error red or success
 * green to spend (seal red is reserved). TONES is the shared workflow-state kit.
 */
const STATUS_TONE: Record<string, string> = {
  SUBMITTED:    TONES.pending,
  UNDER_REVIEW: TONES.active,
  APPROVED:     TONES.approved,
  REIMBURSED:   TONES.done,
  ACTIVE:       TONES.approved,
  EXPIRED:      TONES.warning,
  REJECTED:     TONES.critical,
  CANCELLED:    TONES.inert,
  PENDING:      TONES.pending,
  SCHEDULED:    TONES.active,
  CLOSED:       TONES.inert,
};

const sentence = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');
const sgd = (n: number | null | undefined) => `S$${Number(n || 0).toLocaleString('en-SG')}`;
const fmtDate = (v: string) => new Date(v).toLocaleDateString('en-SG');

function Chip({ label, cls = 'bg-pill text-muted' }: { label: string; cls?: string }) {
  return <span className={`inline-flex items-center h-6 px-2.5 rounded-full text-xs whitespace-nowrap ${cls}`}>{label}</span>;
}
const StatusChip = ({ status, extra = '' }: { status: string; extra?: string }) =>
  <Chip label={`${sentence(status)}${extra}`} cls={STATUS_TONE[status] ?? 'bg-pill text-muted'} />;

export default function BenefitsPage() {
  const {
    isHr,
    hrTab, setHrTab,
    flexiSubTab, setFlexiSubTab,
    plans, myEnrollments, allEnrollments, myDependents, myClaims, allClaims,
    openPeriod, allPeriods, dashboard, loading,
    flexiWallet, flexiBalance, myFlexiClaims, flexiCategories,
    allFlexiWallets, allFlexiClaims, flexiDashboard, flexiConfigs,
    flexiYearEndPreview, flexiYear, setFlexiYear,
    showPlanModal, setShowPlanModal,
    editingPlan, setEditingPlan,
    showEnrollModal, setShowEnrollModal,
    enrollPlan, setEnrollPlan,
    showDependentModal, setShowDependentModal,
    showClaimModal, setShowClaimModal,
    claimEnrollment, setClaimEnrollment,
    showPeriodModal, setShowPeriodModal,
    showFlexiClaimModal, setShowFlexiClaimModal,
    showFlexiCreditModal, setShowFlexiCreditModal,
    loadData,
    cancelEnrollment, approveClaim, rejectClaim, reimburseClaim, deleteDependent,
    closePeriod, approveFlexiClaim, rejectFlexiClaim, cancelFlexiClaim,
    runFlexiYearEnd, loadYearEndPreview, seedFlexiCategories,
  } = useBenefits();

  const openBadge = openPeriod
    ? <Chip label={`Open enrollment · ends ${fmtDate(openPeriod.endDate)}`} cls="bg-tint text-accent" />
    : undefined;

  if (loading) {
    return <div className="py-16 text-center text-sm text-muted">Loading…</div>;
  }

  // ─── EMPLOYEE VIEW ──────────────────────────────────────────────────────────
  if (!isHr) {
    const activeEnrollments = myEnrollments.filter(e => e.status === 'ACTIVE');
    const availablePlansForSelfEnroll = openPeriod
      ? plans.filter(p => p.isActive && (openPeriod.planIds.length === 0 || openPeriod.planIds.includes(p.id)) && !activeEnrollments.some(e => e.planId === p.id))
      : [];

    return (
      <div className="max-w-6xl mx-auto flex flex-col gap-6">
        <PageHeader
          title="My benefits"
          subtitle="Your insurance plans, claims, dependents and flexi-benefits wallet."
          actions={openBadge}
        />

        {/* Active plans */}
        <section className="flex flex-col gap-3">
          <h2 className="text-[15.5px] font-bold text-ink">Active plans ({activeEnrollments.length})</h2>
          {activeEnrollments.length === 0 ? (
            <EmptyState icon="shield" title="No active benefit plans"
              description={openPeriod && availablePlansForSelfEnroll.length > 0 ? 'Enrol in a plan from the list below.' : 'You are not enrolled in any plan yet.'} />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {activeEnrollments.map(e => (
                <Card key={e.id}>
                  <CardHeader
                    title={e.plan?.name}
                    caption={e.plan?.insurerName}
                    action={<Chip label={TYPE_LABELS[e.plan?.type || 'OTHER']} />}
                  />
                  <div className="grid grid-cols-2 gap-3 text-[13px]">
                    <div><p className="text-muted">Coverage</p><p className="font-semibold text-ink tabular-nums">{sgd(e.plan?.coverageAmount)}</p></div>
                    <div><p className="text-muted">Effective</p><p className="font-semibold text-ink tabular-nums">{fmtDate(e.effectiveFrom)}</p></div>
                    <div><p className="text-muted">Dependents</p><p className="font-semibold text-ink tabular-nums">{e.enrolledDependentIds.length}</p></div>
                    <div><p className="text-muted">Your co-pay</p><p className="font-semibold text-ink tabular-nums">{e.annualPremiumEmployee > 0 ? `${sgd(e.annualPremiumEmployee)}/yr` : 'Employer-paid'}</p></div>
                  </div>
                  <div className="mt-4 flex gap-2">
                    <Button className="flex-1" onClick={() => { setClaimEnrollment(e); setShowClaimModal(true); }}>Submit claim</Button>
                    <Button variant="secondary" onClick={() => cancelEnrollment(e.id)}>Cancel</Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* Available during open enrollment */}
        {openPeriod && availablePlansForSelfEnroll.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="text-[15.5px] font-bold text-ink">Available during open enrollment</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {availablePlansForSelfEnroll.map(p => (
                <Card key={p.id} className="border-accent">
                  <CardHeader title={p.name} caption={p.insurerName} action={<Chip label={TYPE_LABELS[p.type]} />} />
                  {p.description && <p className="text-[13px] text-muted mb-3">{p.description}</p>}
                  <div className="grid grid-cols-2 gap-3 text-[13px]">
                    <div><p className="text-muted">Coverage</p><p className="font-semibold text-ink tabular-nums">{sgd(p.coverageAmount)}</p></div>
                    <div><p className="text-muted">Your co-pay</p><p className="font-semibold text-ink tabular-nums">{p.premiumEmployee > 0 ? `${sgd(p.premiumEmployee)}/yr` : 'Free'}</p></div>
                  </div>
                  <Button className="mt-4 w-full" onClick={() => { setEnrollPlan(p); setShowEnrollModal(true); }}>Enrol</Button>
                </Card>
              ))}
            </div>
          </section>
        )}

        {/* Dependents */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[15.5px] font-bold text-ink">My dependents ({myDependents.length})</h2>
            <Button variant="secondary" size="sm" icon="plus" onClick={() => setShowDependentModal(true)}>Add dependent</Button>
          </div>
          {myDependents.length === 0 ? (
            <EmptyState icon="users" title="No dependents on file" description="Add a spouse, child or parent to include them in eligible plans." />
          ) : (
            <DataTable<Dependent>
              aria-label="Dependents"
              rows={myDependents}
              rowKey={(d) => d.id}
              columns={[
                { key: 'name', label: 'Name', width: 'minmax(0,1.5fr)', render: (d) => <span className="font-semibold text-ink">{d.fullName}</span> },
                { key: 'rel', label: 'Relationship', render: (d) => sentence(d.relationship) },
                { key: 'dob', label: 'Date of birth', numeric: true, render: (d) => fmtDate(d.dateOfBirth) },
                { key: 'action', label: '', width: '100px', align: 'right', render: (d) => <Button variant="ghost" size="sm" onClick={() => deleteDependent(d.id)}>Remove</Button> },
              ]}
              mobileCard={(d) => (
                <div className="flex items-center justify-between gap-2">
                  <span className="flex flex-col"><span className="font-semibold text-ink">{d.fullName}</span><span className="text-[13px] text-muted">{sentence(d.relationship)} · {fmtDate(d.dateOfBirth)}</span></span>
                  <Button variant="ghost" size="sm" onClick={() => deleteDependent(d.id)}>Remove</Button>
                </div>
              )}
            />
          )}
        </section>

        {/* My claims */}
        <section className="flex flex-col gap-3">
          <h2 className="text-[15.5px] font-bold text-ink">My claims ({myClaims.length})</h2>
          {myClaims.length === 0 ? (
            <EmptyState icon="receipt" title="No claims submitted yet" description="Submit a claim from one of your active plans above." />
          ) : (
            <DataTable<Claim>
              aria-label="My claims"
              rows={myClaims}
              rowKey={(c) => c.id}
              columns={[
                { key: 'num', label: 'Claim #', render: (c) => <span className="tabular-nums">{c.claimNumber}</span> },
                { key: 'treat', label: 'Treatment', render: (c) => c.treatmentType },
                { key: 'date', label: 'Date', numeric: true, render: (c) => fmtDate(c.treatmentDate) },
                { key: 'amt', label: 'Amount', numeric: true, align: 'right', render: (c) => sgd(c.claimAmount) },
                { key: 'status', label: 'Status', width: '130px', render: (c) => <StatusChip status={c.status} /> },
              ]}
              mobileCard={(c) => (
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-2"><span className="font-semibold text-ink">{c.treatmentType}</span><StatusChip status={c.status} /></div>
                  <span className="text-[13px] text-muted tabular-nums">{c.claimNumber} · {fmtDate(c.treatmentDate)} · {sgd(c.claimAmount)}</span>
                </div>
              )}
            />
          )}
        </section>

        {/* Flexi wallet */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[15.5px] font-bold text-ink">My flexi-benefits wallet</h2>
            {flexiWallet && flexiCategories.length > 0 && (
              <Button variant="secondary" size="sm" icon="plus" onClick={() => setShowFlexiClaimModal(true)}>Submit claim</Button>
            )}
          </div>
          {!flexiWallet ? (
            <EmptyState icon="wallet" title={`No flexi wallet for ${new Date().getFullYear()}`} description="Contact HR to have a wallet credited." />
          ) : (
            <div className="flex flex-col gap-4">
              <Card className={flexiWallet.status === 'EXPIRED' ? 'opacity-70' : 'border-accent'}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[12.5px] font-semibold text-muted">Flexi wallet {flexiWallet.year}</p>
                    <p className={`text-[30px] font-extrabold tracking-[-0.02em] tabular-nums mt-1 ${flexiWallet.status === 'EXPIRED' ? 'text-muted' : 'text-accent'}`}>{sgd(flexiBalance?.remaining)}</p>
                    <p className="text-[13px] text-muted">remaining balance</p>
                  </div>
                  <StatusChip status={flexiWallet.status} />
                </div>
                {flexiBalance && flexiBalance.credited > 0 && (
                  <div className="mt-4">
                    <div className="flex justify-between text-[13px] text-muted mb-1.5"><span>Used</span><span className="tabular-nums">{Math.round((flexiBalance.used / flexiBalance.credited) * 100)}%</span></div>
                    <div className="h-2 rounded-full bg-pill overflow-hidden"><div className="h-full bg-accent" style={{ width: `${Math.min(100, (flexiBalance.used / flexiBalance.credited) * 100)}%` }} /></div>
                  </div>
                )}
                <div className="grid grid-cols-3 gap-3 mt-4 text-[13px]">
                  <div><p className="text-muted">Credited</p><p className="font-semibold text-ink tabular-nums">{sgd(flexiBalance?.credited)}</p></div>
                  <div><p className="text-muted">Approved used</p><p className="font-semibold text-ink tabular-nums">{sgd(flexiBalance?.used)}</p></div>
                  <div><p className="text-muted">Pending</p><p className="font-semibold text-ink tabular-nums">{sgd(flexiBalance?.pending)}</p></div>
                </div>
                <p className="text-[13px] text-muted mt-3">Expires {new Date(flexiWallet.expiresAt).toLocaleDateString('en-SG', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
              </Card>
              {flexiCategories.length > 0 && (
                <div>
                  <p className="text-[12.5px] font-semibold text-muted mb-2">Eligible spend categories</p>
                  <div className="flex flex-wrap gap-2">
                    {flexiCategories.map(cat => <Chip key={cat.id} label={cat.name} cls="bg-tint text-accent" />)}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {/* My flexi claims */}
        {myFlexiClaims.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="text-[15.5px] font-bold text-ink">My flexi claims ({myFlexiClaims.length})</h2>
            <DataTable<FlexiClaim>
              aria-label="My flexi claims"
              rows={myFlexiClaims}
              rowKey={(c) => c.id}
              columns={[
                { key: 'num', label: 'Claim #', render: (c) => <span className="tabular-nums">{c.claimNumber}</span> },
                { key: 'cat', label: 'Category', render: (c) => <Chip label={c.categoryName} cls="bg-tint text-accent" /> },
                { key: 'desc', label: 'Description', width: 'minmax(0,1.5fr)', render: (c) => c.description },
                { key: 'amt', label: 'Amount', numeric: true, align: 'right', render: (c) => sgd(c.claimAmount) },
                { key: 'status', label: 'Status', width: '140px', render: (c) => <StatusChip status={c.status} extra={c.autoApproved && c.status === 'APPROVED' ? ' (auto)' : ''} /> },
                { key: 'action', label: '', width: '90px', align: 'right', render: (c) => c.status === 'PENDING' ? <Button variant="ghost" size="sm" onClick={() => cancelFlexiClaim(c.id)}>Cancel</Button> : null },
              ]}
              mobileCard={(c) => (
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-2"><span className="font-semibold text-ink">{c.categoryName}</span><StatusChip status={c.status} extra={c.autoApproved && c.status === 'APPROVED' ? ' (auto)' : ''} /></div>
                  <span className="text-[13px] text-muted tabular-nums">{c.claimNumber} · {sgd(c.claimAmount)}</span>
                  <span className="text-[13px] text-muted">{c.description}</span>
                  {c.status === 'PENDING' && <Button variant="ghost" size="sm" className="self-start" onClick={() => cancelFlexiClaim(c.id)}>Cancel</Button>}
                </div>
              )}
            />
          </section>
        )}

        {showEnrollModal && enrollPlan && (
          <EnrollModal plan={enrollPlan} dependents={myDependents}
            onClose={() => { setShowEnrollModal(false); setEnrollPlan(null); }}
            onSuccess={() => { setShowEnrollModal(false); setEnrollPlan(null); loadData(); }} />
        )}
        {showDependentModal && (
          <DependentModal onClose={() => setShowDependentModal(false)} onSuccess={() => { setShowDependentModal(false); loadData(); }} />
        )}
        {showClaimModal && claimEnrollment && (
          <ClaimModal enrollment={claimEnrollment} dependents={myDependents}
            onClose={() => { setShowClaimModal(false); setClaimEnrollment(null); }}
            onSuccess={() => { setShowClaimModal(false); setClaimEnrollment(null); loadData(); }} />
        )}
        {showFlexiClaimModal && flexiWallet && (
          <FlexiClaimModal wallet={flexiWallet} categories={flexiCategories}
            onClose={() => setShowFlexiClaimModal(false)} onSuccess={() => { setShowFlexiClaimModal(false); loadData(); }} />
        )}
      </div>
    );
  }

  // ─── HR VIEW ─────────────────────────────────────────────────────────────────
  const stats = dashboard?.enrollmentSummary || {};
  const claimsStats = dashboard?.claimsSummary || {};

  return (
    <div className="max-w-7xl mx-auto flex flex-col gap-6">
      <PageHeader
        title="Benefits administration"
        subtitle="Group insurance, claims, open enrollment and the flexi-benefits wallet."
        actions={openBadge}
      />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Active enrollments" value={<span className="tabular-nums">{stats.active || 0}</span>} />
        <Stat label="Open claims" value={<span className="tabular-nums">{(claimsStats.byStatus?.SUBMITTED || 0) + (claimsStats.byStatus?.UNDER_REVIEW || 0)}</span>} />
        <Stat label="Reimbursed YTD" value={<span className="tabular-nums">{sgd(claimsStats.totalReimbursed)}</span>} />
        <Stat label="Employer premium/yr" value={<span className="tabular-nums">{sgd(stats.totalEmployerPremium)}</span>} />
      </div>

      {/* Tabs */}
      <Tabs
        active={hrTab}
        onChange={(id) => setHrTab(id)}
        items={[
          { id: 'plans', label: 'Plans', count: plans.length },
          { id: 'enrollments', label: 'Enrollments', count: allEnrollments.length },
          { id: 'claims', label: 'Claims', count: allClaims.length },
          { id: 'openEnroll', label: 'Open enrollment', count: allPeriods.length },
          { id: 'flexi', label: 'Flexi benefits', count: allFlexiWallets.length },
        ]}
      />

      {/* Plans */}
      {hrTab === 'plans' && (
        <div className="flex flex-col gap-4">
          <div className="flex justify-end">
            <Button icon="plus" onClick={() => { setEditingPlan(null); setShowPlanModal(true); }}>New plan</Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {plans.map(p => {
              const active = allEnrollments.filter(e => e.planId === p.id && e.status === 'ACTIVE').length;
              return (
                <Card key={p.id} className={p.isActive ? '' : 'opacity-60'}>
                  <CardHeader
                    title={<span className="flex items-center gap-2">{p.name}{!p.isActive && <Chip label="Inactive" />}</span>}
                    caption={`${p.code} · ${p.insurerName}`}
                    action={<Chip label={TYPE_LABELS[p.type]} />}
                  />
                  <div className="grid grid-cols-3 gap-2 text-[13px]">
                    <div><p className="text-muted">Coverage</p><p className="font-semibold text-ink tabular-nums">{sgd(p.coverageAmount)}</p></div>
                    <div><p className="text-muted">Employer/yr</p><p className="font-semibold text-ink tabular-nums">{sgd(p.premiumEmployer)}</p></div>
                    <div><p className="text-muted">Active enrolled</p><p className="font-semibold text-ink tabular-nums">{active}</p></div>
                  </div>
                  <div className="mt-4 flex gap-2">
                    <Button variant="secondary" size="sm" className="flex-1" onClick={() => { setEditingPlan(p); setShowPlanModal(true); }}>Edit</Button>
                    {p.isActive && (
                      <Button variant="danger" size="sm" onClick={() => {
                        if (confirm(`Deactivate ${p.name}?`)) {
                          apiFetchRaw(`/benefits/plans/${p.id}`, { method: 'DELETE' })
                            .then(r => r.ok ? loadData() : r.json().then((e: any) => alert(e.error || 'Failed')));
                        }
                      }}>Deactivate</Button>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Enrollments */}
      {hrTab === 'enrollments' && (
        <DataTable<Enrollment>
          aria-label="Enrollments"
          rows={allEnrollments}
          rowKey={(e) => e.id}
          empty="No enrollments yet."
          columns={[
            { key: 'emp', label: 'Employee', width: 'minmax(0,1.4fr)', render: (e) => <span className="font-semibold text-ink">{e.employeeName}</span> },
            { key: 'plan', label: 'Plan', render: (e) => e.plan?.name || e.planId },
            { key: 'src', label: 'Source', render: (e) => <span className="text-muted">{sentence(String((e as any).enrollmentSource ?? ''))}</span> },
            { key: 'eff', label: 'Effective', numeric: true, render: (e) => fmtDate(e.effectiveFrom) },
            { key: 'prem', label: 'Premium/yr', numeric: true, align: 'right', render: (e) => sgd(e.annualPremiumEmployer) },
            { key: 'status', label: 'Status', width: '120px', render: (e) => <StatusChip status={e.status} /> },
          ]}
          mobileCard={(e) => (
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2"><span className="font-semibold text-ink">{e.employeeName}</span><StatusChip status={e.status} /></div>
              <span className="text-[13px] text-muted">{e.plan?.name || e.planId} · {fmtDate(e.effectiveFrom)} · <span className="tabular-nums">{sgd(e.annualPremiumEmployer)}/yr</span></span>
            </div>
          )}
        />
      )}

      {/* Claims */}
      {hrTab === 'claims' && (
        <DataTable<Claim>
          aria-label="Claims"
          rows={allClaims}
          rowKey={(c) => c.id}
          empty="No claims yet."
          columns={[
            { key: 'num', label: 'Claim #', render: (c) => <span className="tabular-nums">{c.claimNumber}</span> },
            { key: 'emp', label: 'Employee', render: (c) => c.employeeName },
            { key: 'treat', label: 'Treatment', render: (c) => c.treatmentType },
            { key: 'date', label: 'Date', numeric: true, render: (c) => fmtDate(c.treatmentDate) },
            { key: 'claim', label: 'Claim', numeric: true, align: 'right', render: (c) => sgd(c.claimAmount) },
            { key: 'appr', label: 'Approved', numeric: true, align: 'right', render: (c) => c.approvedAmount !== null ? sgd(c.approvedAmount) : '—' },
            { key: 'status', label: 'Status', width: '124px', render: (c) => <StatusChip status={c.status} /> },
            { key: 'action', label: '', width: 'minmax(160px,0.9fr)', align: 'right', render: (c) => (
              <span className="flex justify-end gap-1">
                {(c.status === 'SUBMITTED' || c.status === 'UNDER_REVIEW') && (<>
                  <Button variant="ghost" size="sm" onClick={() => approveClaim(c.id)}>Approve</Button>
                  <Button variant="ghost" size="sm" onClick={() => rejectClaim(c.id)}>Reject</Button>
                </>)}
                {c.status === 'APPROVED' && <Button variant="ghost" size="sm" onClick={() => reimburseClaim(c.id)}>Mark reimbursed</Button>}
              </span>
            ) },
          ]}
          mobileCard={(c) => (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2"><span className="font-semibold text-ink">{c.employeeName}</span><StatusChip status={c.status} /></div>
              <span className="text-[13px] text-muted tabular-nums">{c.claimNumber} · {c.treatmentType} · {sgd(c.claimAmount)}</span>
              <span className="flex gap-1">
                {(c.status === 'SUBMITTED' || c.status === 'UNDER_REVIEW') && (<>
                  <Button variant="ghost" size="sm" onClick={() => approveClaim(c.id)}>Approve</Button>
                  <Button variant="ghost" size="sm" onClick={() => rejectClaim(c.id)}>Reject</Button>
                </>)}
                {c.status === 'APPROVED' && <Button variant="ghost" size="sm" onClick={() => reimburseClaim(c.id)}>Mark reimbursed</Button>}
              </span>
            </div>
          )}
        />
      )}

      {/* Open enrollment */}
      {hrTab === 'openEnroll' && (
        <div className="flex flex-col gap-4">
          <div className="flex justify-end">
            <Button icon="plus" onClick={() => setShowPeriodModal(true)}>New period</Button>
          </div>
          <DataTable<OpenEnrollmentPeriod>
            aria-label="Open enrollment periods"
            rows={allPeriods}
            rowKey={(p) => p.id}
            empty="No open enrollment periods yet."
            columns={[
              { key: 'name', label: 'Name', width: 'minmax(0,1.4fr)', render: (p) => <span className="font-semibold text-ink">{p.name}</span> },
              { key: 'year', label: 'Year', numeric: true, render: (p) => p.year },
              { key: 'window', label: 'Window', width: 'minmax(0,1.4fr)', render: (p) => <span className="tabular-nums">{fmtDate(p.startDate)} → {fmtDate(p.endDate)}</span> },
              { key: 'plans', label: 'Plans', render: (p) => p.planIds.length || 'All' },
              { key: 'status', label: 'Status', width: '120px', render: (p) => <StatusChip status={p.status} /> },
              { key: 'action', label: '', width: '90px', align: 'right', render: (p) => p.status !== 'CLOSED' ? <Button variant="ghost" size="sm" onClick={() => closePeriod(p.id)}>Close</Button> : null },
            ]}
            mobileCard={(p) => (
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2"><span className="font-semibold text-ink">{p.name}</span><StatusChip status={p.status} /></div>
                <span className="text-[13px] text-muted tabular-nums">{p.year} · {fmtDate(p.startDate)} → {fmtDate(p.endDate)}</span>
                {p.status !== 'CLOSED' && <Button variant="ghost" size="sm" className="self-start" onClick={() => closePeriod(p.id)}>Close</Button>}
              </div>
            )}
          />
        </div>
      )}

      {/* Flexi benefits */}
      {hrTab === 'flexi' && (
        <div className="flex flex-col gap-4">
          <Tabs
            active={flexiSubTab}
            onChange={(id) => setFlexiSubTab(id)}
            items={[
              { id: 'wallets', label: 'Wallets', count: allFlexiWallets.length },
              { id: 'claims', label: 'Claims', count: allFlexiClaims.length },
              { id: 'config', label: 'Config', count: flexiConfigs.length },
              { id: 'yearend', label: 'Year-end' },
            ]}
          />

          <div className="flex flex-wrap items-end gap-3">
            <Field label="Year" className="w-28">
              <Select value={flexiYear} onChange={e => setFlexiYear(parseInt(e.target.value))}>
                {[flexiYear - 1, flexiYear, flexiYear + 1].map(y => <option key={y} value={y}>{y}</option>)}
              </Select>
            </Field>
            <Button variant="secondary" onClick={() => loadData()}>Refresh</Button>
            <Button variant="secondary" onClick={seedFlexiCategories}>Seed categories</Button>
          </div>

          {flexiSubTab === 'wallets' && (
            <div className="flex flex-col gap-4">
              {flexiDashboard && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <Stat label="Active wallets" value={<span className="tabular-nums">{flexiDashboard.activeWallets || 0}</span>} />
                  <Stat label="Total credited" value={<span className="tabular-nums">{sgd(flexiDashboard.totalCredited)}</span>} />
                  <Stat label="Total used" value={<span className="tabular-nums">{sgd(flexiDashboard.totalUsed)}</span>} />
                  <Stat label="Total remaining" value={<span className="tabular-nums">{sgd(flexiDashboard.totalRemaining)}</span>} />
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button icon="plus" onClick={() => setShowFlexiCreditModal(true)}>Credit wallet</Button>
                <Button variant="secondary" onClick={async () => {
                  if (!confirm('Credit flexi wallets for ALL active employees based on their grade? This uses the batch endpoint.')) return;
                  const res = await apiFetchRaw('/benefits/flexi-wallets/credit-batch', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ year: flexiYear }),
                  });
                  if (res.ok) { const d = await res.json(); alert(`Credited ${d.credited} wallets (${d.skipped} skipped).`); loadData(); }
                  else alert((await res.json()).error || 'Failed');
                }}>Batch credit all</Button>
              </div>
              <DataTable<FlexiWallet>
                aria-label="Flexi wallets"
                rows={allFlexiWallets}
                rowKey={(w) => w.id}
                empty={`No wallets for ${flexiYear}.`}
                columns={[
                  { key: 'emp', label: 'Employee', width: 'minmax(0,1.4fr)', render: (w) => <span className="font-semibold text-ink">{w.employeeName}</span> },
                  { key: 'grade', label: 'Grade', render: (w) => w.employeeGrade || '—' },
                  { key: 'credited', label: 'Credited', numeric: true, align: 'right', render: (w) => sgd(w.creditedAmount) },
                  { key: 'used', label: 'Used', numeric: true, align: 'right', render: (w) => sgd(w.usedAmount) },
                  { key: 'remaining', label: 'Remaining', numeric: true, align: 'right', render: (w) => <span className="font-semibold text-accent">{sgd(w.creditedAmount - w.usedAmount)}</span> },
                  { key: 'expires', label: 'Expires', numeric: true, render: (w) => fmtDate(w.expiresAt) },
                  { key: 'status', label: 'Status', width: '110px', render: (w) => <StatusChip status={w.status} /> },
                ]}
                mobileCard={(w) => (
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-2"><span className="font-semibold text-ink">{w.employeeName}</span><StatusChip status={w.status} /></div>
                    <span className="text-[13px] text-muted tabular-nums">Remaining {sgd(w.creditedAmount - w.usedAmount)} of {sgd(w.creditedAmount)}</span>
                  </div>
                )}
              />
            </div>
          )}

          {flexiSubTab === 'claims' && (
            <DataTable<FlexiClaim>
              aria-label="Flexi claims"
              rows={allFlexiClaims}
              rowKey={(c) => c.id}
              empty={`No claims for ${flexiYear}.`}
              columns={[
                { key: 'num', label: 'Claim #', render: (c) => <span className="tabular-nums">{c.claimNumber}</span> },
                { key: 'emp', label: 'Employee', render: (c) => c.employeeName },
                { key: 'cat', label: 'Category', render: (c) => <Chip label={c.categoryName} cls="bg-tint text-accent" /> },
                { key: 'desc', label: 'Description', width: 'minmax(0,1.4fr)', render: (c) => c.description },
                { key: 'amt', label: 'Amount', numeric: true, align: 'right', render: (c) => sgd(c.claimAmount) },
                { key: 'status', label: 'Status', width: '140px', render: (c) => <StatusChip status={c.status} extra={c.autoApproved && c.status === 'APPROVED' ? ' (auto)' : ''} /> },
                { key: 'action', label: '', width: 'minmax(150px,0.8fr)', align: 'right', render: (c) => (
                  <span className="flex justify-end gap-1">
                    {c.status === 'PENDING' && (<>
                      <Button variant="ghost" size="sm" onClick={() => approveFlexiClaim(c.id, c.claimAmount)}>Approve</Button>
                      <Button variant="ghost" size="sm" onClick={() => rejectFlexiClaim(c.id)}>Reject</Button>
                    </>)}
                    {c.status === 'APPROVED' && <Button variant="ghost" size="sm" onClick={() => rejectFlexiClaim(c.id)}>Reverse</Button>}
                  </span>
                ) },
              ]}
              mobileCard={(c) => (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-2"><span className="font-semibold text-ink">{c.employeeName}</span><StatusChip status={c.status} extra={c.autoApproved && c.status === 'APPROVED' ? ' (auto)' : ''} /></div>
                  <span className="text-[13px] text-muted tabular-nums">{c.claimNumber} · {c.categoryName} · {sgd(c.claimAmount)}</span>
                  <span className="flex gap-1">
                    {c.status === 'PENDING' && (<>
                      <Button variant="ghost" size="sm" onClick={() => approveFlexiClaim(c.id, c.claimAmount)}>Approve</Button>
                      <Button variant="ghost" size="sm" onClick={() => rejectFlexiClaim(c.id)}>Reject</Button>
                    </>)}
                    {c.status === 'APPROVED' && <Button variant="ghost" size="sm" onClick={() => rejectFlexiClaim(c.id)}>Reverse</Button>}
                  </span>
                </div>
              )}
            />
          )}

          {flexiSubTab === 'config' && (
            <div className="flex flex-col gap-3">
              <p className="text-[13px] text-muted">Configure annual wallet amounts and auto-approve thresholds by employment grade.</p>
              <DataTable<FlexiWalletConfig>
                aria-label="Flexi wallet config"
                rows={flexiConfigs}
                rowKey={(cfg) => cfg.grade}
                empty="No grades configured yet."
                columns={[
                  { key: 'grade', label: 'Grade', render: (cfg) => <span className="font-semibold text-ink">{cfg.grade}</span> },
                  { key: 'annual', label: 'Annual amount', numeric: true, align: 'right', render: (cfg) => sgd(cfg.annualAmount) },
                  { key: 'auto', label: 'Auto-approve ≤', numeric: true, align: 'right', render: (cfg) => sgd(cfg.autoApproveThreshold) },
                  { key: 'src', label: 'Source', render: (cfg) => <Chip label={cfg.isDefault ? 'Default' : 'Custom'} cls={cfg.isDefault ? 'bg-pill text-muted' : 'bg-tint text-accent'} /> },
                  { key: 'action', label: '', width: '90px', align: 'right', render: (cfg) => (
                    <Button variant="ghost" size="sm" onClick={async () => {
                      const amtStr = window.prompt(`Annual amount for ${cfg.grade} (SGD):`, String(cfg.annualAmount));
                      if (!amtStr) return;
                      const thrStr = window.prompt(`Auto-approve threshold for ${cfg.grade} (SGD, 0 = disabled):`, String(cfg.autoApproveThreshold));
                      if (thrStr === null) return;
                      const res = await apiFetchRaw('/benefits/flexi-config', {
                        method: 'PUT', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ grade: cfg.grade, annualAmount: parseFloat(amtStr) || 0, autoApproveThreshold: parseFloat(thrStr) || 0 }),
                      });
                      if (res.ok) loadData();
                      else alert((await res.json()).error || 'Failed');
                    }}>Edit</Button>
                  ) },
                ]}
                mobileCard={(cfg) => (
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex flex-col"><span className="font-semibold text-ink">{cfg.grade}</span><span className="text-[13px] text-muted tabular-nums">{sgd(cfg.annualAmount)} · auto ≤ {sgd(cfg.autoApproveThreshold)}</span></span>
                    <Chip label={cfg.isDefault ? 'Default' : 'Custom'} cls={cfg.isDefault ? 'bg-pill text-muted' : 'bg-tint text-accent'} />
                  </div>
                )}
              />
            </div>
          )}

          {flexiSubTab === 'yearend' && (
            <div className="flex flex-col gap-5">
              <Card className="border-highlight">
                <p className="text-[15.5px] font-bold text-ink">Year-end processing — {flexiYear}</p>
                <p className="text-[13px] text-muted mt-1">
                  This marks all active wallets for {flexiYear} as expired and either encashes remaining balances via payroll or forfeits them. This action is irreversible.
                </p>
              </Card>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={loadYearEndPreview}>Preview</Button>
                <Button variant="danger" onClick={() => runFlexiYearEnd(false)}>Forfeit unused balances</Button>
                <Button onClick={() => runFlexiYearEnd(true)}>Encash to payroll</Button>
              </div>
              {flexiYearEndPreview && (
                <Card className="gap-4">
                  <h3 className="text-[15.5px] font-bold text-ink">Preview — {flexiYearEndPreview.year}</h3>
                  <div className="grid grid-cols-3 gap-4">
                    <div><p className="text-[12.5px] font-semibold text-muted">Active wallets</p><p className="text-2xl font-extrabold text-ink tabular-nums mt-1">{flexiYearEndPreview.totalWallets}</p></div>
                    <div><p className="text-[12.5px] font-semibold text-muted">Total credited</p><p className="text-2xl font-extrabold text-ink tabular-nums mt-1">{sgd(flexiYearEndPreview.totalCredited)}</p></div>
                    <div><p className="text-[12.5px] font-semibold text-muted">Total remaining</p><p className="text-2xl font-extrabold text-accent tabular-nums mt-1">{sgd(flexiYearEndPreview.totalRemaining)}</p></div>
                  </div>
                  {flexiYearEndPreview.byGrade && Object.keys(flexiYearEndPreview.byGrade).length > 0 && (
                    <div>
                      <p className="text-[12.5px] font-semibold text-muted mb-2">By grade</p>
                      <div className="flex flex-col">
                        {Object.entries(flexiYearEndPreview.byGrade).map(([grade, data]: [string, any]) => (
                          <div key={grade} className="flex items-center justify-between py-1.5 border-b border-rule last:border-0 text-[13px]">
                            <span className="font-semibold text-ink">{grade}</span>
                            <span className="text-muted tabular-nums">{data.count} wallets · {sgd(data.remaining)} remaining</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </Card>
              )}
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      {showPlanModal && (
        <PlanModal plan={editingPlan}
          onClose={() => { setShowPlanModal(false); setEditingPlan(null); }}
          onSuccess={() => { setShowPlanModal(false); setEditingPlan(null); loadData(); }} />
      )}
      {showPeriodModal && (
        <PeriodModal plans={plans} onClose={() => setShowPeriodModal(false)} onSuccess={() => { setShowPeriodModal(false); loadData(); }} />
      )}
      {showFlexiCreditModal && (
        <FlexiWalletCreditModal year={flexiYear} onClose={() => setShowFlexiCreditModal(false)} onSuccess={() => { setShowFlexiCreditModal(false); loadData(); }} />
      )}
    </div>
  );
}

// ─── Plan Modal ──────────────────────────────────────────────────────────────
function PlanModal({ plan, onClose, onSuccess }: { plan: Plan | null; onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState({
    code:             plan?.code             || '',
    name:             plan?.name             || '',
    type:             plan?.type             || 'GHS',
    insurerName:      plan?.insurerName      || '',
    coverageAmount:   plan?.coverageAmount   || 0,
    premiumEmployer:  plan?.premiumEmployer  || 0,
    premiumEmployee:  plan?.premiumEmployee  || 0,
    premiumDependent: plan?.premiumDependent || 0,
    bikTaxable:       plan?.bikTaxable       || false,
    coversDependents: plan?.coversDependents || false,
    minTenureMonths:  plan?.minTenureMonths  || 0,
    effectiveFrom:    plan?.effectiveFrom    ? new Date(plan.effectiveFrom).toISOString().slice(0,10) : new Date().toISOString().slice(0,10),
    description:      plan?.description      || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  async function save() {
    setSaving(true); setError('');
    const url = plan ? `/benefits/plans/${plan.id}` : '/benefits/plans';
    const method = plan ? 'PUT' : 'POST';
    const res = await apiFetchRaw(url, {
      method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
    });
    if (res.ok) onSuccess();
    else { const e = await res.json(); setError(e.error || 'Failed'); }
    setSaving(false);
  }

  return (
    <Modal open size="lg" onClose={onClose} title={plan ? 'Edit plan' : 'New plan'}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button disabled={saving} onClick={save}>{saving ? 'Saving…' : (plan ? 'Update' : 'Create')}</Button>
      </>}
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Code" required><Input value={form.code} onChange={e => setForm({...form, code: e.target.value})} disabled={!!plan} /></Field>
          <Field label="Type" required>
            <Select value={form.type} onChange={e => setForm({...form, type: e.target.value})}>
              {PLAN_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Plan name" required><Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} /></Field>
        <Field label="Insurer name" required><Input value={form.insurerName} onChange={e => setForm({...form, insurerName: e.target.value})} /></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Coverage amount (SGD)" required><Input type="number" value={form.coverageAmount} onChange={e => setForm({...form, coverageAmount: parseFloat(e.target.value) || 0})} /></Field>
          <Field label="Min tenure (months)"><Input type="number" value={form.minTenureMonths} onChange={e => setForm({...form, minTenureMonths: parseInt(e.target.value) || 0})} /></Field>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <Field label="Employer premium/yr" required><Input type="number" value={form.premiumEmployer} onChange={e => setForm({...form, premiumEmployer: parseFloat(e.target.value) || 0})} /></Field>
          <Field label="Employee co-pay/yr"><Input type="number" value={form.premiumEmployee} onChange={e => setForm({...form, premiumEmployee: parseFloat(e.target.value) || 0})} /></Field>
          <Field label="Per-dependent/yr"><Input type="number" value={form.premiumDependent} onChange={e => setForm({...form, premiumDependent: parseFloat(e.target.value) || 0})} /></Field>
        </div>
        <Field label="Effective from" required><Input type="date" value={form.effectiveFrom} onChange={e => setForm({...form, effectiveFrom: e.target.value})} /></Field>
        <Field label="Description"><Textarea rows={2} value={form.description} onChange={e => setForm({...form, description: e.target.value})} /></Field>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" className="w-4 h-4 accent-accent" checked={form.bikTaxable} onChange={e => setForm({...form, bikTaxable: e.target.checked})} /> BIK taxable (IR8A)</label>
          <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" className="w-4 h-4 accent-accent" checked={form.coversDependents} onChange={e => setForm({...form, coversDependents: e.target.checked})} /> Covers dependents</label>
        </div>
        {error && <p className="text-sm text-danger font-semibold">{error}</p>}
      </div>
    </Modal>
  );
}

// ─── Enroll Modal ────────────────────────────────────────────────────────────
function EnrollModal({ plan, dependents, onClose, onSuccess }: {
  plan: Plan; dependents: Dependent[]; onClose: () => void; onSuccess: () => void;
}) {
  const [selectedDeps, setSelectedDeps] = useState<string[]>([]);
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function enroll() {
    setSaving(true); setError('');
    const res = await apiFetchRaw('/benefits/enrollments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        planId: plan.id,
        effectiveFrom,
        dependentIds: plan.coversDependents ? selectedDeps : [],
        enrollmentSource: 'OPEN_ENROLLMENT',
      }),
    });
    if (res.ok) onSuccess();
    else { const e = await res.json(); setError(e.error || 'Failed'); }
    setSaving(false);
  }

  return (
    <Modal open onClose={onClose} title={`Enrol in ${plan.name}`} caption={`${plan.insurerName} · Coverage ${sgd(plan.coverageAmount)}`}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button disabled={saving} onClick={enroll}>{saving ? 'Enrolling…' : 'Confirm enrollment'}</Button>
      </>}
    >
      <div className="flex flex-col gap-4">
        <Field label="Effective from" required><Input type="date" value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)} /></Field>
        {plan.coversDependents && dependents.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-semibold text-muted">Include dependents ({sgd(plan.premiumDependent)}/yr each)</span>
            <div className="flex flex-col gap-1 max-h-40 overflow-y-auto rounded-control border border-rule p-2">
              {dependents.map(d => (
                <label key={d.id} className="flex items-center gap-2 p-2 rounded-control hover:bg-page cursor-pointer">
                  <input type="checkbox" className="w-4 h-4 accent-accent" checked={selectedDeps.includes(d.id)} onChange={e => {
                    setSelectedDeps(prev => e.target.checked ? [...prev, d.id] : prev.filter(id => id !== d.id));
                  }} />
                  <span className="text-sm text-ink">{d.fullName}</span>
                  <span className="text-[13px] text-muted">({sentence(d.relationship)})</span>
                </label>
              ))}
            </div>
          </div>
        )}
        {error && <p className="text-sm text-danger font-semibold">{error}</p>}
      </div>
    </Modal>
  );
}

// ─── Dependent Modal ─────────────────────────────────────────────────────────
function DependentModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState({
    fullName: '', relationship: 'SPOUSE', dateOfBirth: '', nric: '', gender: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setSaving(true); setError('');
    const res = await apiFetchRaw('/benefits/dependents', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
    });
    if (res.ok) onSuccess();
    else { const e = await res.json(); setError(e.error || 'Failed'); }
    setSaving(false);
  }

  return (
    <Modal open onClose={onClose} title="Add dependent"
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Add dependent'}</Button>
      </>}
    >
      <div className="flex flex-col gap-4">
        <Field label="Full name" required><Input value={form.fullName} onChange={e => setForm({...form, fullName: e.target.value})} /></Field>
        <Field label="Relationship" required>
          <Select value={form.relationship} onChange={e => setForm({...form, relationship: e.target.value})}>
            <option value="SPOUSE">Spouse</option><option value="CHILD">Child</option><option value="PARENT">Parent</option><option value="OTHER">Other</option>
          </Select>
        </Field>
        <Field label="Date of birth" required><Input type="date" value={form.dateOfBirth} onChange={e => setForm({...form, dateOfBirth: e.target.value})} /></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="NRIC last 4 digits"><Input value={form.nric} maxLength={9} onChange={e => setForm({...form, nric: e.target.value})} /></Field>
          <Field label="Gender">
            <Select value={form.gender} onChange={e => setForm({...form, gender: e.target.value})}>
              <option value="">—</option><option value="M">Male</option><option value="F">Female</option>
            </Select>
          </Field>
        </div>
        {error && <p className="text-sm text-danger font-semibold">{error}</p>}
      </div>
    </Modal>
  );
}

// ─── Claim Modal ─────────────────────────────────────────────────────────────
function ClaimModal({ enrollment, dependents, onClose, onSuccess }: {
  enrollment: Enrollment; dependents: Dependent[]; onClose: () => void; onSuccess: () => void;
}) {
  const enrolledDeps = dependents.filter(d => enrollment.enrolledDependentIds.includes(d.id));
  const [form, setForm] = useState({
    patientDependentId: '',
    treatmentDate: new Date().toISOString().slice(0, 10),
    treatmentType: 'outpatient',
    hospitalProvider: '',
    diagnosis: '',
    claimAmount: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setSaving(true); setError('');
    const patientName = form.patientDependentId
      ? enrolledDeps.find(d => d.id === form.patientDependentId)?.fullName
      : enrollment.employeeName;
    const res = await apiFetchRaw('/benefits/claims', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enrollmentId: enrollment.id,
        patientDependentId: form.patientDependentId || null,
        patientName,
        treatmentDate: form.treatmentDate,
        treatmentType: form.treatmentType,
        hospitalProvider: form.hospitalProvider || null,
        diagnosis: form.diagnosis || null,
        claimAmount: parseFloat(form.claimAmount),
      }),
    });
    if (res.ok) onSuccess();
    else { const e = await res.json(); setError(e.error || 'Failed'); }
    setSaving(false);
  }

  return (
    <Modal open onClose={onClose} title="Submit claim" caption={`${enrollment.plan?.name} · Coverage ${sgd(enrollment.plan?.coverageAmount)}`}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button disabled={saving || !form.claimAmount} onClick={save}>{saving ? 'Submitting…' : 'Submit claim'}</Button>
      </>}
    >
      <div className="flex flex-col gap-4">
        {enrolledDeps.length > 0 && (
          <Field label="Patient">
            <Select value={form.patientDependentId} onChange={e => setForm({...form, patientDependentId: e.target.value})}>
              <option value="">Myself ({enrollment.employeeName})</option>
              {enrolledDeps.map(d => <option key={d.id} value={d.id}>{d.fullName} ({sentence(d.relationship)})</option>)}
            </Select>
          </Field>
        )}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Treatment date" required><Input type="date" value={form.treatmentDate} onChange={e => setForm({...form, treatmentDate: e.target.value})} /></Field>
          <Field label="Treatment type" required>
            <Select value={form.treatmentType} onChange={e => setForm({...form, treatmentType: e.target.value})}>
              <option value="outpatient">Outpatient</option><option value="hospitalisation">Hospitalisation</option><option value="surgery">Surgery</option><option value="dental">Dental</option><option value="specialist">Specialist consult</option>
            </Select>
          </Field>
        </div>
        <Field label="Hospital / clinic"><Input value={form.hospitalProvider} onChange={e => setForm({...form, hospitalProvider: e.target.value})} /></Field>
        <Field label="Diagnosis (optional)"><Input value={form.diagnosis} onChange={e => setForm({...form, diagnosis: e.target.value})} /></Field>
        <Field label="Claim amount (SGD)" required><Input type="number" step="0.01" value={form.claimAmount} onChange={e => setForm({...form, claimAmount: e.target.value})} /></Field>
        {error && <p className="text-sm text-danger font-semibold">{error}</p>}
      </div>
    </Modal>
  );
}

// ─── Period Modal ────────────────────────────────────────────────────────────
function PeriodModal({ plans, onClose, onSuccess }: { plans: Plan[]; onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState({
    name: `${new Date().getFullYear()} Open Enrollment`,
    year: new Date().getFullYear(),
    startDate: new Date().toISOString().slice(0, 10),
    endDate: '',
    planIds: [] as string[],
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setSaving(true); setError('');
    const res = await apiFetchRaw('/benefits/open-enrollment', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    if (res.ok) onSuccess();
    else { const e = await res.json(); setError(e.error || 'Failed'); }
    setSaving(false);
  }

  return (
    <Modal open onClose={onClose} title="New open enrollment period"
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button disabled={saving} onClick={save}>{saving ? 'Creating…' : 'Create period'}</Button>
      </>}
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Name" required><Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} /></Field>
          <Field label="Year" required><Input type="number" value={form.year} onChange={e => setForm({...form, year: parseInt(e.target.value) || 0})} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Start date" required><Input type="date" value={form.startDate} onChange={e => setForm({...form, startDate: e.target.value})} /></Field>
          <Field label="End date" required><Input type="date" value={form.endDate} onChange={e => setForm({...form, endDate: e.target.value})} /></Field>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-semibold text-muted">Available plans</span>
          <div className="flex flex-col gap-1 max-h-40 overflow-y-auto rounded-control border border-rule p-2">
            <label className="flex items-center gap-2 p-2 rounded-control hover:bg-page cursor-pointer">
              <input type="checkbox" className="w-4 h-4 accent-accent" checked={form.planIds.length === 0} onChange={() => setForm({...form, planIds: []})} />
              <span className="text-sm text-ink">All active plans</span>
            </label>
            {plans.filter(p => p.isActive).map(p => (
              <label key={p.id} className="flex items-center gap-2 p-2 rounded-control hover:bg-page cursor-pointer">
                <input type="checkbox" className="w-4 h-4 accent-accent" checked={form.planIds.includes(p.id)} onChange={e => {
                  setForm(prev => ({ ...prev, planIds: e.target.checked ? [...prev.planIds, p.id] : prev.planIds.filter(id => id !== p.id) }));
                }} />
                <span className="text-sm text-ink">{p.name}</span>
                <span className="text-[13px] text-muted">({p.type})</span>
              </label>
            ))}
          </div>
        </div>
        {error && <p className="text-sm text-danger font-semibold">{error}</p>}
      </div>
    </Modal>
  );
}

// ─── FlexiClaimModal ─────────────────────────────────────────────────────────
function FlexiClaimModal({ wallet, categories, onClose, onSuccess }: {
  wallet: FlexiWallet; categories: FlexiCategory[]; onClose: () => void; onSuccess: () => void;
}) {
  const [form, setForm] = useState({
    categoryId:  categories[0]?.id || '',
    receiptDate: new Date().toISOString().slice(0, 10),
    vendor:      '',
    description: '',
    claimAmount: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  async function save() {
    if (!form.claimAmount || parseFloat(form.claimAmount) <= 0) { setError('Enter a valid amount'); return; }
    setSaving(true); setError('');
    const res = await apiFetchRaw('/benefits/flexi-claims', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletId:    wallet.id,
        categoryId:  form.categoryId,
        receiptDate: form.receiptDate,
        vendor:      form.vendor || null,
        description: form.description,
        claimAmount: parseFloat(form.claimAmount),
      }),
    });
    if (res.ok) onSuccess();
    else { const e = await res.json(); setError(e.error || 'Failed to submit'); }
    setSaving(false);
  }

  const selectedCat = categories.find(c => c.id === form.categoryId);

  return (
    <Modal open onClose={onClose} title="Submit flexi claim" caption={`Wallet ${wallet.year} · ${sgd(wallet.creditedAmount)} credited`}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button disabled={saving || !form.description.trim() || !form.claimAmount} onClick={save}>{saving ? 'Submitting…' : 'Submit claim'}</Button>
      </>}
    >
      <div className="flex flex-col gap-4">
        <Field label="Category" required help={selectedCat?.description ?? undefined}>
          <Select value={form.categoryId} onChange={e => setForm({...form, categoryId: e.target.value})}>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Receipt date" required><Input type="date" value={form.receiptDate} onChange={e => setForm({...form, receiptDate: e.target.value})} /></Field>
          <Field label="Amount (SGD)" required><Input type="number" step="0.01" min="0.01" value={form.claimAmount} onChange={e => setForm({...form, claimAmount: e.target.value})} /></Field>
        </div>
        <Field label="Vendor / provider"><Input value={form.vendor} placeholder="e.g. Fitness First, NTUC Health" onChange={e => setForm({...form, vendor: e.target.value})} /></Field>
        <Field label="Description" required><Textarea rows={2} value={form.description} placeholder="Briefly describe the expense" onChange={e => setForm({...form, description: e.target.value})} /></Field>
        {selectedCat?.requiresReceipt && <p className="text-[13px] text-ink font-semibold">Receipt required — keep originals for audit.</p>}
        {error && <p className="text-sm text-danger font-semibold">{error}</p>}
      </div>
    </Modal>
  );
}

// ─── FlexiWalletCreditModal ───────────────────────────────────────────────────
function FlexiWalletCreditModal({ year, onClose, onSuccess }: {
  year: number; onClose: () => void; onSuccess: () => void;
}) {
  const [form, setForm] = useState({
    employeeId:    '',
    employeeName:  '',
    employeeGrade: '',
    creditedAmount: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  async function save() {
    if (!form.employeeId.trim() || !form.creditedAmount) { setError('Employee ID and amount are required'); return; }
    setSaving(true); setError('');
    const res = await apiFetchRaw('/benefits/flexi-wallets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employeeId:    form.employeeId.trim(),
        employeeName:  form.employeeName.trim() || form.employeeId.trim(),
        employeeGrade: form.employeeGrade.trim() || null,
        year,
        creditedAmount: parseFloat(form.creditedAmount),
      }),
    });
    if (res.ok) onSuccess();
    else { const e = await res.json(); setError(e.error || 'Failed'); }
    setSaving(false);
  }

  return (
    <Modal open onClose={onClose} title={`Credit flexi wallet — ${year}`} caption="Creates or updates an employee's wallet for this year."
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button disabled={saving} onClick={save}>{saving ? 'Crediting…' : 'Credit wallet'}</Button>
      </>}
    >
      <div className="flex flex-col gap-4">
        <Field label="Employee ID" required><Input value={form.employeeId} onChange={e => setForm({...form, employeeId: e.target.value})} /></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Employee name"><Input value={form.employeeName} onChange={e => setForm({...form, employeeName: e.target.value})} /></Field>
          <Field label="Grade">
            <Select value={form.employeeGrade} onChange={e => setForm({...form, employeeGrade: e.target.value})}>
              <option value="">—</option>
              {['STAFF','EXEC','MGR','DIR','VP','C_SUITE'].map(g => <option key={g} value={g}>{g}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Credited amount (SGD)" required><Input type="number" step="0.01" min="1" value={form.creditedAmount} onChange={e => setForm({...form, creditedAmount: e.target.value})} /></Field>
        {error && <p className="text-sm text-danger font-semibold">{error}</p>}
      </div>
    </Modal>
  );
}
