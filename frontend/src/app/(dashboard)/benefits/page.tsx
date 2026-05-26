'use client';

import React, { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

interface Plan {
  id: string;
  code: string;
  name: string;
  type: string;
  insurerName: string;
  coverageAmount: number;
  premiumEmployer: number;
  premiumEmployee: number;
  premiumDependent: number;
  bikTaxable: boolean;
  eligibilityGrades: string[];
  minTenureMonths: number;
  coversDependents: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
  description: string | null;
}

interface Enrollment {
  id: string;
  employeeId: string;
  employeeName: string;
  planId: string;
  status: 'ACTIVE' | 'CANCELLED' | 'EXPIRED';
  effectiveFrom: string;
  effectiveTo: string | null;
  cancelReason: string | null;
  enrolledDependentIds: string[];
  annualPremiumEmployer: number;
  annualPremiumEmployee: number;
  plan?: Plan;
}

interface Dependent {
  id: string;
  fullName: string;
  relationship: 'SPOUSE' | 'CHILD' | 'PARENT' | 'OTHER';
  dateOfBirth: string;
  nric: string | null;
  isActive: boolean;
}

interface Claim {
  id: string;
  claimNumber: string;
  enrollmentId: string;
  planId: string;
  employeeId: string;
  employeeName: string;
  patientName: string;
  treatmentDate: string;
  treatmentType: string;
  hospitalProvider: string | null;
  diagnosis: string | null;
  claimAmount: number;
  approvedAmount: number | null;
  status: string;
  rejectedReason: string | null;
  submittedAt: string;
}

interface OpenEnrollmentPeriod {
  id: string;
  name: string;
  year: number;
  startDate: string;
  endDate: string;
  status: string;
  planIds: string[];
}

// ── BEN-002: Flexi-Benefits Wallet types ─────────────────────────────────────
interface FlexiCategory {
  id: string;
  code: string;
  name: string;
  description: string | null;
  requiresReceipt: boolean;
  isActive: boolean;
}

interface FlexiWallet {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeGrade: string | null;
  year: number;
  creditedAmount: number;
  usedAmount: number;
  forfeitedAmount: number;
  encashedAmount: number;
  status: 'ACTIVE' | 'EXPIRED';
  expiresAt: string;
}

interface FlexiBalance {
  credited: number;
  used: number;
  pending: number;
  remaining: number;
  encashed: number;
  forfeited: number;
}

interface FlexiClaim {
  id: string;
  claimNumber: string;
  walletId: string;
  employeeId: string;
  employeeName: string;
  categoryCode: string;
  categoryName: string;
  receiptDate: string;
  vendor: string | null;
  description: string;
  claimAmount: number;
  approvedAmount: number | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  autoApproved: boolean;
  rejectedReason: string | null;
  submittedAt: string;
}

interface FlexiWalletConfig {
  id: string | null;
  grade: string;
  annualAmount: number;
  autoApproveThreshold: number;
  isActive: boolean;
  isDefault: boolean;
}

const CATEGORY_COLORS: Record<string, string> = {
  GYM:                    'bg-emerald-50 text-emerald-700',
  DENTAL:                 'bg-cyan-50 text-cyan-700',
  OPTICAL:                'bg-blue-50 text-blue-700',
  HEALTH_SCREENING:       'bg-rose-50 text-rose-700',
  WELLNESS:               'bg-violet-50 text-violet-700',
  PROFESSIONAL_DEVELOPMENT:'bg-amber-50 text-amber-700',
};

const HR_ROLES = ['HR_ADMIN', 'HR_MANAGER', 'SUPER_ADMIN'];
const PLAN_TYPES = ['GHS', 'GTL', 'PA', 'DENTAL', 'OUTPATIENT', 'OTHER'];

const TYPE_LABELS: Record<string, string> = {
  GHS: 'Hospitalisation & Surgical', GTL: 'Term Life', PA: 'Personal Accident',
  DENTAL: 'Dental', OUTPATIENT: 'Outpatient', OTHER: 'Other',
};

const TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  GHS:        { bg: 'bg-rose-50',    text: 'text-rose-700'    },
  GTL:        { bg: 'bg-violet-50',  text: 'text-violet-700'  },
  PA:         { bg: 'bg-amber-50',   text: 'text-amber-700'   },
  DENTAL:     { bg: 'bg-cyan-50',    text: 'text-cyan-700'    },
  OUTPATIENT: { bg: 'bg-emerald-50', text: 'text-emerald-700' },
  OTHER:      { bg: 'bg-slate-100',  text: 'text-slate-700'   },
};

const STATUS_COLORS: Record<string, string> = {
  ACTIVE:      'bg-emerald-100 text-emerald-700',
  CANCELLED:   'bg-slate-100 text-slate-600',
  EXPIRED:     'bg-amber-100 text-amber-700',
  SUBMITTED:   'bg-blue-100 text-blue-700',
  UNDER_REVIEW:'bg-indigo-100 text-indigo-700',
  APPROVED:    'bg-emerald-100 text-emerald-700',
  REJECTED:    'bg-red-100 text-red-700',
  REIMBURSED:  'bg-teal-100 text-teal-700',
};

export default function BenefitsPage() {
  const { user } = useAuth();
  const role = (user?.role || '').toUpperCase();
  const isHr = HR_ROLES.includes(role);

  // ─── HR Tabs ─────────────────────────────────────────────────────────────────
  const [hrTab, setHrTab] = useState<'plans'|'enrollments'|'claims'|'openEnroll'|'flexi'>('plans');
  const [flexiSubTab, setFlexiSubTab] = useState<'wallets'|'claims'|'config'|'yearend'>('wallets');

  // ─── Data state ─────────────────────────────────────────────────────────────
  const [plans, setPlans]             = useState<Plan[]>([]);
  const [myEnrollments, setMyEnrollments] = useState<Enrollment[]>([]);
  const [allEnrollments, setAllEnrollments] = useState<Enrollment[]>([]);
  const [myDependents, setMyDependents]   = useState<Dependent[]>([]);
  const [myClaims, setMyClaims]           = useState<Claim[]>([]);
  const [allClaims, setAllClaims]         = useState<Claim[]>([]);
  const [openPeriod, setOpenPeriod]       = useState<OpenEnrollmentPeriod | null>(null);
  const [allPeriods, setAllPeriods]       = useState<OpenEnrollmentPeriod[]>([]);
  const [dashboard, setDashboard]         = useState<any>(null);
  const [loading, setLoading]             = useState(true);

  // ─── Flexi Benefits state (BEN-002) ─────────────────────────────────────────
  const [flexiWallet, setFlexiWallet]         = useState<FlexiWallet | null>(null);
  const [flexiBalance, setFlexiBalance]       = useState<FlexiBalance | null>(null);
  const [myFlexiClaims, setMyFlexiClaims]     = useState<FlexiClaim[]>([]);
  const [flexiCategories, setFlexiCategories] = useState<FlexiCategory[]>([]);
  const [allFlexiWallets, setAllFlexiWallets] = useState<FlexiWallet[]>([]);
  const [allFlexiClaims, setAllFlexiClaims]   = useState<FlexiClaim[]>([]);
  const [flexiDashboard, setFlexiDashboard]   = useState<any>(null);
  const [flexiConfigs, setFlexiConfigs]       = useState<FlexiWalletConfig[]>([]);
  const [flexiYearEndPreview, setFlexiYearEndPreview] = useState<any>(null);
  const [flexiYear, setFlexiYear]             = useState(new Date().getFullYear());

  // ─── Modal state ───────────────────────────────────────────────────────────
  const [showPlanModal, setShowPlanModal]       = useState(false);
  const [editingPlan, setEditingPlan]           = useState<Plan | null>(null);
  const [showEnrollModal, setShowEnrollModal]   = useState(false);
  const [enrollPlan, setEnrollPlan]             = useState<Plan | null>(null);
  const [showDependentModal, setShowDependentModal] = useState(false);
  const [showClaimModal, setShowClaimModal]     = useState(false);
  const [claimEnrollment, setClaimEnrollment]   = useState<Enrollment | null>(null);
  const [showPeriodModal, setShowPeriodModal]   = useState(false);
  const [showFlexiClaimModal, setShowFlexiClaimModal] = useState(false);
  const [showFlexiCreditModal, setShowFlexiCreditModal] = useState(false);

  // ─── Load data ──────────────────────────────────────────────────────────────
  async function loadData() {
    setLoading(true);
    try {
      const [plansRes, periodRes, catRes] = await Promise.all([
        apiFetch('/benefits/plans').then(r => r.json()),
        apiFetch('/benefits/open-enrollment/current').then(r => r.json()),
        apiFetch('/benefits/flexi-categories').then(r => r.json()),
      ]);
      setPlans(plansRes.plans || []);
      setOpenPeriod(periodRes.active ? periodRes.period : null);
      setFlexiCategories(catRes.categories || []);

      if (isHr) {
        const [enrRes, claimsRes, periodsRes, dashRes, fWalletsRes, fClaimsRes, fDashRes, fCfgRes] = await Promise.all([
          apiFetch('/benefits/enrollments').then(r => r.json()),
          apiFetch('/benefits/claims').then(r => r.json()),
          apiFetch('/benefits/open-enrollment').then(r => r.json()),
          apiFetch('/benefits/dashboard').then(r => r.json()),
          apiFetch(`/benefits/flexi-wallets?year=${flexiYear}`).then(r => r.json()),
          apiFetch(`/benefits/flexi-claims?year=${flexiYear}`).then(r => r.json()),
          apiFetch(`/benefits/flexi-dashboard?year=${flexiYear}`).then(r => r.json()),
          apiFetch('/benefits/flexi-config').then(r => r.json()),
        ]);
        setAllEnrollments(enrRes.enrollments || []);
        setAllClaims(claimsRes.claims || []);
        setAllPeriods(periodsRes.periods || []);
        setDashboard(dashRes);
        setAllFlexiWallets(fWalletsRes.wallets || []);
        setAllFlexiClaims(fClaimsRes.claims || []);
        setFlexiDashboard(fDashRes);
        setFlexiConfigs(fCfgRes.configs || []);
      } else {
        const [myEnrRes, depRes, myClaimRes, myWalletRes, myFlexiClaimRes] = await Promise.all([
          apiFetch('/benefits/enrollments/me').then(r => r.json()),
          apiFetch('/benefits/dependents').then(r => r.json()),
          apiFetch('/benefits/claims').then(r => r.json()),
          apiFetch(`/benefits/flexi-wallets/me?year=${new Date().getFullYear()}`).then(r => r.json()),
          apiFetch('/benefits/flexi-claims').then(r => r.json()),
        ]);
        setMyEnrollments(myEnrRes.enrollments || []);
        setMyDependents(depRes.dependents || []);
        setMyClaims(myClaimRes.claims || []);
        setFlexiWallet(myWalletRes.wallet || null);
        setFlexiBalance(myWalletRes.balance || null);
        setMyFlexiClaims(myFlexiClaimRes.claims || []);
      }
    } catch (err) {
      console.error('[benefits] load failed', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (user) loadData(); }, [user, isHr]);

  // ─── Actions ────────────────────────────────────────────────────────────────
  async function cancelEnrollment(id: string) {
    const reason = window.prompt('Reason for cancelling?');
    if (!reason || !reason.trim()) return;
    const res = await apiFetch(`/benefits/enrollments/${id}/cancel`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cancelReason: reason.trim() }),
    });
    if (res.ok) loadData();
    else {
      const e = await res.json();
      alert(e.error || 'Failed to cancel');
    }
  }

  async function approveClaim(id: string) {
    const amtStr = window.prompt('Approved amount (SGD, leave blank for full):', '');
    const body: any = {};
    if (amtStr && amtStr.trim()) {
      const amt = parseFloat(amtStr);
      if (isNaN(amt) || amt < 0) { alert('Invalid amount'); return; }
      body.approvedAmount = amt;
    }
    const res = await apiFetch(`/benefits/claims/${id}/approve`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) loadData();
    else alert((await res.json()).error || 'Failed');
  }

  async function rejectClaim(id: string) {
    const reason = window.prompt('Reason for rejection?');
    if (!reason || !reason.trim()) return;
    const res = await apiFetch(`/benefits/claims/${id}/reject`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rejectedReason: reason.trim() }),
    });
    if (res.ok) loadData();
    else alert((await res.json()).error || 'Failed');
  }

  async function reimburseClaim(id: string) {
    if (!confirm('Mark this claim as reimbursed?')) return;
    const res = await apiFetch(`/benefits/claims/${id}/reimburse`, { method: 'PUT' });
    if (res.ok) loadData();
    else alert((await res.json()).error || 'Failed');
  }

  async function deleteDependent(id: string) {
    if (!confirm('Remove this dependent?')) return;
    const res = await apiFetch(`/benefits/dependents/${id}`, { method: 'DELETE' });
    if (res.ok) loadData();
    else alert((await res.json()).error || 'Failed');
  }

  async function closePeriod(id: string) {
    if (!confirm('Close this open enrollment window?')) return;
    const res = await apiFetch(`/benefits/open-enrollment/${id}/close`, { method: 'PUT' });
    if (res.ok) loadData();
    else alert((await res.json()).error || 'Failed');
  }

  async function approveFlexiClaim(id: string, claimAmount: number) {
    const amtStr = window.prompt(`Approve amount (SGD, leave blank for full SGD ${claimAmount}):`, '');
    const body: any = {};
    if (amtStr !== null && amtStr.trim()) {
      const amt = parseFloat(amtStr);
      if (isNaN(amt) || amt < 0) { alert('Invalid amount'); return; }
      body.approvedAmount = amt;
    }
    const res = await apiFetch(`/benefits/flexi-claims/${id}/approve`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (res.ok) loadData();
    else alert((await res.json()).error || 'Failed to approve');
  }

  async function rejectFlexiClaim(id: string) {
    const reason = window.prompt('Reason for rejection?');
    if (!reason || !reason.trim()) return;
    const res = await apiFetch(`/benefits/flexi-claims/${id}/reject`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rejectedReason: reason.trim() }),
    });
    if (res.ok) loadData();
    else alert((await res.json()).error || 'Failed to reject');
  }

  async function cancelFlexiClaim(id: string) {
    if (!confirm('Cancel this claim?')) return;
    const res = await apiFetch(`/benefits/flexi-claims/${id}/cancel`, { method: 'PUT' });
    if (res.ok) loadData();
    else alert((await res.json()).error || 'Failed to cancel');
  }

  async function runFlexiYearEnd(encash: boolean) {
    const label = encash ? 'encash (add to payroll)' : 'forfeit (lose unused balance)';
    if (!confirm(`Year-end ${flexiYear}: ${label} all unused flexi wallet balances?`)) return;
    const res = await apiFetch('/benefits/flexi-wallets/year-end', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ year: flexiYear, encash }),
    });
    if (res.ok) { const d = await res.json(); alert(`Done. Processed ${d.processed} wallets.`); loadData(); }
    else alert((await res.json()).error || 'Failed');
  }

  async function loadYearEndPreview() {
    try {
      const res = await apiFetch(`/benefits/flexi-wallets/year-end-preview?year=${flexiYear}`);
      if (res.ok) setFlexiYearEndPreview(await res.json());
    } catch (_) { /* ignore */ }
  }

  async function seedFlexiCategories() {
    const res = await apiFetch('/benefits/flexi-categories/seed', { method: 'POST' });
    if (res.ok) { const d = await res.json(); alert(`Seeded ${d.created} categories (${d.skipped} skipped).`); loadData(); }
    else alert('Failed to seed categories');
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
      </div>
    );
  }

  // ─── EMPLOYEE VIEW ──────────────────────────────────────────────────────────
  if (!isHr) {
    const activeEnrollments = myEnrollments.filter(e => e.status === 'ACTIVE');
    const availablePlansForSelfEnroll = openPeriod
      ? plans.filter(p => p.isActive && (openPeriod.planIds.length === 0 || openPeriod.planIds.includes(p.id)) && !activeEnrollments.some(e => e.planId === p.id))
      : [];

    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-black text-slate-900">My Benefits</h1>
            <p className="text-xs text-slate-500 mt-0.5 uppercase tracking-widest font-bold">Insurance · Claims · Dependents</p>
          </div>
          {openPeriod && (
            <div className="px-4 py-2 bg-indigo-50 border border-indigo-200 rounded-xl">
              <p className="text-xs font-black text-indigo-700 uppercase tracking-widest">◑ Open Enrollment Active</p>
              <p className="text-[10px] text-indigo-600 font-bold mt-0.5">
                {openPeriod.name} · ends {new Date(openPeriod.endDate).toLocaleDateString('en-SG')}
              </p>
            </div>
          )}
        </div>

        {/* Active Enrollments */}
        <section>
          <h2 className="text-sm font-black text-slate-700 uppercase tracking-widest mb-3">Active Plans ({activeEnrollments.length})</h2>
          {activeEnrollments.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 lg:p-8 text-center">
              <p className="text-sm text-slate-500">You have no active benefit plans.</p>
              {openPeriod && availablePlansForSelfEnroll.length > 0 && (
                <p className="text-xs text-indigo-600 mt-2 font-bold">Enroll in a plan below ↓</p>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {activeEnrollments.map(e => {
                const tc = TYPE_COLORS[e.plan?.type || 'OTHER'];
                return (
                  <div key={e.id} className="bg-white rounded-2xl border border-slate-200 p-5 hover:shadow-md transition-all">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h3 className="text-base font-black text-slate-900">{e.plan?.name}</h3>
                        <p className="text-xs text-slate-500 mt-0.5 font-bold">{e.plan?.insurerName}</p>
                      </div>
                      <span className={`px-2.5 py-1 text-[10px] font-black uppercase tracking-widest rounded-full ${tc.bg} ${tc.text}`}>
                        {TYPE_LABELS[e.plan?.type || 'OTHER']}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <p className="text-slate-400 font-bold uppercase tracking-wider text-[9px]">Coverage</p>
                        <p className="text-slate-700 font-black mt-0.5">SGD {(e.plan?.coverageAmount || 0).toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-slate-400 font-bold uppercase tracking-wider text-[9px]">Effective</p>
                        <p className="text-slate-700 font-black mt-0.5">{new Date(e.effectiveFrom).toLocaleDateString('en-SG')}</p>
                      </div>
                      <div>
                        <p className="text-slate-400 font-bold uppercase tracking-wider text-[9px]">Dependents</p>
                        <p className="text-slate-700 font-black mt-0.5">{e.enrolledDependentIds.length}</p>
                      </div>
                      <div>
                        <p className="text-slate-400 font-bold uppercase tracking-wider text-[9px]">Your Co-Pay</p>
                        <p className="text-slate-700 font-black mt-0.5">
                          {e.annualPremiumEmployee > 0 ? `SGD ${e.annualPremiumEmployee}/yr` : 'Employer-paid'}
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 flex gap-2">
                      <button
                        onClick={() => { setClaimEnrollment(e); setShowClaimModal(true); }}
                        className="flex-1 py-2 px-3 bg-indigo-600 text-white text-xs font-black uppercase tracking-widest rounded-lg hover:bg-indigo-700 transition-all"
                      >
                        Submit Claim
                      </button>
                      <button
                        onClick={() => cancelEnrollment(e.id)}
                        className="py-2 px-3 border border-slate-200 text-slate-600 text-xs font-black uppercase tracking-widest rounded-lg hover:bg-slate-50 transition-all"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Available plans (only during open enrollment) */}
        {openPeriod && availablePlansForSelfEnroll.length > 0 && (
          <section>
            <h2 className="text-sm font-black text-slate-700 uppercase tracking-widest mb-3">Available During Open Enrollment</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {availablePlansForSelfEnroll.map(p => {
                const tc = TYPE_COLORS[p.type];
                return (
                  <div key={p.id} className="bg-white rounded-2xl border-2 border-indigo-100 p-5 hover:shadow-md transition-all">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h3 className="text-base font-black text-slate-900">{p.name}</h3>
                        <p className="text-xs text-slate-500 mt-0.5 font-bold">{p.insurerName}</p>
                      </div>
                      <span className={`px-2.5 py-1 text-[10px] font-black uppercase tracking-widest rounded-full ${tc.bg} ${tc.text}`}>
                        {TYPE_LABELS[p.type]}
                      </span>
                    </div>
                    {p.description && <p className="text-xs text-slate-500 mb-3">{p.description}</p>}
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <p className="text-slate-400 font-bold uppercase tracking-wider text-[9px]">Coverage</p>
                        <p className="text-slate-700 font-black mt-0.5">SGD {p.coverageAmount.toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-slate-400 font-bold uppercase tracking-wider text-[9px]">Your Co-Pay</p>
                        <p className="text-slate-700 font-black mt-0.5">{p.premiumEmployee > 0 ? `SGD ${p.premiumEmployee}/yr` : 'Free'}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => { setEnrollPlan(p); setShowEnrollModal(true); }}
                      className="mt-4 w-full py-2 bg-indigo-600 text-white text-xs font-black uppercase tracking-widest rounded-lg hover:bg-indigo-700 transition-all"
                    >
                      Enroll
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Dependents */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-black text-slate-700 uppercase tracking-widest">My Dependents ({myDependents.length})</h2>
            <button
              onClick={() => setShowDependentModal(true)}
              className="text-xs font-bold text-indigo-600 hover:text-indigo-700 border border-indigo-200 rounded-lg px-3 py-1.5 hover:bg-indigo-50 transition-all"
            >
              + Add Dependent
            </button>
          </div>
          {myDependents.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 text-center text-sm text-slate-500">
              No dependents on file.
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-[10px] font-black text-slate-500 uppercase tracking-widest">Name</th>
                    <th className="px-4 py-2.5 text-left text-[10px] font-black text-slate-500 uppercase tracking-widest">Relationship</th>
                    <th className="px-4 py-2.5 text-left text-[10px] font-black text-slate-500 uppercase tracking-widest">DOB</th>
                    <th className="px-4 py-2.5 text-right"></th>
                  </tr>
                </thead>
                <tbody>
                  {myDependents.map(d => (
                    <tr key={d.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50">
                      <td className="px-4 py-2.5 text-sm font-bold text-slate-700">{d.fullName}</td>
                      <td className="px-4 py-2.5 text-sm text-slate-600">{d.relationship}</td>
                      <td className="px-4 py-2.5 text-sm text-slate-600">{new Date(d.dateOfBirth).toLocaleDateString('en-SG')}</td>
                      <td className="px-4 py-2.5 text-right">
                        <button onClick={() => deleteDependent(d.id)} className="text-xs font-bold text-red-500 hover:text-red-600">Remove</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* My Claims */}
        <section>
          <h2 className="text-sm font-black text-slate-700 uppercase tracking-widest mb-3">My Claims ({myClaims.length})</h2>
          {myClaims.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 text-center text-sm text-slate-500">
              No claims submitted yet.
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-[10px] font-black text-slate-500 uppercase tracking-widest">Claim #</th>
                    <th className="px-4 py-2.5 text-left text-[10px] font-black text-slate-500 uppercase tracking-widest">Treatment</th>
                    <th className="px-4 py-2.5 text-left text-[10px] font-black text-slate-500 uppercase tracking-widest">Date</th>
                    <th className="px-4 py-2.5 text-right text-[10px] font-black text-slate-500 uppercase tracking-widest">Amount</th>
                    <th className="px-4 py-2.5 text-left text-[10px] font-black text-slate-500 uppercase tracking-widest">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {myClaims.map(c => (
                    <tr key={c.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-4 py-2.5 text-sm font-mono font-bold text-slate-700">{c.claimNumber}</td>
                      <td className="px-4 py-2.5 text-sm text-slate-600">{c.treatmentType}</td>
                      <td className="px-4 py-2.5 text-sm text-slate-600">{new Date(c.treatmentDate).toLocaleDateString('en-SG')}</td>
                      <td className="px-4 py-2.5 text-sm text-slate-700 font-bold text-right">SGD {c.claimAmount}</td>
                      <td className="px-4 py-2.5">
                        <span className={`px-2 py-1 text-[10px] font-black uppercase tracking-widest rounded-full ${STATUS_COLORS[c.status] || 'bg-slate-100 text-slate-600'}`}>
                          {c.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Flexi Benefits Wallet */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-black text-slate-700 uppercase tracking-widest">My Flexi Benefits Wallet</h2>
            {flexiWallet && flexiCategories.length > 0 && (
              <button
                onClick={() => setShowFlexiClaimModal(true)}
                className="text-xs font-bold text-indigo-600 hover:text-indigo-700 border border-indigo-200 rounded-lg px-3 py-1.5 hover:bg-indigo-50 transition-all"
              >
                + Submit Claim
              </button>
            )}
          </div>

          {!flexiWallet ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 text-center text-sm text-slate-500">
              No flexi benefits wallet for {new Date().getFullYear()}. Contact HR to have one credited.
            </div>
          ) : (
            <div className="space-y-4">
              {/* Balance Card */}
              <div className={`bg-white rounded-2xl border-2 p-5 ${flexiWallet.status === 'EXPIRED' ? 'border-slate-200 opacity-70' : 'border-indigo-100'}`}>
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Flexi Benefits Wallet {flexiWallet.year}</p>
                    <p className={`text-3xl font-black mt-1 ${flexiWallet.status === 'EXPIRED' ? 'text-slate-400' : 'text-indigo-700'}`}>
                      SGD {flexiBalance?.remaining?.toLocaleString() || 0}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5 font-bold">remaining balance</p>
                  </div>
                  <span className={`px-2.5 py-1 text-[10px] font-black uppercase tracking-widest rounded-full ${flexiWallet.status === 'EXPIRED' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                    {flexiWallet.status}
                  </span>
                </div>
                {/* Progress bar */}
                {flexiBalance && flexiBalance.credited > 0 && (
                  <div className="mb-4">
                    <div className="flex justify-between text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
                      <span>Used</span>
                      <span>{Math.round((flexiBalance.used / flexiBalance.credited) * 100)}%</span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-indigo-500 rounded-full transition-all"
                        style={{ width: `${Math.min(100, (flexiBalance.used / flexiBalance.credited) * 100)}%` }}
                      />
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-3 gap-3 text-xs">
                  <div>
                    <p className="text-slate-400 font-bold uppercase tracking-wider text-[9px]">Credited</p>
                    <p className="text-slate-700 font-black mt-0.5">SGD {flexiBalance?.credited}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 font-bold uppercase tracking-wider text-[9px]">Approved Used</p>
                    <p className="text-slate-700 font-black mt-0.5">SGD {flexiBalance?.used}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 font-bold uppercase tracking-wider text-[9px]">Pending</p>
                    <p className="text-amber-600 font-black mt-0.5">SGD {flexiBalance?.pending || 0}</p>
                  </div>
                </div>
                <p className="text-[10px] text-slate-400 font-bold mt-3">
                  Expires: {new Date(flexiWallet.expiresAt).toLocaleDateString('en-SG', { day: 'numeric', month: 'long', year: 'numeric' })}
                </p>
              </div>

              {/* Eligible Categories */}
              {flexiCategories.length > 0 && (
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Eligible Spend Categories</p>
                  <div className="flex flex-wrap gap-2">
                    {flexiCategories.map(cat => (
                      <span key={cat.id} className={`px-3 py-1 text-xs font-black uppercase tracking-widest rounded-full ${CATEGORY_COLORS[cat.code] || 'bg-slate-100 text-slate-600'}`}>
                        {cat.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {/* My Flexi Claims */}
        {myFlexiClaims.length > 0 && (
          <section>
            <h2 className="text-sm font-black text-slate-700 uppercase tracking-widest mb-3">My Flexi Claims ({myFlexiClaims.length})</h2>
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-[10px] font-black text-slate-500 uppercase tracking-widest">Claim #</th>
                    <th className="px-4 py-2.5 text-left text-[10px] font-black text-slate-500 uppercase tracking-widest">Category</th>
                    <th className="px-4 py-2.5 text-left text-[10px] font-black text-slate-500 uppercase tracking-widest">Description</th>
                    <th className="px-4 py-2.5 text-right text-[10px] font-black text-slate-500 uppercase tracking-widest">Amount</th>
                    <th className="px-4 py-2.5 text-left text-[10px] font-black text-slate-500 uppercase tracking-widest">Status</th>
                    <th className="px-4 py-2.5 text-right"></th>
                  </tr>
                </thead>
                <tbody>
                  {myFlexiClaims.map(c => (
                    <tr key={c.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-4 py-2.5 text-xs font-mono font-bold text-slate-700">{c.claimNumber}</td>
                      <td className="px-4 py-2.5">
                        <span className={`px-2 py-1 text-[10px] font-black uppercase tracking-widest rounded-full ${CATEGORY_COLORS[c.categoryCode] || 'bg-slate-100 text-slate-600'}`}>
                          {c.categoryName}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-sm text-slate-600 max-w-[180px] truncate">{c.description}</td>
                      <td className="px-4 py-2.5 text-sm font-bold text-right">SGD {c.claimAmount}</td>
                      <td className="px-4 py-2.5">
                        <span className={`px-2 py-1 text-[10px] font-black uppercase tracking-widest rounded-full ${STATUS_COLORS[c.status] || 'bg-slate-100 text-slate-600'}`}>
                          {c.status}{c.autoApproved && c.status === 'APPROVED' ? ' (auto)' : ''}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {c.status === 'PENDING' && (
                          <button onClick={() => cancelFlexiClaim(c.id)} className="text-xs font-bold text-red-500 hover:text-red-600">Cancel</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {showEnrollModal && enrollPlan && (
          <EnrollModal
            plan={enrollPlan}
            dependents={myDependents}
            onClose={() => { setShowEnrollModal(false); setEnrollPlan(null); }}
            onSuccess={() => { setShowEnrollModal(false); setEnrollPlan(null); loadData(); }}
          />
        )}
        {showDependentModal && (
          <DependentModal
            onClose={() => setShowDependentModal(false)}
            onSuccess={() => { setShowDependentModal(false); loadData(); }}
          />
        )}
        {showClaimModal && claimEnrollment && (
          <ClaimModal
            enrollment={claimEnrollment}
            dependents={myDependents}
            onClose={() => { setShowClaimModal(false); setClaimEnrollment(null); }}
            onSuccess={() => { setShowClaimModal(false); setClaimEnrollment(null); loadData(); }}
          />
        )}
        {showFlexiClaimModal && flexiWallet && (
          <FlexiClaimModal
            wallet={flexiWallet}
            categories={flexiCategories}
            onClose={() => setShowFlexiClaimModal(false)}
            onSuccess={() => { setShowFlexiClaimModal(false); loadData(); }}
          />
        )}
      </div>
    );
  }

  // ─── HR VIEW ─────────────────────────────────────────────────────────────────
  const stats = dashboard?.enrollmentSummary || {};
  const claimsStats = dashboard?.claimsSummary || {};

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-slate-900">Benefits Administration</h1>
          <p className="text-xs text-slate-500 mt-0.5 uppercase tracking-widest font-bold">Group Insurance · Claims · Open Enrollment</p>
        </div>
        {openPeriod && (
          <div className="px-4 py-2 bg-emerald-50 border border-emerald-200 rounded-xl">
            <p className="text-xs font-black text-emerald-700 uppercase tracking-widest">● Open Enrollment Active</p>
            <p className="text-[10px] text-emerald-600 font-bold mt-0.5">
              {openPeriod.name} · ends {new Date(openPeriod.endDate).toLocaleDateString('en-SG')}
            </p>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Active Enrollments"  value={stats.active || 0}             accent="emerald" />
        <StatCard label="Open Claims"         value={(claimsStats.byStatus?.SUBMITTED || 0) + (claimsStats.byStatus?.UNDER_REVIEW || 0)} accent="blue" />
        <StatCard label="Reimbursed YTD"      value={`SGD ${(claimsStats.totalReimbursed || 0).toLocaleString()}`} accent="teal" />
        <StatCard label="Employer Premium/yr" value={`SGD ${(stats.totalEmployerPremium || 0).toLocaleString()}`}  accent="violet" />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200 flex-wrap">
        {([
          ['plans',       'Plans',           plans.length],
          ['enrollments', 'Enrollments',     allEnrollments.length],
          ['claims',      'Claims',          allClaims.length],
          ['openEnroll',  'Open Enrollment', allPeriods.length],
          ['flexi',       'Flexi Benefits',  allFlexiWallets.length],
        ] as const).map(([id, label, n]) => (
          <button
            key={id}
            onClick={() => setHrTab(id)}
            className={`px-4 py-2.5 text-xs font-black uppercase tracking-widest transition-all border-b-2 -mb-px ${
              hrTab === id ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {label} <span className="ml-1 opacity-60">{n}</span>
          </button>
        ))}
      </div>

      {/* Plans Tab */}
      {hrTab === 'plans' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={() => { setEditingPlan(null); setShowPlanModal(true); }}
              className="px-4 py-2 bg-indigo-600 text-white text-xs font-black uppercase tracking-widest rounded-xl hover:bg-indigo-700 transition-all"
            >
              + New Plan
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {plans.map(p => {
              const tc = TYPE_COLORS[p.type];
              const active = allEnrollments.filter(e => e.planId === p.id && e.status === 'ACTIVE').length;
              return (
                <div key={p.id} className={`bg-white rounded-2xl border p-5 ${p.isActive ? 'border-slate-200' : 'border-slate-100 opacity-60'}`}>
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-black text-slate-900">{p.name}</h3>
                        {!p.isActive && <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Inactive</span>}
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5 font-bold font-mono">{p.code} · {p.insurerName}</p>
                    </div>
                    <span className={`px-2.5 py-1 text-[10px] font-black uppercase tracking-widest rounded-full ${tc.bg} ${tc.text}`}>
                      {TYPE_LABELS[p.type]}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
                    <div>
                      <p className="text-slate-400 font-bold uppercase tracking-wider text-[9px]">Coverage</p>
                      <p className="text-slate-700 font-black mt-0.5">SGD {p.coverageAmount.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-slate-400 font-bold uppercase tracking-wider text-[9px]">Employer/yr</p>
                      <p className="text-slate-700 font-black mt-0.5">SGD {p.premiumEmployer}</p>
                    </div>
                    <div>
                      <p className="text-slate-400 font-bold uppercase tracking-wider text-[9px]">Active Enrolled</p>
                      <p className="text-slate-700 font-black mt-0.5">{active}</p>
                    </div>
                  </div>
                  <div className="mt-4 flex gap-2">
                    <button
                      onClick={() => { setEditingPlan(p); setShowPlanModal(true); }}
                      className="flex-1 py-1.5 text-xs font-bold text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-all"
                    >
                      Edit
                    </button>
                    {p.isActive && (
                      <button
                        onClick={() => {
                          if (confirm(`Deactivate ${p.name}?`)) {
                            apiFetch(`/benefits/plans/${p.id}`, { method: 'DELETE' })
                              .then(r => r.ok ? loadData() : r.json().then((e: any) => alert(e.error || 'Failed')));
                          }
                        }}
                        className="py-1.5 px-3 text-xs font-bold text-red-500 border border-red-200 rounded-lg hover:bg-red-50 transition-all"
                      >
                        Deactivate
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Enrollments Tab */}
      {hrTab === 'enrollments' && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-widest">Employee</th>
                <th className="px-4 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-widest">Plan</th>
                <th className="px-4 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-widest">Source</th>
                <th className="px-4 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-widest">Effective From</th>
                <th className="px-4 py-3 text-right text-[10px] font-black text-slate-500 uppercase tracking-widest">Premium/yr</th>
                <th className="px-4 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-widest">Status</th>
              </tr>
            </thead>
            <tbody>
              {allEnrollments.map(e => (
                <tr key={e.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3 text-sm font-bold text-slate-700">{e.employeeName}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{e.plan?.name || e.planId}</td>
                  <td className="px-4 py-3 text-xs text-slate-500 uppercase tracking-wider font-bold">{(e as any).enrollmentSource}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{new Date(e.effectiveFrom).toLocaleDateString('en-SG')}</td>
                  <td className="px-4 py-3 text-sm text-slate-700 font-bold text-right">SGD {e.annualPremiumEmployer}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 text-[10px] font-black uppercase tracking-widest rounded-full ${STATUS_COLORS[e.status] || 'bg-slate-100 text-slate-600'}`}>
                      {e.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Claims Tab */}
      {hrTab === 'claims' && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-widest">Claim #</th>
                <th className="px-4 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-widest">Employee</th>
                <th className="px-4 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-widest">Treatment</th>
                <th className="px-4 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-widest">Date</th>
                <th className="px-4 py-3 text-right text-[10px] font-black text-slate-500 uppercase tracking-widest">Claim</th>
                <th className="px-4 py-3 text-right text-[10px] font-black text-slate-500 uppercase tracking-widest">Approved</th>
                <th className="px-4 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-widest">Status</th>
                <th className="px-4 py-3 text-right"></th>
              </tr>
            </thead>
            <tbody>
              {allClaims.map(c => (
                <tr key={c.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3 text-xs font-mono font-bold text-slate-700">{c.claimNumber}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{c.employeeName}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{c.treatmentType}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{new Date(c.treatmentDate).toLocaleDateString('en-SG')}</td>
                  <td className="px-4 py-3 text-sm font-bold text-right">SGD {c.claimAmount}</td>
                  <td className="px-4 py-3 text-sm font-bold text-right">{c.approvedAmount !== null ? `SGD ${c.approvedAmount}` : '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 text-[10px] font-black uppercase tracking-widest rounded-full ${STATUS_COLORS[c.status] || 'bg-slate-100 text-slate-600'}`}>
                      {c.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right space-x-1">
                    {(c.status === 'SUBMITTED' || c.status === 'UNDER_REVIEW') && (
                      <>
                        <button onClick={() => approveClaim(c.id)} className="text-xs font-bold text-emerald-600 hover:text-emerald-700 px-2">Approve</button>
                        <button onClick={() => rejectClaim(c.id)}  className="text-xs font-bold text-red-500 hover:text-red-600 px-2">Reject</button>
                      </>
                    )}
                    {c.status === 'APPROVED' && (
                      <button onClick={() => reimburseClaim(c.id)} className="text-xs font-bold text-teal-600 hover:text-teal-700 px-2">Mark Reimbursed</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Open Enrollment Tab */}
      {hrTab === 'openEnroll' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={() => setShowPeriodModal(true)}
              className="px-4 py-2 bg-indigo-600 text-white text-xs font-black uppercase tracking-widest rounded-xl hover:bg-indigo-700 transition-all"
            >
              + New Period
            </button>
          </div>
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-widest">Name</th>
                  <th className="px-4 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-widest">Year</th>
                  <th className="px-4 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-widest">Window</th>
                  <th className="px-4 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-widest">Plans</th>
                  <th className="px-4 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-widest">Status</th>
                  <th className="px-4 py-3 text-right"></th>
                </tr>
              </thead>
              <tbody>
                {allPeriods.map(p => (
                  <tr key={p.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-3 text-sm font-bold text-slate-700">{p.name}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">{p.year}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">
                      {new Date(p.startDate).toLocaleDateString('en-SG')} → {new Date(p.endDate).toLocaleDateString('en-SG')}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">{p.planIds.length || 'All'}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 text-[10px] font-black uppercase tracking-widest rounded-full ${
                        p.status === 'ACTIVE'    ? 'bg-emerald-100 text-emerald-700' :
                        p.status === 'SCHEDULED' ? 'bg-blue-100 text-blue-700' :
                                                    'bg-slate-100 text-slate-600'
                      }`}>
                        {p.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {p.status !== 'CLOSED' && (
                        <button onClick={() => closePeriod(p.id)} className="text-xs font-bold text-slate-500 hover:text-slate-700">Close</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Flexi Benefits Tab */}
      {hrTab === 'flexi' && (
        <div className="space-y-4">
          {/* Sub-tab strip */}
          <div className="flex gap-1 border-b border-slate-200">
            {([
              ['wallets', 'Wallets',  allFlexiWallets.length],
              ['claims',  'Claims',   allFlexiClaims.length],
              ['config',  'Config',   flexiConfigs.length],
              ['yearend', 'Year-End', 0],
            ] as const).map(([id, label, n]) => (
              <button
                key={id}
                onClick={() => setFlexiSubTab(id)}
                className={`px-4 py-2 text-xs font-black uppercase tracking-widest transition-all border-b-2 -mb-px ${
                  flexiSubTab === id ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                {label}{n > 0 && <span className="ml-1 opacity-60">{n}</span>}
              </button>
            ))}
          </div>

          {/* Year selector + seed */}
          <div className="flex items-center gap-3">
            <label className="text-xs font-black text-slate-500 uppercase tracking-widest">Year</label>
            <select
              value={flexiYear}
              onChange={e => setFlexiYear(parseInt(e.target.value))}
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm font-bold text-slate-700 outline-none focus:border-indigo-400"
            >
              {[flexiYear - 1, flexiYear, flexiYear + 1].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <button
              onClick={() => loadData()}
              className="px-3 py-1.5 text-xs font-black uppercase tracking-widest border border-slate-200 rounded-lg hover:bg-slate-50 transition-all"
            >
              Refresh
            </button>
            <button
              onClick={seedFlexiCategories}
              className="px-3 py-1.5 text-xs font-black uppercase tracking-widest border border-indigo-200 text-indigo-600 rounded-lg hover:bg-indigo-50 transition-all"
            >
              Seed Categories
            </button>
          </div>

          {/* ── Wallets sub-tab ── */}
          {flexiSubTab === 'wallets' && (
            <div className="space-y-4">
              {/* Dashboard stats */}
              {flexiDashboard && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <StatCard label="Active Wallets"   value={flexiDashboard.activeWallets || 0}                                          accent="emerald" />
                  <StatCard label="Total Credited"   value={`SGD ${(flexiDashboard.totalCredited || 0).toLocaleString()}`}              accent="blue" />
                  <StatCard label="Total Used"       value={`SGD ${(flexiDashboard.totalUsed || 0).toLocaleString()}`}                  accent="violet" />
                  <StatCard label="Total Remaining"  value={`SGD ${(flexiDashboard.totalRemaining || 0).toLocaleString()}`}             accent="teal" />
                </div>
              )}
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowFlexiCreditModal(true)}
                  className="px-4 py-2 bg-indigo-600 text-white text-xs font-black uppercase tracking-widest rounded-xl hover:bg-indigo-700 transition-all"
                >
                  + Credit Wallet
                </button>
                <button
                  onClick={async () => {
                    if (!confirm('Credit flexi wallets for ALL active employees based on their grade? This uses the batch endpoint.')) return;
                    const res = await apiFetch('/benefits/flexi-wallets/credit-batch', {
                      method: 'POST', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ year: flexiYear }),
                    });
                    if (res.ok) { const d = await res.json(); alert(`Credited ${d.credited} wallets (${d.skipped} skipped).`); loadData(); }
                    else alert((await res.json()).error || 'Failed');
                  }}
                  className="px-4 py-2 border border-emerald-200 text-emerald-700 text-xs font-black uppercase tracking-widest rounded-xl hover:bg-emerald-50 transition-all"
                >
                  Batch Credit All
                </button>
              </div>
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <table className="w-full">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-widest">Employee</th>
                      <th className="px-4 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-widest">Grade</th>
                      <th className="px-4 py-3 text-right text-[10px] font-black text-slate-500 uppercase tracking-widest">Credited</th>
                      <th className="px-4 py-3 text-right text-[10px] font-black text-slate-500 uppercase tracking-widest">Used</th>
                      <th className="px-4 py-3 text-right text-[10px] font-black text-slate-500 uppercase tracking-widest">Remaining</th>
                      <th className="px-4 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-widest">Expires</th>
                      <th className="px-4 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-widest">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allFlexiWallets.length === 0 ? (
                      <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-400">No wallets for {flexiYear}.</td></tr>
                    ) : allFlexiWallets.map(w => (
                      <tr key={w.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50">
                        <td className="px-4 py-3 text-sm font-bold text-slate-700">{w.employeeName}</td>
                        <td className="px-4 py-3 text-xs font-black text-slate-500">{w.employeeGrade || '—'}</td>
                        <td className="px-4 py-3 text-sm text-right">SGD {w.creditedAmount.toLocaleString()}</td>
                        <td className="px-4 py-3 text-sm text-right">SGD {w.usedAmount.toLocaleString()}</td>
                        <td className="px-4 py-3 text-sm font-bold text-right text-indigo-700">
                          SGD {(w.creditedAmount - w.usedAmount).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500">
                          {new Date(w.expiresAt).toLocaleDateString('en-SG')}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-1 text-[10px] font-black uppercase tracking-widest rounded-full ${
                            w.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                          }`}>{w.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Claims sub-tab ── */}
          {flexiSubTab === 'claims' && (
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-widest">Claim #</th>
                    <th className="px-4 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-widest">Employee</th>
                    <th className="px-4 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-widest">Category</th>
                    <th className="px-4 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-widest">Description</th>
                    <th className="px-4 py-3 text-right text-[10px] font-black text-slate-500 uppercase tracking-widest">Amount</th>
                    <th className="px-4 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-widest">Status</th>
                    <th className="px-4 py-3 text-right"></th>
                  </tr>
                </thead>
                <tbody>
                  {allFlexiClaims.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-400">No claims for {flexiYear}.</td></tr>
                  ) : allFlexiClaims.map(c => (
                    <tr key={c.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50">
                      <td className="px-4 py-3 text-xs font-mono font-bold text-slate-700">{c.claimNumber}</td>
                      <td className="px-4 py-3 text-sm text-slate-600">{c.employeeName}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 text-[10px] font-black uppercase tracking-widest rounded-full ${CATEGORY_COLORS[c.categoryCode] || 'bg-slate-100 text-slate-600'}`}>
                          {c.categoryName}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600 max-w-[150px] truncate">{c.description}</td>
                      <td className="px-4 py-3 text-sm font-bold text-right">SGD {c.claimAmount}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 text-[10px] font-black uppercase tracking-widest rounded-full ${STATUS_COLORS[c.status] || 'bg-slate-100 text-slate-600'}`}>
                          {c.status}{c.autoApproved && c.status === 'APPROVED' ? ' (auto)' : ''}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right space-x-1">
                        {c.status === 'PENDING' && (
                          <>
                            <button onClick={() => approveFlexiClaim(c.id, c.claimAmount)} className="text-xs font-bold text-emerald-600 hover:text-emerald-700 px-2">Approve</button>
                            <button onClick={() => rejectFlexiClaim(c.id)}                  className="text-xs font-bold text-red-500 hover:text-red-600 px-2">Reject</button>
                          </>
                        )}
                        {c.status === 'APPROVED' && (
                          <button onClick={() => rejectFlexiClaim(c.id)} className="text-xs font-bold text-red-500 hover:text-red-600 px-2">Reverse</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Config sub-tab ── */}
          {flexiSubTab === 'config' && (
            <div className="space-y-4">
              <p className="text-xs text-slate-500">Configure annual wallet amounts and auto-approve thresholds by employment grade.</p>
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <table className="w-full">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-widest">Grade</th>
                      <th className="px-4 py-3 text-right text-[10px] font-black text-slate-500 uppercase tracking-widest">Annual Amount (SGD)</th>
                      <th className="px-4 py-3 text-right text-[10px] font-black text-slate-500 uppercase tracking-widest">Auto-Approve ≤ (SGD)</th>
                      <th className="px-4 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-widest">Source</th>
                      <th className="px-4 py-3 text-right"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {flexiConfigs.map(cfg => (
                      <tr key={cfg.grade} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50">
                        <td className="px-4 py-3 text-sm font-black text-slate-700">{cfg.grade}</td>
                        <td className="px-4 py-3 text-sm font-bold text-right">{cfg.annualAmount.toLocaleString()}</td>
                        <td className="px-4 py-3 text-sm text-right">{cfg.autoApproveThreshold}</td>
                        <td className="px-4 py-3">
                          {cfg.isDefault
                            ? <span className="px-2 py-1 text-[10px] font-black uppercase tracking-widest rounded-full bg-slate-100 text-slate-500">Default</span>
                            : <span className="px-2 py-1 text-[10px] font-black uppercase tracking-widest rounded-full bg-indigo-50 text-indigo-700">Custom</span>}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={async () => {
                              const amtStr = window.prompt(`Annual amount for ${cfg.grade} (SGD):`, String(cfg.annualAmount));
                              if (!amtStr) return;
                              const thrStr = window.prompt(`Auto-approve threshold for ${cfg.grade} (SGD, 0 = disabled):`, String(cfg.autoApproveThreshold));
                              if (thrStr === null) return;
                              const res = await apiFetch('/benefits/flexi-config', {
                                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ grade: cfg.grade, annualAmount: parseFloat(amtStr) || 0, autoApproveThreshold: parseFloat(thrStr) || 0 }),
                              });
                              if (res.ok) loadData();
                              else alert((await res.json()).error || 'Failed');
                            }}
                            className="text-xs font-bold text-indigo-600 hover:text-indigo-700"
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Year-End sub-tab ── */}
          {flexiSubTab === 'yearend' && (
            <div className="space-y-6">
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
                <p className="text-sm font-black text-amber-800">Year-End Processing — {flexiYear}</p>
                <p className="text-xs text-amber-700 mt-1">
                  This marks all ACTIVE wallets for {flexiYear} as EXPIRED and either encashes remaining balances via payroll or forfeits them. This action is irreversible.
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={loadYearEndPreview}
                  className="px-4 py-2 border border-slate-200 text-slate-700 text-xs font-black uppercase tracking-widest rounded-xl hover:bg-slate-50 transition-all"
                >
                  Preview
                </button>
                <button
                  onClick={() => runFlexiYearEnd(false)}
                  className="px-4 py-2 border border-red-200 text-red-700 text-xs font-black uppercase tracking-widest rounded-xl hover:bg-red-50 transition-all"
                >
                  Forfeit Unused Balances
                </button>
                <button
                  onClick={() => runFlexiYearEnd(true)}
                  className="px-4 py-2 bg-emerald-600 text-white text-xs font-black uppercase tracking-widest rounded-xl hover:bg-emerald-700 transition-all"
                >
                  Encash to Payroll
                </button>
              </div>

              {flexiYearEndPreview && (
                <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
                  <h3 className="text-sm font-black text-slate-800">Preview — {flexiYearEndPreview.year}</h3>
                  <div className="grid grid-cols-3 gap-4 text-xs">
                    <div>
                      <p className="text-slate-400 font-bold uppercase tracking-wider text-[9px]">Active Wallets</p>
                      <p className="text-2xl font-black text-slate-800 mt-1">{flexiYearEndPreview.totalWallets}</p>
                    </div>
                    <div>
                      <p className="text-slate-400 font-bold uppercase tracking-wider text-[9px]">Total Credited</p>
                      <p className="text-2xl font-black text-slate-800 mt-1">SGD {(flexiYearEndPreview.totalCredited || 0).toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-slate-400 font-bold uppercase tracking-wider text-[9px]">Total Remaining</p>
                      <p className="text-2xl font-black text-indigo-700 mt-1">SGD {(flexiYearEndPreview.totalRemaining || 0).toLocaleString()}</p>
                    </div>
                  </div>
                  {flexiYearEndPreview.byGrade && Object.keys(flexiYearEndPreview.byGrade).length > 0 && (
                    <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">By Grade</p>
                      <div className="space-y-1">
                        {Object.entries(flexiYearEndPreview.byGrade).map(([grade, data]: [string, any]) => (
                          <div key={grade} className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0 text-xs">
                            <span className="font-black text-slate-700">{grade}</span>
                            <span className="text-slate-500">{data.count} wallets · SGD {(data.remaining || 0).toLocaleString()} remaining</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      {showPlanModal && (
        <PlanModal
          plan={editingPlan}
          onClose={() => { setShowPlanModal(false); setEditingPlan(null); }}
          onSuccess={() => { setShowPlanModal(false); setEditingPlan(null); loadData(); }}
        />
      )}
      {showPeriodModal && (
        <PeriodModal
          plans={plans}
          onClose={() => setShowPeriodModal(false)}
          onSuccess={() => { setShowPeriodModal(false); loadData(); }}
        />
      )}
      {showFlexiCreditModal && (
        <FlexiWalletCreditModal
          year={flexiYear}
          onClose={() => setShowFlexiCreditModal(false)}
          onSuccess={() => { setShowFlexiCreditModal(false); loadData(); }}
        />
      )}
    </div>
  );
}

// ─── StatCard ────────────────────────────────────────────────────────────────
function StatCard({ label, value, accent }: { label: string; value: string | number; accent: string }) {
  const colorMap: Record<string, string> = {
    emerald: 'text-emerald-700',
    blue:    'text-blue-700',
    teal:    'text-teal-700',
    violet:  'text-violet-700',
  };
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4">
      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{label}</p>
      <p className={`text-2xl font-black ${colorMap[accent] || 'text-slate-700'}`}>{value}</p>
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
    const res = await apiFetch(url, {
      method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
    });
    if (res.ok) onSuccess();
    else { const e = await res.json(); setError(e.error || 'Failed'); }
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl border border-slate-200 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white">
          <h3 className="text-sm font-black text-slate-900">{plan ? 'Edit Plan' : 'New Plan'}</h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 text-lg">×</button>
        </div>
        <div className="p-4 sm:p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Code" required>
              <input value={form.code} onChange={e => setForm({...form, code: e.target.value})} disabled={!!plan} className="input" />
            </Field>
            <Field label="Type" required>
              <select value={form.type} onChange={e => setForm({...form, type: e.target.value})} className="input">
                {PLAN_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Plan Name" required>
            <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="input" />
          </Field>
          <Field label="Insurer Name" required>
            <input value={form.insurerName} onChange={e => setForm({...form, insurerName: e.target.value})} className="input" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Coverage Amount (SGD)" required>
              <input type="number" value={form.coverageAmount} onChange={e => setForm({...form, coverageAmount: parseFloat(e.target.value) || 0})} className="input" />
            </Field>
            <Field label="Min Tenure (months)">
              <input type="number" value={form.minTenureMonths} onChange={e => setForm({...form, minTenureMonths: parseInt(e.target.value) || 0})} className="input" />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Employer Premium/yr" required>
              <input type="number" value={form.premiumEmployer} onChange={e => setForm({...form, premiumEmployer: parseFloat(e.target.value) || 0})} className="input" />
            </Field>
            <Field label="Employee Co-Pay/yr">
              <input type="number" value={form.premiumEmployee} onChange={e => setForm({...form, premiumEmployee: parseFloat(e.target.value) || 0})} className="input" />
            </Field>
            <Field label="Per-Dependent/yr">
              <input type="number" value={form.premiumDependent} onChange={e => setForm({...form, premiumDependent: parseFloat(e.target.value) || 0})} className="input" />
            </Field>
          </div>
          <Field label="Effective From" required>
            <input type="date" value={form.effectiveFrom} onChange={e => setForm({...form, effectiveFrom: e.target.value})} className="input" />
          </Field>
          <Field label="Description">
            <textarea rows={2} value={form.description} onChange={e => setForm({...form, description: e.target.value})} className="input resize-none" />
          </Field>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.bikTaxable} onChange={e => setForm({...form, bikTaxable: e.target.checked})} />
              BIK Taxable (IR8A)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.coversDependents} onChange={e => setForm({...form, coversDependents: e.target.checked})} />
              Covers Dependents
            </label>
          </div>
          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 font-bold">{error}</div>}
          <div className="flex gap-3 pt-2">
            <button onClick={save} disabled={saving} className="flex-1 py-2.5 bg-indigo-600 text-white text-xs font-black uppercase tracking-widest rounded-xl hover:bg-indigo-700 disabled:opacity-50">
              {saving ? 'Saving…' : (plan ? 'Update' : 'Create')}
            </button>
            <button onClick={onClose} className="px-5 py-2.5 border border-slate-200 text-slate-600 text-xs font-black uppercase tracking-widest rounded-xl hover:bg-slate-50">Cancel</button>
          </div>
        </div>
      </div>
      <style jsx>{`
        :global(.input) {
          width: 100%; border: 1px solid rgb(226 232 240); border-radius: 0.75rem;
          padding: 0.6rem 0.9rem; font-size: 0.875rem; outline: none;
          transition: all 0.15s;
        }
        :global(.input:focus) {
          border-color: rgb(99 102 241); box-shadow: 0 0 0 2px rgba(99,102,241,0.15);
        }
        :global(.input:disabled) {
          background: rgb(248 250 252); cursor: not-allowed;
        }
      `}</style>
    </div>
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
    const res = await apiFetch('/benefits/enrollments', {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-slate-200">
        <div className="px-6 py-4 border-b border-slate-100">
          <h3 className="text-sm font-black text-slate-900">Enroll in {plan.name}</h3>
          <p className="text-xs text-slate-500 mt-0.5">{plan.insurerName} · Coverage SGD {plan.coverageAmount.toLocaleString()}</p>
        </div>
        <div className="p-4 sm:p-6 space-y-4">
          <Field label="Effective From" required>
            <input type="date" value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)} className="input" />
          </Field>
          {plan.coversDependents && dependents.length > 0 && (
            <div>
              <p className="text-xs font-black text-slate-700 uppercase tracking-wider mb-2">Include Dependents (SGD {plan.premiumDependent}/yr each)</p>
              <div className="space-y-1 max-h-40 overflow-y-auto border border-slate-200 rounded-xl p-2">
                {dependents.map(d => (
                  <label key={d.id} className="flex items-center gap-2 p-2 hover:bg-slate-50 rounded-lg cursor-pointer">
                    <input type="checkbox" checked={selectedDeps.includes(d.id)} onChange={e => {
                      setSelectedDeps(prev => e.target.checked ? [...prev, d.id] : prev.filter(id => id !== d.id));
                    }} />
                    <span className="text-sm font-medium text-slate-700">{d.fullName}</span>
                    <span className="text-xs text-slate-400">({d.relationship})</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 font-bold">{error}</div>}
          <div className="flex gap-3 pt-2">
            <button onClick={enroll} disabled={saving} className="flex-1 py-2.5 bg-indigo-600 text-white text-xs font-black uppercase tracking-widest rounded-xl hover:bg-indigo-700 disabled:opacity-50">
              {saving ? 'Enrolling…' : 'Confirm Enrollment'}
            </button>
            <button onClick={onClose} className="px-5 py-2.5 border border-slate-200 text-slate-600 text-xs font-black uppercase tracking-widest rounded-xl hover:bg-slate-50">Cancel</button>
          </div>
        </div>
      </div>
    </div>
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
    const res = await apiFetch('/benefits/dependents', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
    });
    if (res.ok) onSuccess();
    else { const e = await res.json(); setError(e.error || 'Failed'); }
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-slate-200">
        <div className="px-6 py-4 border-b border-slate-100">
          <h3 className="text-sm font-black text-slate-900">Add Dependent</h3>
        </div>
        <div className="p-4 sm:p-6 space-y-4">
          <Field label="Full Name" required>
            <input value={form.fullName} onChange={e => setForm({...form, fullName: e.target.value})} className="input" />
          </Field>
          <Field label="Relationship" required>
            <select value={form.relationship} onChange={e => setForm({...form, relationship: e.target.value})} className="input">
              <option value="SPOUSE">Spouse</option>
              <option value="CHILD">Child</option>
              <option value="PARENT">Parent</option>
              <option value="OTHER">Other</option>
            </select>
          </Field>
          <Field label="Date of Birth" required>
            <input type="date" value={form.dateOfBirth} onChange={e => setForm({...form, dateOfBirth: e.target.value})} className="input" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="NRIC last 4 digits">
              <input value={form.nric} maxLength={9} onChange={e => setForm({...form, nric: e.target.value})} className="input" />
            </Field>
            <Field label="Gender">
              <select value={form.gender} onChange={e => setForm({...form, gender: e.target.value})} className="input">
                <option value="">—</option>
                <option value="M">Male</option>
                <option value="F">Female</option>
              </select>
            </Field>
          </div>
          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 font-bold">{error}</div>}
          <div className="flex gap-3 pt-2">
            <button onClick={save} disabled={saving} className="flex-1 py-2.5 bg-indigo-600 text-white text-xs font-black uppercase tracking-widest rounded-xl hover:bg-indigo-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Add Dependent'}
            </button>
            <button onClick={onClose} className="px-5 py-2.5 border border-slate-200 text-slate-600 text-xs font-black uppercase tracking-widest rounded-xl hover:bg-slate-50">Cancel</button>
          </div>
        </div>
      </div>
    </div>
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
    const res = await apiFetch('/benefits/claims', {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg border border-slate-200 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-slate-100 sticky top-0 bg-white">
          <h3 className="text-sm font-black text-slate-900">Submit Claim</h3>
          <p className="text-xs text-slate-500 mt-0.5">{enrollment.plan?.name} · Coverage SGD {enrollment.plan?.coverageAmount.toLocaleString()}</p>
        </div>
        <div className="p-4 sm:p-6 space-y-4">
          {enrolledDeps.length > 0 && (
            <Field label="Patient">
              <select value={form.patientDependentId} onChange={e => setForm({...form, patientDependentId: e.target.value})} className="input">
                <option value="">Myself ({enrollment.employeeName})</option>
                {enrolledDeps.map(d => <option key={d.id} value={d.id}>{d.fullName} ({d.relationship})</option>)}
              </select>
            </Field>
          )}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Treatment Date" required>
              <input type="date" value={form.treatmentDate} onChange={e => setForm({...form, treatmentDate: e.target.value})} className="input" />
            </Field>
            <Field label="Treatment Type" required>
              <select value={form.treatmentType} onChange={e => setForm({...form, treatmentType: e.target.value})} className="input">
                <option value="outpatient">Outpatient</option>
                <option value="hospitalisation">Hospitalisation</option>
                <option value="surgery">Surgery</option>
                <option value="dental">Dental</option>
                <option value="specialist">Specialist Consult</option>
              </select>
            </Field>
          </div>
          <Field label="Hospital / Clinic">
            <input value={form.hospitalProvider} onChange={e => setForm({...form, hospitalProvider: e.target.value})} className="input" />
          </Field>
          <Field label="Diagnosis (optional)">
            <input value={form.diagnosis} onChange={e => setForm({...form, diagnosis: e.target.value})} className="input" />
          </Field>
          <Field label="Claim Amount (SGD)" required>
            <input type="number" step="0.01" value={form.claimAmount} onChange={e => setForm({...form, claimAmount: e.target.value})} className="input" />
          </Field>
          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 font-bold">{error}</div>}
          <div className="flex gap-3 pt-2">
            <button onClick={save} disabled={saving || !form.claimAmount} className="flex-1 py-2.5 bg-indigo-600 text-white text-xs font-black uppercase tracking-widest rounded-xl hover:bg-indigo-700 disabled:opacity-50">
              {saving ? 'Submitting…' : 'Submit Claim'}
            </button>
            <button onClick={onClose} className="px-5 py-2.5 border border-slate-200 text-slate-600 text-xs font-black uppercase tracking-widest rounded-xl hover:bg-slate-50">Cancel</button>
          </div>
        </div>
      </div>
    </div>
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
    const res = await apiFetch('/benefits/open-enrollment', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    if (res.ok) onSuccess();
    else { const e = await res.json(); setError(e.error || 'Failed'); }
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg border border-slate-200 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-slate-100 sticky top-0 bg-white">
          <h3 className="text-sm font-black text-slate-900">New Open Enrollment Period</h3>
        </div>
        <div className="p-4 sm:p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Name" required>
              <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="input" />
            </Field>
            <Field label="Year" required>
              <input type="number" value={form.year} onChange={e => setForm({...form, year: parseInt(e.target.value) || 0})} className="input" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Start Date" required>
              <input type="date" value={form.startDate} onChange={e => setForm({...form, startDate: e.target.value})} className="input" />
            </Field>
            <Field label="End Date" required>
              <input type="date" value={form.endDate} onChange={e => setForm({...form, endDate: e.target.value})} className="input" />
            </Field>
          </div>
          <Field label="Available Plans">
            <div className="space-y-1 max-h-40 overflow-y-auto border border-slate-200 rounded-xl p-2">
              <label className="flex items-center gap-2 p-2 hover:bg-slate-50 rounded-lg cursor-pointer">
                <input type="checkbox" checked={form.planIds.length === 0} onChange={() => setForm({...form, planIds: []})} />
                <span className="text-sm font-medium text-slate-700">All active plans</span>
              </label>
              {plans.filter(p => p.isActive).map(p => (
                <label key={p.id} className="flex items-center gap-2 p-2 hover:bg-slate-50 rounded-lg cursor-pointer">
                  <input type="checkbox" checked={form.planIds.includes(p.id)} onChange={e => {
                    setForm(prev => ({
                      ...prev,
                      planIds: e.target.checked ? [...prev.planIds, p.id] : prev.planIds.filter(id => id !== p.id),
                    }));
                  }} />
                  <span className="text-sm font-medium text-slate-700">{p.name}</span>
                  <span className="text-xs text-slate-400">({p.type})</span>
                </label>
              ))}
            </div>
          </Field>
          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 font-bold">{error}</div>}
          <div className="flex gap-3 pt-2">
            <button onClick={save} disabled={saving} className="flex-1 py-2.5 bg-indigo-600 text-white text-xs font-black uppercase tracking-widest rounded-xl hover:bg-indigo-700 disabled:opacity-50">
              {saving ? 'Creating…' : 'Create Period'}
            </button>
            <button onClick={onClose} className="px-5 py-2.5 border border-slate-200 text-slate-600 text-xs font-black uppercase tracking-widest rounded-xl hover:bg-slate-50">Cancel</button>
          </div>
        </div>
      </div>
    </div>
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
    const res = await apiFetch('/benefits/flexi-claims', {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg border border-slate-200 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-slate-100 sticky top-0 bg-white">
          <h3 className="text-sm font-black text-slate-900">Submit Flexi Claim</h3>
          <p className="text-xs text-slate-500 mt-0.5">Wallet {wallet.year} · SGD {wallet.creditedAmount.toLocaleString()} credited</p>
        </div>
        <div className="p-4 sm:p-6 space-y-4">
          <Field label="Category" required>
            <select value={form.categoryId} onChange={e => setForm({...form, categoryId: e.target.value})} className="input">
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          {selectedCat && (
            <p className="text-xs text-slate-500 -mt-2">{selectedCat.description}</p>
          )}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Receipt Date" required>
              <input type="date" value={form.receiptDate} onChange={e => setForm({...form, receiptDate: e.target.value})} className="input" />
            </Field>
            <Field label="Amount (SGD)" required>
              <input type="number" step="0.01" min="0.01" value={form.claimAmount}
                onChange={e => setForm({...form, claimAmount: e.target.value})} className="input" />
            </Field>
          </div>
          <Field label="Vendor / Provider">
            <input value={form.vendor} placeholder="e.g. Fitness First, NTUC Health"
              onChange={e => setForm({...form, vendor: e.target.value})} className="input" />
          </Field>
          <Field label="Description" required>
            <textarea rows={2} value={form.description} placeholder="Briefly describe the expense"
              onChange={e => setForm({...form, description: e.target.value})} className="input resize-none" />
          </Field>
          {selectedCat?.requiresReceipt && (
            <p className="text-[10px] text-amber-600 font-bold uppercase tracking-widest">Receipt required — keep originals for audit</p>
          )}
          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 font-bold">{error}</div>}
          <div className="flex gap-3 pt-2">
            <button
              onClick={save}
              disabled={saving || !form.description.trim() || !form.claimAmount}
              className="flex-1 py-2.5 bg-indigo-600 text-white text-xs font-black uppercase tracking-widest rounded-xl hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? 'Submitting…' : 'Submit Claim'}
            </button>
            <button onClick={onClose} className="px-5 py-2.5 border border-slate-200 text-slate-600 text-xs font-black uppercase tracking-widest rounded-xl hover:bg-slate-50">Cancel</button>
          </div>
        </div>
      </div>
    </div>
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
    const res = await apiFetch('/benefits/flexi-wallets', {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-slate-200">
        <div className="px-6 py-4 border-b border-slate-100">
          <h3 className="text-sm font-black text-slate-900">Credit Flexi Wallet — {year}</h3>
          <p className="text-xs text-slate-500 mt-0.5">Creates or updates an employee's wallet for this year.</p>
        </div>
        <div className="p-4 sm:p-6 space-y-4">
          <Field label="Employee ID" required>
            <input value={form.employeeId} onChange={e => setForm({...form, employeeId: e.target.value})} className="input" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Employee Name">
              <input value={form.employeeName} onChange={e => setForm({...form, employeeName: e.target.value})} className="input" />
            </Field>
            <Field label="Grade">
              <select value={form.employeeGrade} onChange={e => setForm({...form, employeeGrade: e.target.value})} className="input">
                <option value="">—</option>
                {['STAFF','EXEC','MGR','DIR','VP','C_SUITE'].map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Credited Amount (SGD)" required>
            <input type="number" step="0.01" min="1" value={form.creditedAmount}
              onChange={e => setForm({...form, creditedAmount: e.target.value})} className="input" />
          </Field>
          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 font-bold">{error}</div>}
          <div className="flex gap-3 pt-2">
            <button onClick={save} disabled={saving} className="flex-1 py-2.5 bg-indigo-600 text-white text-xs font-black uppercase tracking-widest rounded-xl hover:bg-indigo-700 disabled:opacity-50">
              {saving ? 'Crediting…' : 'Credit Wallet'}
            </button>
            <button onClick={onClose} className="px-5 py-2.5 border border-slate-200 text-slate-600 text-xs font-black uppercase tracking-widest rounded-xl hover:bg-slate-50">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Field wrapper ────────────────────────────────────────────────────────────
function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1.5">
        {label}{required && <span className="text-red-500"> *</span>}
      </label>
      {children}
    </div>
  );
}
