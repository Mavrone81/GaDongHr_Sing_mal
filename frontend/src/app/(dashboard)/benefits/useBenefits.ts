'use client';

import { useEffect, useState } from 'react';
import { apiFetchRaw } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

// ─── Domain types (shared by the page and its modal components) ───────────────

export interface Plan {
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

export interface Enrollment {
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

export interface Dependent {
  id: string;
  fullName: string;
  relationship: 'SPOUSE' | 'CHILD' | 'PARENT' | 'OTHER';
  dateOfBirth: string;
  nric: string | null;
  isActive: boolean;
}

export interface Claim {
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

export interface OpenEnrollmentPeriod {
  id: string;
  name: string;
  year: number;
  startDate: string;
  endDate: string;
  status: string;
  planIds: string[];
}

// ── BEN-002: Flexi-Benefits Wallet types ─────────────────────────────────────
export interface FlexiCategory {
  id: string;
  code: string;
  name: string;
  description: string | null;
  requiresReceipt: boolean;
  isActive: boolean;
}

export interface FlexiWallet {
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

export interface FlexiBalance {
  credited: number;
  used: number;
  pending: number;
  remaining: number;
  encashed: number;
  forfeited: number;
}

export interface FlexiClaim {
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

export interface FlexiWalletConfig {
  id: string | null;
  grade: string;
  annualAmount: number;
  autoApproveThreshold: number;
  isActive: boolean;
  isDefault: boolean;
}

export const HR_ROLES = ['HR_ADMIN', 'HR_MANAGER', 'SUPER_ADMIN'];

/**
 * All data, loading and action handlers for the benefits screen. Extracted
 * verbatim from the page so the presentation restyle that follows can be
 * reviewed as a pure JSX diff. The prompt/confirm/alert flows are the existing
 * behaviour and are moved unchanged.
 */
export function useBenefits() {
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
        apiFetchRaw('/benefits/plans').then(r => r.json()),
        apiFetchRaw('/benefits/open-enrollment/current').then(r => r.json()),
        apiFetchRaw('/benefits/flexi-categories').then(r => r.json()),
      ]);
      setPlans(plansRes.plans || []);
      setOpenPeriod(periodRes.active ? periodRes.period : null);
      setFlexiCategories(catRes.categories || []);

      if (isHr) {
        const [enrRes, claimsRes, periodsRes, dashRes, fWalletsRes, fClaimsRes, fDashRes, fCfgRes] = await Promise.all([
          apiFetchRaw('/benefits/enrollments').then(r => r.json()),
          apiFetchRaw('/benefits/claims').then(r => r.json()),
          apiFetchRaw('/benefits/open-enrollment').then(r => r.json()),
          apiFetchRaw('/benefits/dashboard').then(r => r.json()),
          apiFetchRaw(`/benefits/flexi-wallets?year=${flexiYear}`).then(r => r.json()),
          apiFetchRaw(`/benefits/flexi-claims?year=${flexiYear}`).then(r => r.json()),
          apiFetchRaw(`/benefits/flexi-dashboard?year=${flexiYear}`).then(r => r.json()),
          apiFetchRaw('/benefits/flexi-config').then(r => r.json()),
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
          apiFetchRaw('/benefits/enrollments/me').then(r => r.json()),
          apiFetchRaw('/benefits/dependents').then(r => r.json()),
          apiFetchRaw('/benefits/claims').then(r => r.json()),
          apiFetchRaw(`/benefits/flexi-wallets/me?year=${new Date().getFullYear()}`).then(r => r.json()),
          apiFetchRaw('/benefits/flexi-claims').then(r => r.json()),
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
    const res = await apiFetchRaw(`/benefits/enrollments/${id}/cancel`, {
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
    const res = await apiFetchRaw(`/benefits/claims/${id}/approve`, {
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
    const res = await apiFetchRaw(`/benefits/claims/${id}/reject`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rejectedReason: reason.trim() }),
    });
    if (res.ok) loadData();
    else alert((await res.json()).error || 'Failed');
  }

  async function reimburseClaim(id: string) {
    if (!confirm('Mark this claim as reimbursed?')) return;
    const res = await apiFetchRaw(`/benefits/claims/${id}/reimburse`, { method: 'PUT' });
    if (res.ok) loadData();
    else alert((await res.json()).error || 'Failed');
  }

  async function deleteDependent(id: string) {
    if (!confirm('Remove this dependent?')) return;
    const res = await apiFetchRaw(`/benefits/dependents/${id}`, { method: 'DELETE' });
    if (res.ok) loadData();
    else alert((await res.json()).error || 'Failed');
  }

  async function closePeriod(id: string) {
    if (!confirm('Close this open enrollment window?')) return;
    const res = await apiFetchRaw(`/benefits/open-enrollment/${id}/close`, { method: 'PUT' });
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
    const res = await apiFetchRaw(`/benefits/flexi-claims/${id}/approve`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (res.ok) loadData();
    else alert((await res.json()).error || 'Failed to approve');
  }

  async function rejectFlexiClaim(id: string) {
    const reason = window.prompt('Reason for rejection?');
    if (!reason || !reason.trim()) return;
    const res = await apiFetchRaw(`/benefits/flexi-claims/${id}/reject`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rejectedReason: reason.trim() }),
    });
    if (res.ok) loadData();
    else alert((await res.json()).error || 'Failed to reject');
  }

  async function cancelFlexiClaim(id: string) {
    if (!confirm('Cancel this claim?')) return;
    const res = await apiFetchRaw(`/benefits/flexi-claims/${id}/cancel`, { method: 'PUT' });
    if (res.ok) loadData();
    else alert((await res.json()).error || 'Failed to cancel');
  }

  async function runFlexiYearEnd(encash: boolean) {
    const label = encash ? 'encash (add to payroll)' : 'forfeit (lose unused balance)';
    if (!confirm(`Year-end ${flexiYear}: ${label} all unused flexi wallet balances?`)) return;
    const res = await apiFetchRaw('/benefits/flexi-wallets/year-end', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ year: flexiYear, encash }),
    });
    if (res.ok) { const d = await res.json(); alert(`Done. Processed ${d.processed} wallets.`); loadData(); }
    else alert((await res.json()).error || 'Failed');
  }

  async function loadYearEndPreview() {
    try {
      const res = await apiFetchRaw(`/benefits/flexi-wallets/year-end-preview?year=${flexiYear}`);
      if (res.ok) setFlexiYearEndPreview(await res.json());
    } catch (_) { /* ignore */ }
  }

  async function seedFlexiCategories() {
    const res = await apiFetchRaw('/benefits/flexi-categories/seed', { method: 'POST' });
    if (res.ok) { const d = await res.json(); alert(`Seeded ${d.created} categories (${d.skipped} skipped).`); loadData(); }
    else alert('Failed to seed categories');
  }

  return {
    user, role, isHr,
    hrTab, setHrTab,
    flexiSubTab, setFlexiSubTab,
    plans, setPlans,
    myEnrollments, setMyEnrollments,
    allEnrollments, setAllEnrollments,
    myDependents, setMyDependents,
    myClaims, setMyClaims,
    allClaims, setAllClaims,
    openPeriod, setOpenPeriod,
    allPeriods, setAllPeriods,
    dashboard, setDashboard,
    loading, setLoading,
    flexiWallet, setFlexiWallet,
    flexiBalance, setFlexiBalance,
    myFlexiClaims, setMyFlexiClaims,
    flexiCategories, setFlexiCategories,
    allFlexiWallets, setAllFlexiWallets,
    allFlexiClaims, setAllFlexiClaims,
    flexiDashboard, setFlexiDashboard,
    flexiConfigs, setFlexiConfigs,
    flexiYearEndPreview, setFlexiYearEndPreview,
    flexiYear, setFlexiYear,
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
    cancelEnrollment,
    approveClaim,
    rejectClaim,
    reimburseClaim,
    deleteDependent,
    closePeriod,
    approveFlexiClaim,
    rejectFlexiClaim,
    cancelFlexiClaim,
    runFlexiYearEnd,
    loadYearEndPreview,
    seedFlexiCategories,
  };
}
