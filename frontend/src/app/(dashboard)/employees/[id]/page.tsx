'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { apiFetch, apiFetchRaw } from '@/lib/api';
import { CountrySelect } from '@/components/employee/CountrySelect';
import { DatePicker } from '@/components/employee/DatePicker';
import { PostalLookup } from '@/components/employee/PostalLookup';

// ─── Types ────────────────────────────────────────────────────────────────────
interface Employee {
  id: string;
  employeeCode: string;
  fullName: string;
  profilePhotoUrl?: string | null;
  preferredName?: string;
  gender?: string;
  workEmail: string;
  workPhone?: string;
  personalEmail?: string;
  personalPhone?: string;
  department: string;
  designation: string;
  employmentType: string;
  startDate: string;
  endDate?: string;
  probationEndDate?: string;
  noticePeriodDays?: number;
  isActive: boolean;
  nationality: string;
  nricEncrypted: string;
  dateOfBirth: string;
  maritalStatus: string;
  race?: string;
  religion?: string;
  weeklyHours?: number;
  workDays?: number;
  costCentre?: string;
  reportingManager?: string;
  homeAddressEncrypted?: string;
  basicSalaryEncrypted?: string;
  bankName?: string;
  bankAccountEncrypted?: string;
  emergencyContactName?: string;
  emergencyContactRelation?: string;
  emergencyContactPhone?: string;
  emergencyContactEmail?: string;
  annualLeaveEntitlement?: number;
  sickLeaveEntitlement?: number;
  childcareLeaveEntitlement?: number;
  annualLeaveBalance?: number;
  sickLeaveBalance?: number;
}

type Tab = 'general' | 'contracts' | 'statutory' | 'documents' | 'assets' | 'supervisors' | 'salary';

interface EmployeeDocument {
  id: string;
  docType: string;
  fileName: string;
  fileSize?: number;
  mimeType?: string;
  expiryDate?: string;
  createdAt: string;
  uploadedBy: string;
}

// ─── Shared input styles ───────────────────────────────────────────────────────
const IX = 'w-full bg-paper border border-accent px-4 py-2.5 text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent transition-all placeholder:text-muted placeholder:font-normal';
const SX = IX + ' cursor-pointer appearance-none pr-9';

// Format Prisma enum values into readable labels for display
function fmtEnum(v?: string | null) {
  if (!v) return '';
  return v.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// Safely format any date string (YYYY-MM-DD or full ISO datetime)
function fmtDate(v?: string | null, opts?: Intl.DateTimeFormatOptions): string {
  if (!v) return '';
  const dateOnly = v.length > 10 ? v.slice(0, 10) : v;
  const d = new Date(dateOnly + 'T00:00:00');
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-SG', opts ?? { day: 'numeric', month: 'short', year: 'numeric' });
}

// Normalise any date value to YYYY-MM-DD for the DatePicker
function toDateOnly(v?: string | null): string {
  if (!v) return '';
  return v.length > 10 ? v.slice(0, 10) : v;
}

// ─── Field wrapper ─────────────────────────────────────────────────────────────
function Field({
  label, value, editing = false, children, span,
}: {
  label: string;
  value: React.ReactNode;
  editing?: boolean;
  children?: React.ReactNode;
  span?: '2' | '3';
}) {
  const spanCls = span === '2' ? 'md:col-span-2' : span === '3' ? 'col-span-full' : '';
  const isEmpty = value == null || value === '' || value === '—' || value === '****';
  // When viewing (not editing), don't render fields with no value — e.g. data the
  // viewer isn't allowed to see (PDPA-masked) or that simply wasn't provided.
  if (!editing && isEmpty) return null;
  return (
    <div className={`flex flex-col gap-1.5 ${spanCls}`}>
      <label className="label-form">{label}</label>
      {editing && children ? children : (
        <div className="bg-page border border-rule px-4 py-2.5 text-sm font-bold text-ink min-h-[42px] flex items-center">
          {value != null && value !== '' ? value : <span className="text-muted italic text-xs font-normal">Not provided</span>}
        </div>
      )}
    </div>
  );
}

// ─── Section wrapper ───────────────────────────────────────────────────────────
function Section({ title, accent = 'bg-accent', children }: { title: string; accent?: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="text-[10px] font-black text-muted uppercase tracking-[0.2em] mb-5 flex items-center gap-3">
        <div className={`w-1.5 h-4 ${accent}  shrink-0`} />
        {title}
      </h4>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 items-start">
        {children}
      </div>
    </section>
  );
}

// ─── Select helper ─────────────────────────────────────────────────────────────
type SelOption = string | { value: string; label: string };
function Sel({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: SelOption[] }) {
  return (
    <div className="relative">
      <select value={value} onChange={e => onChange(e.target.value)} className={SX}>
        <option value="">— Select —</option>
        {options.map(o => {
          const v = typeof o === 'string' ? o : o.value;
          const l = typeof o === 'string' ? o : o.label;
          return <option key={v} value={v}>{l}</option>;
        })}
      </select>
      <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    </div>
  );
}

// ─── Entitlement bar ───────────────────────────────────────────────────────────
function EntitlementRow({ label, total, used, color = 'bg-accent' }: { label: string; total: number; used: number; color?: string }) {
  const pct = total > 0 ? Math.round((used / total) * 100) : 0;
  return (
    <div className="flex flex-col gap-2 p-4 bg-page border border-rule">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-black text-ink uppercase tracking-wider">{label}</span>
        <span className="text-[10px] font-black text-muted">{total - used} / {total} days left</span>
      </div>
      <div className="w-full h-2 bg-rule overflow-hidden">
        <div className={`h-full  ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="flex justify-between text-[8px] font-black text-muted uppercase tracking-widest">
        <span>Used: {used} days</span>
        <span>{pct}% consumed</span>
      </div>
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────
export default function EmployeeDetail({ params }: { params: { id: string } }) {
  const { hasPermission } = useAuth();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState<Partial<Employee>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [showSensitive, setShowSensitive] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('general');

  // Employee assets
  const [empAssets, setEmpAssets] = useState<any[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [assetToast, setAssetToast] = useState('');
  const [allAssets, setAllAssets] = useState<any[]>([]);
  const [assignAssetId, setAssignAssetId] = useState('');
  const [assigningAsset, setAssigningAsset] = useState(false);
  const [returningAsset, setReturningAsset] = useState<string | null>(null);

  // Documents
  const [documents, setDocuments] = useState<EmployeeDocument[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadDocType, setUploadDocType] = useState('OTHER');
  const [uploadExpiry, setUploadExpiry] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  // Leave entitlements
  const [leaveEntitlements, setLeaveEntitlements] = useState<any[]>([]);
  const [loadingEntitlements, setLoadingEntitlements] = useState(false);
  const [entitlementEdits, setEntitlementEdits] = useState<Record<string, string>>({});
  const [savingEntitlements, setSavingEntitlements] = useState(false);
  const [entitlementToast, setEntitlementToast] = useState('');

  // Salary history & revisions
  const [salaryHistory, setSalaryHistory] = useState<any[]>([]);
  const [loadingSalaryHistory, setLoadingSalaryHistory] = useState(false);
  const [showRevisionForm, setShowRevisionForm] = useState(false);
  const [revForm, setRevForm] = useState({ newSalary: '', effectiveDate: '', reasonCode: 'PROMOTION', recommendedBy: '', notes: '' });
  const [submittingRevision, setSubmittingRevision] = useState(false);
  const [revisionToast, setRevisionToast] = useState('');
  const [budgetEnvelope, setBudgetEnvelope] = useState<any>(null);

  // Supervisors
  const [supervisorData, setSupervisorData] = useState<{ flowType: string; supervisors: any[] } | null>(null);
  const [loadingSupervisors, setLoadingSupervisors] = useState(false);
  const [supervisorToast, setSupervisorToast] = useState('');
  const [editingSupervisors, setEditingSupervisors] = useState(false);
  const [draftSupervisors, setDraftSupervisors] = useState<any[]>([]);
  const [draftFlowType, setDraftFlowType] = useState('ANY_ONE');
  const [allEmployees, setAllEmployees] = useState<any[]>([]);
  const [savingSupervisors, setSavingSupervisors] = useState(false);

  const fetchEmployee = useCallback(async () => {
    try {
      // Try by UUID first, fall back to employee-code lookup (404 → not a UUID).
      let data;
      try { data = await apiFetch(`/employees/${params.id}`); }
      catch { data = await apiFetch(`/employees/code/${params.id}`); }
      setEmployee(data);
    } catch (err) {
      console.error('Failed to fetch employee:', err);
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => { fetchEmployee(); }, [fetchEmployee]);

  const loadDocuments = useCallback(() => {
    if (!params.id) return;
    setDocsLoading(true);
    apiFetch(`/documents/employee/${params.id}`)
      .then(d => setDocuments(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setDocsLoading(false));
  }, [params.id]);

  useEffect(() => {
    if (activeTab === 'documents') loadDocuments();
  }, [activeTab, loadDocuments]);

  useEffect(() => {
    if (activeTab !== 'assets' || !params.id) return;
    setLoadingAssets(true);
    Promise.all([
      apiFetch(`/assets/employee/${params.id}`),
      apiFetch('/assets?limit=200&status=AVAILABLE'),
    ])
      .then(([assigned, available]) => {
        setEmpAssets(assigned ?? []);
        setAllAssets(available.assets ?? []);
      })
      .catch(() => {})
      .finally(() => setLoadingAssets(false));
  }, [activeTab, params.id]);

  useEffect(() => {
    if (activeTab !== 'contracts' || !params.id) return;
    setLoadingEntitlements(true);
    apiFetch(`/leave/entitlements/${params.id}`)
      .then(d => { setLeaveEntitlements(d); setEntitlementEdits({}); })
      .catch(() => {})
      .finally(() => setLoadingEntitlements(false));
  }, [activeTab, params.id]);

  useEffect(() => {
    if (activeTab !== 'supervisors' || !params.id) return;
    setLoadingSupervisors(true);
    apiFetch(`/employees/${params.id}/supervisors`)
      .then(d => setSupervisorData(d))
      .catch(() => {})
      .finally(() => setLoadingSupervisors(false));
  }, [activeTab, params.id]);

  const loadSalaryHistory = useCallback(() => {
    if (!params.id) return;
    setLoadingSalaryHistory(true);
    Promise.all([
      apiFetch(`/employees/${params.id}/salary-history`),
      apiFetch(`/employees/salary-revisions/budget-envelope?year=${new Date().getFullYear()}`).catch(() => null),
    ])
      .then(([hist, budget]) => {
        setSalaryHistory(Array.isArray(hist) ? hist : []);
        if (budget) setBudgetEnvelope(budget);
      })
      .catch(() => {})
      .finally(() => setLoadingSalaryHistory(false));
  }, [params.id]);

  useEffect(() => {
    if (activeTab !== 'salary') return;
    loadSalaryHistory();
  }, [activeTab, loadSalaryHistory]);

  const startEditing = () => {
    if (!employee) return;
    setEditData({ ...employee });
    setSaveError('');
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setEditData({});
    setSaveError('');
  };

  const set = (field: keyof Employee, value: string | number | boolean) => {
    setEditData(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    if (!employee) return;
    setSaving(true);
    setSaveError('');
    try {
      const updated = await apiFetch(`/employees/${employee.id}`, {
        method: 'PATCH',
        body: JSON.stringify(editData),
      });
      setEmployee(updated);
      setIsEditing(false);
      setEditData({});
    } catch (e: any) {
      setSaveError(e.message || 'Network error — changes not saved.');
    } finally {
      setSaving(false);
    }
  };

  // ── Derived values ─────────────────────────────────────────────────────────
  if (loading) return (
    <div className="p-20 text-center flex flex-col items-center gap-4">
      <div className="animate-spin h-12 w-12 border-t-2 border-b-2 border-accent rounded-full" />
      <p className="text-xs font-bold text-muted uppercase tracking-widest animate-pulse">Syncing Employee Records…</p>
    </div>
  );
  if (!employee) return <div className="p-20 text-center text-ink">Employee record not found.</div>;

  const emp = isEditing ? { ...employee, ...editData } : employee;
  const initials = emp.fullName.split(' ').map(n => n[0]).join('').toUpperCase();
  const tenureMs = Date.now() - new Date(emp.startDate).getTime();
  const tenureYrs = (tenureMs / (1000 * 60 * 60 * 24 * 365.25)).toFixed(1);

  const TABS: { key: Tab; label: string }[] = [
    { key: 'general', label: 'General Profile' },
    { key: 'contracts', label: 'Contracts & Entitlements' },
  ];

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-6 max-w-[1600px] mx-auto pb-12">

      {/* Editing mode banner */}
      {isEditing && (
        <div className="flex items-center justify-between bg-accent px-6 py-3">
          <div className="flex items-center gap-3">
            <svg className="w-4 h-4 text-paper" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            <span className="text-xs font-black text-paper uppercase tracking-widest">Editing Mode — unsaved changes will be lost if you navigate away</span>
          </div>
          {saveError && (
            <span className="text-xs font-black text-ink bg-ink px-3 py-1">{saveError}</span>
          )}
        </div>
      )}

      {/* Breadcrumb bar */}
      <div className="flex items-center justify-between bg-paper p-4 border border-rule">
        <div className="flex items-center gap-3">
          <Link href="/employees" className="text-[10px] font-black text-muted hover:text-accent bg-page border border-rule px-3 py-1.5 uppercase tracking-widest transition-all">
            ← Directory
          </Link>
          <span className="text-muted">/</span>
          <h2 className="text-sm font-black text-ink uppercase tracking-widest">
            {emp.fullName}
            <span className="text-muted font-bold ml-2">[{emp.employeeCode}]</span>
          </h2>
        </div>
        <div className="flex gap-3 items-center">
          {hasPermission('employee:manage') && (
            !isEditing ? (
              <button onClick={startEditing} className="px-5 py-2 border border-rule text-[10px] font-black text-ink hover:bg-page transition-all uppercase tracking-widest">
                Edit Record
              </button>
            ) : (
              <div className="flex gap-2">
                <button onClick={cancelEditing} className="px-4 py-2 border border-rule text-[10px] font-black text-ink hover:bg-page transition-all uppercase tracking-widest">
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-5 py-2 text-[10px] font-black text-paper bg-accent hover:bg-accent transition-all uppercase tracking-widest disabled:opacity-60 flex items-center gap-2"
                >
                  {saving && <svg className="w-3 h-3 animate-spin rounded-full" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>}
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            )
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">

        {/* ── Left: Main Content ─────────────────────────────────────────────── */}
        <div className="xl:col-span-3 flex flex-col gap-6">

          {/* Hero card */}
          <section className="bg-paper p-8 border border-rule flex items-start gap-8 relative overflow-hidden">
            <div className={`absolute top-0 left-0 w-1 h-full ${isEditing ? 'bg-highlight' : 'bg-accent'} transition-colors`} />
            <div className="h-28 w-28 bg-shadow border-4 border-shadow flex items-center justify-center shrink-0 relative overflow-hidden">
              {emp.profilePhotoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={emp.profilePhotoUrl} alt={emp.fullName} className="absolute inset-0 w-full h-full object-cover" />
              ) : (
                <span className="text-3xl font-black text-paper">{initials}</span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="text-2xl font-black text-ink">{emp.fullName}</h3>
                {emp.preferredName && <span className="text-muted font-bold text-sm">&quot;{emp.preferredName}&quot;</span>}
                <span className={`px-3 py-1  text-[9px] font-black border uppercase tracking-widest ${emp.isActive ? 'bg-page text-accent border-accent' : 'bg-page text-ink border-ink'}`}>
                  {emp.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>
              <p className="text-sm font-bold text-muted mt-1 uppercase tracking-widest">
                {emp.designation}<span className="mx-2 opacity-30">|</span>{emp.department}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 mt-6">
                {[
                  { label: 'Employee ID', val: emp.employeeCode },
                  { label: 'Work Email', val: emp.workEmail },
                  { label: 'Start Date', val: fmtDate(emp.startDate) || '—' },
                  { label: 'Tenure', val: `${tenureYrs} yrs` },
                ].map(({ label, val }) => (
                  <div key={label}>
                    <p className="label-form mb-1">{label}</p>
                    <p className="text-xs font-bold text-ink truncate">{val}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Tab panel */}
          <div className="bg-paper border border-rule overflow-hidden">
            {/* Tab bar */}
            <div className="border-b border-rule flex px-6 bg-page overflow-x-auto">
              {TABS.map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`py-4 px-4 text-[10px] font-black uppercase tracking-[0.18em] border-b-2 whitespace-nowrap transition-all mr-2 ${
                    activeTab === tab.key ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-ink'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="p-8">

              {/* ══ GENERAL PROFILE ══════════════════════════════════════════════ */}
              {activeTab === 'general' && (
                <div className="flex flex-col gap-10">

                  <Section title="Personal Information">
                    <Field label="Full Legal Name" value={emp.fullName} editing={isEditing}>
                      <input type="text" value={editData.fullName ?? ''} onChange={e => set('fullName', e.target.value)} className={IX} placeholder="Full legal name" />
                    </Field>
                    <Field label="Preferred Name" value={emp.preferredName} editing={isEditing}>
                      <input type="text" value={editData.preferredName ?? ''} onChange={e => set('preferredName', e.target.value)} className={IX} placeholder="Name they go by" />
                    </Field>
                    <Field label="Gender" value={fmtEnum(emp.gender)} editing={isEditing}>
                      <Sel value={editData.gender ?? ''} onChange={v => set('gender', v)} options={[
                        { value: 'MALE', label: 'Male' },
                        { value: 'FEMALE', label: 'Female' },
                        { value: 'PREFER_NOT_TO_SAY', label: 'Prefer not to say' },
                      ]} />
                    </Field>
                    <Field label="Date of Birth" value={fmtDate(emp.dateOfBirth, { day: 'numeric', month: 'long', year: 'numeric' })} editing={isEditing}>
                      <DatePicker value={toDateOnly(editData.dateOfBirth ?? emp.dateOfBirth)} onChange={v => set('dateOfBirth', v)} placeholder="Select birth date" minYear={1940} maxYear={new Date().getFullYear() - 16} />
                    </Field>
                    <Field label="Nationality" value={emp.nationality} editing={isEditing}>
                      <CountrySelect value={editData.nationality ?? ''} onChange={v => set('nationality', v)} />
                    </Field>
                    <Field label="Marital Status" value={fmtEnum(emp.maritalStatus)} editing={isEditing}>
                      <Sel value={editData.maritalStatus ?? ''} onChange={v => set('maritalStatus', v)} options={[
                        { value: 'SINGLE',   label: 'Single'   },
                        { value: 'MARRIED',  label: 'Married'  },
                        { value: 'DIVORCED', label: 'Divorced' },
                        { value: 'WIDOWED',  label: 'Widowed'  },
                      ]} />
                    </Field>
                    <Field label="Race" value={emp.race} editing={isEditing}>
                      <Sel value={editData.race ?? ''} onChange={v => set('race', v)} options={['Chinese','Malay','Indian','Eurasian','Caucasian','Others']} />
                    </Field>
                    <Field label="Religion" value={emp.religion} editing={isEditing}>
                      <Sel value={editData.religion ?? ''} onChange={v => set('religion', v)} options={['Buddhism','Christianity','Islam','Hinduism','Taoism','Sikhism','No Religion','Others']} />
                    </Field>
                    <Field label="NRIC / FIN" value={showSensitive ? emp.nricEncrypted : '•••• ••••'} editing={isEditing}>
                      <input type="text" value={editData.nricEncrypted ?? ''} onChange={e => set('nricEncrypted', e.target.value)} className={IX} placeholder="S/T/F/G + 7 digits + letter" maxLength={9} />
                    </Field>
                  </Section>

                  <Section title="Contact Details">
                    <Field label="Work Email" value={emp.workEmail} editing={isEditing}>
                      <input type="email" value={editData.workEmail ?? ''} onChange={e => set('workEmail', e.target.value)} className={IX} placeholder="work@company.com" />
                    </Field>
                    <Field label="Work Phone" value={emp.workPhone} editing={isEditing}>
                      <input type="tel" value={editData.workPhone ?? ''} onChange={e => set('workPhone', e.target.value)} className={IX} placeholder="+65 XXXX XXXX" />
                    </Field>
                    <Field label="Personal Email" value={emp.personalEmail} editing={isEditing}>
                      <input type="email" value={editData.personalEmail ?? ''} onChange={e => set('personalEmail', e.target.value)} className={IX} placeholder="personal@email.com" />
                    </Field>
                    <Field label="Personal Phone" value={emp.personalPhone} editing={isEditing}>
                      <input type="tel" value={editData.personalPhone ?? ''} onChange={e => set('personalPhone', e.target.value)} className={IX} placeholder="+65 XXXX XXXX" />
                    </Field>
                    <Field label="Home Address" value={showSensitive ? emp.homeAddressEncrypted : '•••• •••• ••••'} editing={isEditing} span="2">
                      <PostalLookup value={editData.homeAddressEncrypted ?? ''} onChange={v => set('homeAddressEncrypted', v)} />
                    </Field>
                  </Section>

                  <Section title="Emergency Contact">
                    <Field label="Contact Name" value={emp.emergencyContactName} editing={isEditing}>
                      <input type="text" value={editData.emergencyContactName ?? ''} onChange={e => set('emergencyContactName', e.target.value)} className={IX} placeholder="Full name" />
                    </Field>
                    <Field label="Relationship" value={emp.emergencyContactRelation} editing={isEditing}>
                      <Sel value={editData.emergencyContactRelation ?? ''} onChange={v => set('emergencyContactRelation', v)} options={['Spouse','Parent','Sibling','Child','Relative','Friend','Other']} />
                    </Field>
                    <Field label="Contact Phone" value={emp.emergencyContactPhone} editing={isEditing}>
                      <input type="tel" value={editData.emergencyContactPhone ?? ''} onChange={e => set('emergencyContactPhone', e.target.value)} className={IX} placeholder="+65 XXXX XXXX" />
                    </Field>
                    <Field label="Contact Email" value={emp.emergencyContactEmail} editing={isEditing}>
                      <input type="email" value={editData.emergencyContactEmail ?? ''} onChange={e => set('emergencyContactEmail', e.target.value)} className={IX} placeholder="emergency@email.com" />
                    </Field>
                  </Section>

                  <Section title="Employment Details">
                    <Field label="Employee Code" value={emp.employeeCode}>
                      {/* read-only — never editable */}
                    </Field>
                    <Field label="Department" value={emp.department} editing={isEditing}>
                      <Sel value={editData.department ?? ''} onChange={v => set('department', v)} options={['Human Resources','Finance','Engineering','Operations','Sales','Marketing','Legal','Administration','IT','Other']} />
                    </Field>
                    <Field label="Designation / Title" value={emp.designation} editing={isEditing}>
                      <input type="text" value={editData.designation ?? ''} onChange={e => set('designation', e.target.value)} className={IX} placeholder="Job title" />
                    </Field>
                    <Field label="Employment Type" value={fmtEnum(emp.employmentType)} editing={isEditing}>
                      <Sel value={editData.employmentType ?? ''} onChange={v => set('employmentType', v)} options={[
                        { value: 'FULL_TIME',  label: 'Full Time'  },
                        { value: 'PART_TIME',  label: 'Part Time'  },
                        { value: 'CONTRACT',   label: 'Contract'   },
                        { value: 'INTERN',     label: 'Intern'     },
                        { value: 'TEMP',       label: 'Temporary'  },
                      ]} />
                    </Field>
                    <Field label="Cost Centre" value={emp.costCentre} editing={isEditing}>
                      <input type="text" value={editData.costCentre ?? ''} onChange={e => set('costCentre', e.target.value)} className={IX} placeholder="e.g. CC-001" />
                    </Field>
                    <Field label="Reporting Manager" value={emp.reportingManager} editing={isEditing}>
                      <input type="text" value={editData.reportingManager ?? ''} onChange={e => set('reportingManager', e.target.value)} className={IX} placeholder="Manager full name" />
                    </Field>
                    <Field label="Start Date" value={fmtDate(emp.startDate)} editing={isEditing}>
                      <DatePicker value={toDateOnly(editData.startDate ?? emp.startDate)} onChange={v => set('startDate', v)} placeholder="Employment start date" minYear={1990} maxYear={new Date().getFullYear() + 1} />
                    </Field>
                    <Field label="Weekly Hours" value={`${emp.weeklyHours ?? 44} hrs`} editing={isEditing}>
                      <input type="number" min={1} max={80} value={editData.weeklyHours ?? ''} onChange={e => set('weeklyHours', Number(e.target.value))} className={IX} placeholder="44" />
                    </Field>
                    <Field label="Work Days / Week" value={`${emp.workDays ?? 5} days`} editing={isEditing}>
                      <Sel value={String(editData.workDays ?? emp.workDays ?? '')} onChange={v => set('workDays', Number(v))} options={['3','4','5','6']} />
                    </Field>
                  </Section>

                </div>
              )}

              {/* ══ CONTRACTS & ENTITLEMENTS ══════════════════════════════════════ */}
              {activeTab === 'contracts' && (
                <div className="flex flex-col gap-10">

                  <Section title="Contract Terms">
                    <Field label="Contract Type" value={fmtEnum(emp.employmentType)} editing={isEditing}>
                      <Sel value={editData.employmentType ?? ''} onChange={v => set('employmentType', v)} options={[
                        { value: 'FULL_TIME',  label: 'Full Time'  },
                        { value: 'PART_TIME',  label: 'Part Time'  },
                        { value: 'CONTRACT',   label: 'Contract'   },
                        { value: 'INTERN',     label: 'Intern'     },
                        { value: 'TEMP',       label: 'Temporary'  },
                      ]} />
                    </Field>
                    <Field label="Contract Start Date" value={fmtDate(emp.startDate)} editing={isEditing}>
                      <DatePicker value={toDateOnly(editData.startDate ?? emp.startDate)} onChange={v => set('startDate', v)} minYear={1990} maxYear={new Date().getFullYear() + 2} />
                    </Field>
                    <Field label="Contract End Date" value={fmtDate(emp.endDate) || 'Permanent'} editing={isEditing}>
                      <DatePicker value={toDateOnly(editData.endDate ?? emp.endDate)} onChange={v => set('endDate', v)} placeholder="Leave blank if permanent" minYear={new Date().getFullYear()} maxYear={new Date().getFullYear() + 10} />
                    </Field>
                    <Field label="Probation End Date" value={fmtDate(emp.probationEndDate) || 'Completed'} editing={isEditing}>
                      <DatePicker value={toDateOnly(editData.probationEndDate ?? emp.probationEndDate)} onChange={v => set('probationEndDate', v)} placeholder="Leave blank if completed" minYear={new Date().getFullYear() - 5} maxYear={new Date().getFullYear() + 2} />
                    </Field>
                    <Field label="Notice Period (days)" value={`${emp.noticePeriodDays ?? 30} days`} editing={isEditing}>
                      <input type="number" min={0} max={365} value={editData.noticePeriodDays ?? ''} onChange={e => set('noticePeriodDays', Number(e.target.value))} className={IX} placeholder="30" />
                    </Field>
                    <Field label="Weekly Hours" value={`${emp.weeklyHours ?? 44} hrs`} editing={isEditing}>
                      <input type="number" min={1} max={80} value={editData.weeklyHours ?? ''} onChange={e => set('weeklyHours', Number(e.target.value))} className={IX} placeholder="44" />
                    </Field>
                  </Section>


                  <Section title="Compensation" accent="bg-accent">
                    <div className="flex flex-col gap-1.5">
                      <label className="label-form">Basic Salary (SGD)</label>
                      {isEditing ? (
                        <input type="text" value={editData.basicSalaryEncrypted ?? ''} onChange={e => set('basicSalaryEncrypted', e.target.value)} className={IX} placeholder="e.g. 5000" />
                      ) : (
                        <div className="bg-shadow border border-shadow px-4 py-2.5 text-sm font-bold text-accent flex items-center justify-between min-h-[42px]">
                          <span className="font-mono">{showSensitive ? `SGD ${emp.basicSalaryEncrypted ?? '—'}` : 'SGD ••••••'}</span>
                          <button onClick={() => setShowSensitive(s => !s)} className="text-[9px] font-black text-accent hover:text-accent uppercase ml-4 shrink-0">{showSensitive ? 'Hide' : 'Reveal'}</button>
                        </div>
                      )}
                    </div>
                    <Field label="Bank Name" value={emp.bankName} editing={isEditing}>
                      <Sel value={editData.bankName ?? ''} onChange={v => set('bankName', v)} options={['DBS','OCBC','UOB','Standard Chartered','HSBC','Citibank','Maybank','RHB','Other']} />
                    </Field>
                    <Field label="Bank Account No." value={showSensitive ? emp.bankAccountEncrypted : '•••• •••• ••'} editing={isEditing}>
                      <input type="text" value={editData.bankAccountEncrypted ?? ''} onChange={e => set('bankAccountEncrypted', e.target.value)} className={IX} placeholder="Account number" />
                    </Field>
                  </Section>

                </div>
              )}

              {/* ══ STATUTORY & COMPLIANCE ═══════════════════════════════════════ */}
              {activeTab === 'statutory' && (
                <div className="flex flex-col gap-8">
                  <section className="bg-page p-8 border border-dashed border-rule">
                    <div className="flex items-center justify-between mb-8">
                      <div>
                        <h4 className="text-[11px] font-black text-ink uppercase tracking-widest">CPF Contribution Configuration</h4>
                        <p className="text-[10px] text-muted font-bold uppercase mt-1">Central Provident Fund Board statutory rates</p>
                      </div>
                      <div className="flex items-center gap-2 px-3 py-1 bg-paper border border-rule">
                        <span className="w-1.5 h-1.5 bg-accent" />
                        <span className="text-[9px] font-black text-accent uppercase">Computed Active</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div className="space-y-4">
                        {[
                          { label: 'Enable Ordinary Wages (OW) Calc', sub: 'Subject to $6,000 ceiling' },
                          { label: 'Enable Additional Wages (AW) Calc', sub: 'Annual ceiling formula protection' },
                        ].map(opt => (
                          <label key={opt.label} className="flex items-center gap-4 cursor-pointer p-4 bg-paper border border-rule hover:border-accent transition-all">
                            <input type="checkbox" defaultChecked className="w-5 h-5 text-accent border-rule" />
                            <div>
                              <p className="text-xs font-black text-ink uppercase">{opt.label}</p>
                              <p className="text-[9px] text-muted font-bold uppercase mt-0.5">{opt.sub}</p>
                            </div>
                          </label>
                        ))}
                      </div>
                      <div className="bg-paper p-6 border border-rule">
                        <label className="label-form block mb-4">Citizenship Category</label>
                        <div className="flex flex-col gap-3">
                          {[
                            { label: 'SC / SPR 3rd Year+', note: 'Full rates', active: true },
                            { label: 'SPR Year 1 / 2', note: 'Graduated rates', active: false },
                            { label: 'Foreigner', note: 'No CPF', active: false },
                          ].map(opt => (
                            <button key={opt.label} className={`flex justify-between px-4 py-2.5  text-[10px] font-black uppercase tracking-widest transition-all ${opt.active ? 'bg-accent text-paper' : 'border border-rule text-muted hover:border-accent hover:text-accent'}`}>
                              <span>{opt.label}</span>
                              <span className="opacity-70">{opt.note}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </section>
                  <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-page p-6 border border-accent">
                      <h4 className="text-[10px] font-black text-accent uppercase tracking-widest mb-4">SDL Management</h4>
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input type="checkbox" defaultChecked className="w-5 h-5 text-accent" />
                        <span className="text-[11px] font-black text-ink uppercase">Apply Skills Development Levy (0.25%)</span>
                      </label>
                      <p className="text-[9px] text-accent font-bold uppercase mt-3 leading-relaxed">Capped at SGD 11.25 per month.</p>
                    </div>
                    <div className="bg-shadow p-6 border border-shadow">
                      <h4 className="text-[10px] font-black text-accent uppercase tracking-widest mb-4">Tax & IR8A AIS Integration</h4>
                      <p className="text-[10px] text-muted font-bold uppercase leading-relaxed mb-4">Auto-include in AIS reporting for IRAS.</p>
                      <div className="flex gap-2">
                        <span className="text-[9px] font-black px-2 py-0.5 bg-accent text-paper">IRAS-READY</span>
                        <span className="text-[9px] font-black px-2 py-0.5 bg-shadow text-muted">AIS-2026</span>
                      </div>
                    </div>
                  </section>
                </div>
              )}

              {/* ══ ASSETS ═══════════════════════════════════════════════════════ */}
              {activeTab === 'assets' && (
                <div className="flex flex-col gap-6">
                  {assetToast && (
                    <div className="px-4 py-3 bg-page border border-accent text-accent text-xs font-bold">{assetToast}</div>
                  )}

                  {/* Assign new asset */}
                  <section>
                    <h4 className="text-[10px] font-black text-muted uppercase tracking-[0.2em] mb-4 flex items-center gap-3">
                      <div className="w-1.5 h-4 bg-accent shrink-0" />
                      Assign Asset
                    </h4>
                    <div className="flex gap-3">
                      <select
                        value={assignAssetId}
                        onChange={e => setAssignAssetId(e.target.value)}
                        className="flex-1 px-4 py-2.5 bg-page border border-rule text-sm font-bold text-ink outline-none focus:border-accent"
                      >
                        <option value="">— Select an available asset —</option>
                        {allAssets.map(a => (
                          <option key={a.id} value={a.id}>{a.name} ({a.assetCode}) · {a.category}</option>
                        ))}
                      </select>
                      <button
                        disabled={!assignAssetId || assigningAsset}
                        onClick={async () => {
                          if (!assignAssetId) return;
                          setAssigningAsset(true);
                          try {
                            await apiFetch(`/assets/${assignAssetId}/assign`, {
                              method: 'POST',
                              body: JSON.stringify({ employeeId: params.id }),
                            });
                            const [assigned, available] = await Promise.all([
                              apiFetch(`/assets/employee/${params.id}`),
                              apiFetch('/assets?limit=200&status=AVAILABLE'),
                            ]);
                            setEmpAssets(assigned ?? []);
                            setAllAssets(available.assets ?? []);
                            setAssignAssetId('');
                            setAssetToast('Asset assigned successfully');
                            setTimeout(() => setAssetToast(''), 3000);
                          } catch (e: any) {
                            setAssetToast(e.message);
                            setTimeout(() => setAssetToast(''), 3000);
                          } finally { setAssigningAsset(false); }
                        }}
                        className="px-5 py-2.5 text-[10px] font-black text-paper bg-accent hover:bg-accent disabled:opacity-50 uppercase tracking-widest transition-all"
                      >
                        {assigningAsset ? 'Assigning…' : 'Assign'}
                      </button>
                    </div>
                    {allAssets.length === 0 && !loadingAssets && (
                      <p className="text-xs text-muted font-bold mt-2">No available assets. <a href="/assets" className="text-accent hover:underline">Register assets first →</a></p>
                    )}
                  </section>

                  {/* Assigned assets list */}
                  <section>
                    <h4 className="text-[10px] font-black text-muted uppercase tracking-[0.2em] mb-4 flex items-center gap-3">
                      <div className="w-1.5 h-4 bg-accent shrink-0" />
                      Currently Assigned ({empAssets.length})
                    </h4>
                    {loadingAssets ? (
                      <div className="flex flex-col gap-2">{[1,2].map(i => <div key={i} className="h-14 bg-page animate-pulse" />)}</div>
                    ) : empAssets.length === 0 ? (
                      <div className="py-10 text-center bg-page border border-dashed border-rule">
                        <p className="text-xs font-black text-muted uppercase tracking-widest">No assets assigned to this employee</p>
                      </div>
                    ) : (
                      <div className="overflow-hidden border border-rule">
                        <table className="w-full text-left">
                          <thead>
                            <tr className="bg-page border-b border-rule label-form">
                              <th className="px-5 py-3">Asset</th>
                              <th className="px-5 py-3">Category</th>
                              <th className="px-5 py-3">Assigned</th>
                              <th className="px-5 py-3">Value</th>
                              <th className="px-5 py-3 text-right">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-rule text-xs font-bold text-ink">
                            {empAssets.map(a => (
                              <tr key={a.id} className="hover:bg-page transition-all">
                                <td className="px-5 py-3">
                                  <div className="flex flex-col">
                                    <span className="font-black text-ink">{a.name}</span>
                                    <span className="text-[9px] font-black text-muted uppercase">{a.assetCode}</span>
                                  </div>
                                </td>
                                <td className="px-5 py-3 text-muted uppercase text-[10px]">{a.category}</td>
                                <td className="px-5 py-3 text-muted text-[10px]">
                                  {a.assignedAt ? new Date(a.assignedAt).toLocaleDateString('en-SG') : '—'}
                                </td>
                                <td className="px-5 py-3">${(a.currentValue ?? 0).toLocaleString()}</td>
                                <td className="px-5 py-3 text-right">
                                  <button
                                    disabled={returningAsset === a.id}
                                    onClick={async () => {
                                      setReturningAsset(a.id);
                                      try {
                                        await apiFetch(`/assets/${a.id}/return`, { method: 'POST', body: JSON.stringify({ status: 'AVAILABLE' }) });
                                        const [assigned, available] = await Promise.all([
                                          apiFetch(`/assets/employee/${params.id}`),
                                          apiFetch('/assets?limit=200&status=AVAILABLE'),
                                        ]);
                                        setEmpAssets(assigned ?? []);
                                        setAllAssets(available.assets ?? []);
                                        setAssetToast('Asset returned');
                                        setTimeout(() => setAssetToast(''), 3000);
                                      } catch (e: any) {
                                        setAssetToast(e.message);
                                        setTimeout(() => setAssetToast(''), 3000);
                                      } finally { setReturningAsset(null); }
                                    }}
                                    className="px-3 py-1.5 text-[9px] font-black text-ink bg-page border border-ink hover:bg-page uppercase tracking-widest disabled:opacity-50 transition-all"
                                  >
                                    {returningAsset === a.id ? 'Returning…' : 'Return'}
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                </div>
              )}

              {/* ══ DOCUMENT ARCHIVE ═════════════════════════════════════════════ */}
              {activeTab === 'documents' && (
                <div className="flex flex-col gap-6">
                  {/* Upload modal */}
                  {uploadOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-shadow backdrop-">
                      <div className="w-full max-w-md bg-paper p-8 flex flex-col gap-5">
                        <div className="flex items-center justify-between">
                          <h3 className="text-sm font-black text-ink">Upload Document</h3>
                          <button onClick={() => { setUploadOpen(false); setUploadFile(null); setUploadError(''); }} className="text-muted hover:text-ink text-lg font-black">✕</button>
                        </div>
                        <div>
                          <label className="label-form block mb-2">File</label>
                          <label className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed  py-6 cursor-pointer transition-all ${uploadFile ? 'border-accent bg-page' : 'border-rule hover:border-accent'}`}>
                            <svg className={`w-6 h-6 ${uploadFile ? 'text-accent' : 'text-muted'}`} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>
                            <span className="text-[10px] font-bold text-muted">{uploadFile ? uploadFile.name : 'Click to select file (max 10 MB)'}</span>
                            <input type="file" className="hidden" onChange={e => setUploadFile(e.target.files?.[0] ?? null)} />
                          </label>
                        </div>
                        <div>
                          <label className="label-form block mb-2">Document Type</label>
                          <select value={uploadDocType} onChange={e => setUploadDocType(e.target.value)} className="w-full px-3 py-2.5 border border-rule text-sm font-bold text-ink bg-page outline-none focus:border-accent appearance-none">
                            <option value="CONTRACT">Employment Contract</option>
                            <option value="NRIC_COPY">NRIC / FIN Copy</option>
                            <option value="EMPLOYMENT_PASS">Employment / Work Pass</option>
                            <option value="CERT">Certificate / Qualification</option>
                            <option value="OTHER">Other</option>
                          </select>
                        </div>
                        <div>
                          <label className="label-form block mb-2">Expiry Date <span className="normal-case font-bold">(optional)</span></label>
                          <input type="date" value={uploadExpiry} onChange={e => setUploadExpiry(e.target.value)} className="w-full px-3 py-2.5 border border-rule text-sm font-bold text-ink bg-page outline-none focus:border-accent" />
                        </div>
                        {uploadError && <p className="text-[11px] font-bold text-ink bg-page border border-ink px-3 py-2">{uploadError}</p>}
                        <div className="flex gap-3">
                          <button onClick={() => { setUploadOpen(false); setUploadFile(null); setUploadError(''); }} className="flex-1 px-4 py-2.5 border border-rule text-[10px] font-black text-ink uppercase tracking-widest hover:bg-page">Cancel</button>
                          <button
                            disabled={!uploadFile || uploading}
                            onClick={async () => {
                              if (!uploadFile) return;
                              setUploading(true); setUploadError('');
                              try {
                                const form = new FormData();
                                form.append('file', uploadFile);
                                form.append('docType', uploadDocType);
                                if (uploadExpiry) form.append('expiryDate', uploadExpiry);
                                await apiFetch(`/documents/employee/${params.id}`, {
                                  method: 'POST',
                                  body: form,
                                });
                                setUploadOpen(false); setUploadFile(null); setUploadExpiry(''); setUploadDocType('OTHER');
                                loadDocuments();
                              } catch (e: any) { setUploadError(e.message); }
                              finally { setUploading(false); }
                            }}
                            className="flex-1 px-4 py-2.5 bg-accent hover:bg-accent disabled:opacity-50 text-paper text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2"
                          >
                            {uploading && <span className="w-3 h-3 border-2 border-paper/40 border-t-paper animate-spin rounded-full" />}
                            {uploading ? 'Uploading…' : 'Upload'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="flex justify-between items-center">
                    <h4 className="eyebrow-tight">Secure Document Archive</h4>
                    <button onClick={() => { setUploadOpen(true); setUploadError(''); }} className="text-[10px] font-black uppercase text-accent bg-page px-4 py-2 hover:bg-page transition-all">+ Upload Document</button>
                  </div>

                  {docsLoading ? (
                    <div className="py-12 flex items-center justify-center gap-3 text-muted text-xs font-bold">
                      <span className="w-4 h-4 border-2 border-t-rule border-rule animate-spin rounded-full" /> Loading documents…
                    </div>
                  ) : documents.length === 0 ? (
                    <div className="py-14 flex flex-col items-center gap-3 text-center opacity-40">
                      <span className="text-3xl">📄</span>
                      <p className="text-[10px] font-black text-muted uppercase tracking-widest">No documents uploaded yet</p>
                    </div>
                  ) : (
                    <div className="overflow-hidden border border-rule">
                      <table className="w-full text-left">
                        <thead>
                          <tr className="bg-page label-form border-b border-rule">
                            <th className="px-6 py-4">Document</th>
                            <th className="px-6 py-4">Type</th>
                            <th className="px-6 py-4">Uploaded</th>
                            <th className="px-6 py-4">Expiry</th>
                            <th className="px-6 py-4 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-rule text-xs">
                          {documents.map(doc => {
                            const ext = doc.fileName.split('.').pop()?.toUpperCase() ?? 'FILE';
                            const isImg = doc.mimeType?.startsWith('image/');
                            const isPdf = doc.mimeType === 'application/pdf';
                            const extColor = isPdf ? 'bg-page text-ink' : isImg ? 'bg-page text-accent' : 'bg-page text-muted';
                            return (
                              <tr key={doc.id} className="hover:bg-page transition-all">
                                <td className="px-6 py-4">
                                  <div className="flex items-center gap-3">
                                    <div className={`w-8 h-8  flex items-center justify-center font-black text-[9px] ${extColor}`}>{ext}</div>
                                    <span className="font-bold text-ink truncate max-w-[200px]">{doc.fileName}</span>
                                  </div>
                                </td>
                                <td className="px-6 py-4">
                                  <span className="text-[9px] font-black uppercase text-muted border border-rule px-2 py-0.5">
                                    {doc.docType.replace(/_/g, ' ')}
                                  </span>
                                </td>
                                <td className="px-6 py-4 text-muted font-bold text-[10px]">
                                  {new Date(doc.createdAt).toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' })}
                                </td>
                                <td className="px-6 py-4 text-[10px] font-bold">
                                  {doc.expiryDate ? (
                                    <span className={new Date(doc.expiryDate) < new Date() ? 'text-ink' : 'text-muted'}>
                                      {new Date(doc.expiryDate).toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' })}
                                    </span>
                                  ) : <span className="text-muted">Permanent</span>}
                                </td>
                                <td className="px-6 py-4 text-right flex items-center justify-end gap-3">
                                  <button
                                    onClick={async () => {
                                      try {
                                        const res = await apiFetchRaw(`/documents/${doc.id}/download`);
                                        if (!res.ok) throw new Error();
                                        const blob = await res.blob();
                                        const url = URL.createObjectURL(blob);
                                        window.open(url, '_blank');
                                        setTimeout(() => URL.revokeObjectURL(url), 60000);
                                      } catch { alert('Could not load document.'); }
                                    }}
                                    className="text-accent hover:underline font-black uppercase text-[9px]"
                                  >
                                    View
                                  </button>
                                  <button
                                    onClick={async () => {
                                      if (!confirm(`Delete "${doc.fileName}"?`)) return;
                                      try {
                                        await apiFetch(`/documents/${doc.id}`, { method: 'DELETE' });
                                        loadDocuments();
                                      } catch {}
                                    }}
                                    className="text-ink hover:text-ink hover:underline font-black uppercase text-[9px]"
                                  >
                                    Delete
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* ══ SUPERVISORS ══════════════════════════════════════════════════ */}
              {activeTab === 'supervisors' && (
                <div className="flex flex-col gap-6">
                  {loadingSupervisors ? (
                    <div className="flex items-center justify-center py-16">
                      <div className="w-8 h-8 border-[3px] border-t-accent border-accent animate-spin rounded-full" />
                    </div>
                  ) : (
                    <>
                      {/* Header row */}
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-sm font-black text-ink uppercase tracking-tight">Leave Approval Supervisors</h3>
                          <p className="text-[10px] font-bold text-muted mt-1 uppercase tracking-widest">Supervisors assigned for this employee&apos;s leave requests</p>
                        </div>
                        {hasPermission('employee:manage') && !editingSupervisors && (
                          <button
                            onClick={async () => {
                              if (allEmployees.length === 0) {
                                const data = await apiFetch('/employees?limit=500&isActive=true').catch(() => ({ employees: [] }));
                                setAllEmployees((data.employees ?? []).filter((e: any) => e.id !== params.id));
                              }
                              setDraftSupervisors(supervisorData?.supervisors ?? []);
                              setDraftFlowType(supervisorData?.flowType ?? 'ANY_ONE');
                              setEditingSupervisors(true);
                            }}
                            className="px-5 py-2.5 text-[10px] font-black text-paper bg-accent hover:bg-accent uppercase tracking-widest transition-all"
                          >
                            Edit Supervisors
                          </button>
                        )}
                      </div>

                      {!editingSupervisors ? (
                        <>
                          {/* Flow type badge */}
                          <div className="flex items-center gap-3">
                            <span className="eyebrow-tight">Approval Flow:</span>
                            <span className={`text-[10px] font-black px-3 py-1  uppercase tracking-widest ${supervisorData?.flowType === 'SEQUENTIAL' ? 'bg-page text-ink border border-highlight' : 'bg-page text-accent border border-accent'}`}>
                              {supervisorData?.flowType === 'SEQUENTIAL' ? 'Sequential — Must approve in order' : 'Any One — Any supervisor can approve'}
                            </span>
                          </div>

                          {/* Supervisor list */}
                          {supervisorData?.supervisors && supervisorData.supervisors.length > 0 ? (
                            <div className="flex flex-col gap-3">
                              {supervisorData.supervisors.map((s: any, idx: number) => (
                                <div key={s.id} className="flex items-center gap-4 p-4 bg-page border border-rule">
                                  {supervisorData.flowType === 'SEQUENTIAL' && (
                                    <div className="w-8 h-8 bg-accent flex items-center justify-center text-paper text-xs font-black shrink-0">{s.order ?? idx + 1}</div>
                                  )}
                                  <div className="w-10 h-10 bg-shadow flex items-center justify-center text-[10px] font-black text-accent shrink-0">
                                    {s.fullName?.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-black text-ink uppercase tracking-tight">{s.fullName}</p>
                                    <p className="text-[10px] font-bold text-muted uppercase tracking-widest mt-0.5">{s.designation || '—'} · {s.department || '—'}</p>
                                  </div>
                                  <span className="label-form">{s.employeeCode}</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="py-12 flex flex-col items-center gap-3 bg-page border border-dashed border-rule">
                              <div className="w-12 h-12 bg-paper border-2 border-dashed border-rule flex items-center justify-center text-muted text-xl">👤</div>
                              <p className="eyebrow-tight">No supervisors assigned</p>
                              <p className="text-[9px] font-bold text-muted text-center max-w-xs">Only HR Admin / Super Admin can approve this employee&apos;s leave requests</p>
                            </div>
                          )}
                        </>
                      ) : (
                        /* ── Edit mode ─────────────────────────────────────── */
                        <div className="flex flex-col gap-5 bg-page border border-rule p-6">
                          {supervisorToast && (
                            <div className={`px-4 py-3  text-[10px] font-black uppercase tracking-widest ${supervisorToast.startsWith('Error') ? 'bg-page text-ink border border-ink' : 'bg-page text-accent border border-accent'}`}>
                              {supervisorToast}
                            </div>
                          )}

                          {/* Flow type selector */}
                          <div className="flex flex-col gap-2">
                            <label className="text-[10px] font-black text-muted uppercase tracking-widest">Approval Flow Type</label>
                            <div className="flex gap-3">
                              {(['ANY_ONE', 'SEQUENTIAL'] as const).map(ft => (
                                <button
                                  key={ft}
                                  onClick={() => setDraftFlowType(ft)}
                                  className={`flex-1 py-3 px-4  text-[10px] font-black uppercase tracking-widest border transition-all ${draftFlowType === ft ? 'bg-accent text-paper border-accent' : 'bg-paper text-muted border-rule hover:border-accent'}`}
                                >
                                  {ft === 'ANY_ONE' ? 'Any One' : 'Sequential'}
                                </button>
                              ))}
                            </div>
                            <p className="text-[9px] font-bold text-muted">
                              {draftFlowType === 'SEQUENTIAL' ? 'Supervisors must approve in listed order. Each step unlocks after the previous.' : 'Any single supervisor can approve the leave request.'}
                            </p>
                          </div>

                          {/* Supervisor entries */}
                          <div className="flex flex-col gap-2">
                            <label className="text-[10px] font-black text-muted uppercase tracking-widest">Supervisors</label>
                            {draftSupervisors.map((s: any, idx: number) => (
                              <div key={idx} className="flex items-center gap-3 bg-paper border border-rule p-3">
                                {draftFlowType === 'SEQUENTIAL' && (
                                  <span className="w-7 h-7 bg-page text-accent flex items-center justify-center text-xs font-black shrink-0">{idx + 1}</span>
                                )}
                                <select
                                  value={s.employeeId}
                                  onChange={e => {
                                    const chosen = allEmployees.find((em: any) => em.id === e.target.value);
                                    setDraftSupervisors(prev => prev.map((x, i) => i === idx ? { ...x, employeeId: e.target.value, fullName: chosen?.fullName, designation: chosen?.designation, department: chosen?.department, employeeCode: chosen?.employeeCode } : x));
                                  }}
                                  className="flex-1 bg-page border border-rule px-3 py-2 text-xs font-bold text-ink outline-none focus:border-accent"
                                >
                                  <option value="">— Select employee —</option>
                                  {allEmployees.map((em: any) => (
                                    <option key={em.id} value={em.id}>{em.fullName} ({em.employeeCode})</option>
                                  ))}
                                </select>
                                <button
                                  onClick={() => setDraftSupervisors(prev => prev.filter((_, i) => i !== idx))}
                                  className="w-7 h-7 flex items-center justify-center text-ink hover:text-ink hover:bg-page transition-all"
                                >✕</button>
                              </div>
                            ))}
                            <button
                              onClick={() => setDraftSupervisors(prev => [...prev, { employeeId: '', fullName: '', order: prev.length + 1 }])}
                              className="mt-1 py-2.5 bg-paper border border-dashed border-rule text-[10px] font-black text-muted hover:border-accent hover:text-accent uppercase tracking-widest transition-all"
                            >+ Add Supervisor</button>
                          </div>

                          {/* Action buttons */}
                          <div className="flex gap-3 pt-2">
                            <button
                              onClick={() => { setEditingSupervisors(false); setSupervisorToast(''); }}
                              className="flex-1 py-3 text-[10px] font-black text-muted border border-rule hover:bg-page uppercase tracking-widest transition-all"
                            >Cancel</button>
                            <button
                              onClick={async () => {
                                const validSups = draftSupervisors.filter(s => s.employeeId);
                                if (validSups.some(s => !s.employeeId)) return;
                                setSavingSupervisors(true);
                                setSupervisorToast('');
                                try {
                                  const updated = await apiFetch(`/employees/${params.id}/supervisors`, {
                                    method: 'PUT',
                                    body: JSON.stringify({
                                      flowType: draftFlowType,
                                      supervisors: validSups.map((s, i) => ({ employeeId: s.employeeId, order: i + 1 })),
                                    }),
                                  });
                                  setSupervisorData(updated);
                                  setEditingSupervisors(false);
                                  setSupervisorToast('Supervisors saved successfully');
                                  setTimeout(() => setSupervisorToast(''), 3000);
                                } catch (e: any) {
                                  setSupervisorToast(`Error: ${e.message}`);
                                } finally {
                                  setSavingSupervisors(false);
                                }
                              }}
                              disabled={savingSupervisors}
                              className="flex-1 py-3 text-[10px] font-black text-paper bg-accent hover:bg-accent disabled:opacity-50 uppercase tracking-widest transition-all"
                            >{savingSupervisors ? 'Saving…' : 'Save Supervisors'}</button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* ══ SALARY HISTORY ════════════════════════════════════════════════ */}
              {activeTab === 'salary' && (
                <div className="flex flex-col gap-6">

                  {/* Revision request modal */}
                  {showRevisionForm && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-shadow backdrop-">
                      <div className="w-full max-w-lg bg-paper p-8 flex flex-col gap-5">
                        <div className="flex items-center justify-between">
                          <div>
                            <h3 className="text-sm font-black text-ink uppercase tracking-tight">Request Salary Revision</h3>
                            <p className="text-[10px] font-bold text-muted mt-1">Creates a PENDING revision for HR Manager approval</p>
                          </div>
                          <button onClick={() => { setShowRevisionForm(false); setRevisionToast(''); }} className="text-muted hover:text-ink text-lg font-black">✕</button>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="flex flex-col gap-1.5">
                            <label className="label-form">New Monthly Salary (SGD)</label>
                            <input
                              type="number" min={0} step={100}
                              value={revForm.newSalary}
                              onChange={e => setRevForm(p => ({ ...p, newSalary: e.target.value }))}
                              className={IX} placeholder="e.g. 5500"
                            />
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <label className="label-form">Effective Date</label>
                            <input
                              type="date"
                              value={revForm.effectiveDate}
                              onChange={e => setRevForm(p => ({ ...p, effectiveDate: e.target.value }))}
                              className={IX}
                            />
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <label className="label-form">Reason Code</label>
                            <div className="relative">
                              <select value={revForm.reasonCode} onChange={e => setRevForm(p => ({ ...p, reasonCode: e.target.value }))} className={SX}>
                                {[
                                  { value: 'PROMOTION',         label: 'Promotion' },
                                  { value: 'ANNUAL_INCREMENT',  label: 'Annual Increment' },
                                  { value: 'MARKET_ADJUSTMENT', label: 'Market Adjustment' },
                                  { value: 'ROLE_CHANGE',       label: 'Role Change' },
                                  { value: 'CORRECTION',        label: 'Correction' },
                                  { value: 'OTHER',             label: 'Other' },
                                ].map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                              </select>
                              <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                            </div>
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <label className="label-form">Recommended By</label>
                            <input
                              type="text"
                              value={revForm.recommendedBy}
                              onChange={e => setRevForm(p => ({ ...p, recommendedBy: e.target.value }))}
                              className={IX} placeholder="Name or email"
                            />
                          </div>
                          <div className="flex flex-col gap-1.5 col-span-2">
                            <label className="label-form">Notes (optional)</label>
                            <textarea
                              rows={2}
                              value={revForm.notes}
                              onChange={e => setRevForm(p => ({ ...p, notes: e.target.value }))}
                              className={IX + ' resize-none'} placeholder="Justification, performance notes, etc."
                            />
                          </div>
                        </div>

                        {revisionToast && (
                          <div className={`px-4 py-2  text-[10px] font-black uppercase tracking-widest ${revisionToast.startsWith('Error') ? 'bg-page text-ink border border-ink' : 'bg-page text-accent border border-accent'}`}>
                            {revisionToast}
                          </div>
                        )}

                        <div className="flex gap-3 pt-1">
                          <button
                            onClick={() => { setShowRevisionForm(false); setRevisionToast(''); }}
                            className="flex-1 py-3 text-[10px] font-black text-muted border border-rule hover:bg-page uppercase tracking-widest"
                          >Cancel</button>
                          <button
                            disabled={submittingRevision || !revForm.newSalary || !revForm.effectiveDate}
                            onClick={async () => {
                              setSubmittingRevision(true);
                              setRevisionToast('');
                              try {
                                await apiFetch(`/employees/${params.id}/salary-revisions`, {
                                  method: 'POST',
                                  body: JSON.stringify(revForm),
                                });
                                setShowRevisionForm(false);
                                setRevForm({ newSalary: '', effectiveDate: '', reasonCode: 'PROMOTION', recommendedBy: '', notes: '' });
                                loadSalaryHistory();
                              } catch (e: any) {
                                setRevisionToast(`Error: ${e.message}`);
                              } finally { setSubmittingRevision(false); }
                            }}
                            className="flex-1 py-3 text-[10px] font-black text-paper bg-accent hover:bg-accent disabled:opacity-50 uppercase tracking-widest flex items-center justify-center gap-2"
                          >
                            {submittingRevision && <span className="w-3 h-3 border-2 border-paper/40 border-t-paper animate-spin rounded-full" />}
                            {submittingRevision ? 'Submitting…' : 'Submit for Approval'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Header row */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-1.5 h-4 bg-accent shrink-0" />
                      <h4 className="text-[10px] font-black text-muted uppercase tracking-[0.2em]">Salary Revision History</h4>
                    </div>
                    {hasPermission('employee:manage') && (
                      <button
                        onClick={() => { setShowRevisionForm(true); setRevisionToast(''); }}
                        className="px-4 py-2 text-[10px] font-black text-paper bg-accent hover:bg-accent uppercase tracking-widest transition-all"
                      >+ Request Revision</button>
                    )}
                  </div>

                  {/* Budget envelope card */}
                  {budgetEnvelope && budgetEnvelope.totalRevisions > 0 && (
                    <div className="grid grid-cols-3 gap-4">
                      {[
                        { label: `${budgetEnvelope.year} Revisions`, value: String(budgetEnvelope.totalRevisions), accent: 'text-accent', bg: 'bg-page border-accent' },
                        { label: 'Total Annual Cost Delta', value: `SGD ${Number(budgetEnvelope.totalAnnualDelta).toLocaleString('en-SG', { minimumFractionDigits: 2 })}`, accent: 'text-accent', bg: 'bg-page border-accent' },
                        { label: 'Monthly Impact', value: `SGD ${(budgetEnvelope.totalAnnualDelta / 12).toLocaleString('en-SG', { minimumFractionDigits: 2 })}`, accent: 'text-ink', bg: 'bg-page border-rule' },
                      ].map(kpi => (
                        <div key={kpi.label} className={`p-4  border ${kpi.bg} flex flex-col gap-1`}>
                          <span className="text-[9px] font-black text-muted uppercase tracking-widest">{kpi.label}</span>
                          <span className={`text-lg font-black font-mono ${kpi.accent}`}>{kpi.value}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Revision toast */}
                  {revisionToast && !showRevisionForm && (
                    <div className={`px-4 py-3  text-[10px] font-black uppercase tracking-widest ${revisionToast.startsWith('Error') ? 'bg-page text-ink border border-ink' : 'bg-page text-accent border border-accent'}`}>
                      {revisionToast}
                    </div>
                  )}

                  {/* History table */}
                  {loadingSalaryHistory ? (
                    <div className="flex flex-col gap-3">
                      {[1,2,3].map(i => <div key={i} className="h-16 bg-page animate-pulse" />)}
                    </div>
                  ) : salaryHistory.length === 0 ? (
                    <div className="py-16 text-center bg-page border border-dashed border-rule">
                      <p className="text-xs font-black text-muted uppercase tracking-widest">No salary revision history</p>
                      <p className="text-[10px] text-muted font-bold mt-1">Use &quot;Request Revision&quot; to create the first record</p>
                    </div>
                  ) : (
                    <div className="overflow-hidden border border-rule">
                      <table className="w-full text-left">
                        <thead>
                          <tr className="bg-page border-b border-rule label-form">
                            <th className="px-5 py-3">Effective Date</th>
                            <th className="px-5 py-3">Previous (SGD)</th>
                            <th className="px-5 py-3">New (SGD)</th>
                            <th className="px-5 py-3">Change</th>
                            <th className="px-5 py-3">Reason</th>
                            <th className="px-5 py-3">Recommended By</th>
                            <th className="px-5 py-3">Status</th>
                            {hasPermission('employee:manage') && <th className="px-5 py-3 text-right">Actions</th>}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-rule text-xs font-bold text-ink">
                          {salaryHistory.map((h: any, i: number) => {
                            const isPending = h.status === 'PENDING';
                            const isApproved = h.status === 'APPROVED';
                            const statusCls = isPending
                              ? 'bg-page text-ink border-highlight'
                              : isApproved
                              ? 'bg-page text-accent border-accent'
                              : 'bg-page text-ink border-ink';
                            const reasonLabel: Record<string,string> = {
                              PROMOTION: 'Promotion', ANNUAL_INCREMENT: 'Annual Increment',
                              MARKET_ADJUSTMENT: 'Market Adj.', ROLE_CHANGE: 'Role Change',
                              CORRECTION: 'Correction', OTHER: 'Other',
                            };
                            const fmt = (v: number | null) => v != null ? `$${Number(v).toLocaleString('en-SG', { minimumFractionDigits: 2 })}` : '—';
                            const pct = h.incrementPct;
                            const pctLabel = pct != null ? `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%` : null;
                            return (
                              <tr key={h.id ?? i} className="hover:bg-page transition-all">
                                <td className="px-5 py-3 font-black text-ink whitespace-nowrap">{fmtDate(h.effectiveDate)}</td>
                                <td className="px-5 py-3 font-mono text-muted">{fmt(h.previousSalary ?? h.basicSalary)}</td>
                                <td className="px-5 py-3 font-mono font-black text-accent">{fmt(h.newSalary)}</td>
                                <td className="px-5 py-3">
                                  {pctLabel ? (
                                    <span className={`text-[10px] font-black px-2 py-0.5  ${(pct ?? 0) >= 0 ? 'bg-page text-accent' : 'bg-page text-ink'}`}>{pctLabel}</span>
                                  ) : '—'}
                                </td>
                                <td className="px-5 py-3 text-muted">{reasonLabel[h.reasonCode] || h.changeReason || '—'}</td>
                                <td className="px-5 py-3 text-muted truncate max-w-[120px]">{h.recommendedBy || '—'}</td>
                                <td className="px-5 py-3">
                                  <div className="flex flex-col gap-1">
                                    <span className={`text-[9px] font-black px-2 py-0.5  border uppercase tracking-widest ${statusCls}`}>{h.status}</span>
                                    {h.catchUpAmount != null && h.catchUpAmount > 0 && (
                                      <span className="text-[8px] font-black text-ink uppercase">Catch-up: SGD {Number(h.catchUpAmount).toLocaleString('en-SG', { minimumFractionDigits: 2 })}</span>
                                    )}
                                  </div>
                                </td>
                                {hasPermission('employee:manage') && (
                                  <td className="px-5 py-3 text-right">
                                    {isPending && (
                                      <div className="flex gap-2 justify-end">
                                        <button
                                          onClick={async () => {
                                            try {
                                              const res = await apiFetch(`/employees/${params.id}/salary-revisions/${h.id}/approve`, { method: 'PUT', body: JSON.stringify({}) });
                                              const msg = res.salaryApplied ? 'Approved and salary applied' : 'Approved — salary will apply on effective date';
                                              setRevisionToast(msg);
                                              setTimeout(() => setRevisionToast(''), 4000);
                                              loadSalaryHistory();
                                            } catch (e: any) {
                                              setRevisionToast(`Error: ${e.message}`);
                                            }
                                          }}
                                          className="px-3 py-1.5 text-[9px] font-black text-accent bg-page border border-accent hover:bg-page uppercase tracking-widest transition-all"
                                        >Approve</button>
                                        <button
                                          onClick={async () => {
                                            try {
                                              await apiFetch(`/employees/${params.id}/salary-revisions/${h.id}/reject`, { method: 'PUT', body: JSON.stringify({}) });
                                              setRevisionToast('Revision rejected');
                                              setTimeout(() => setRevisionToast(''), 3000);
                                              loadSalaryHistory();
                                            } catch (e: any) {
                                              setRevisionToast(`Error: ${e.message}`);
                                            }
                                          }}
                                          className="px-3 py-1.5 text-[9px] font-black text-ink bg-page border border-ink hover:bg-page uppercase tracking-widest transition-all"
                                        >Reject</button>
                                      </div>
                                    )}
                                    {h.notes && (
                                      <p className="text-[9px] text-muted mt-1 text-right truncate max-w-[160px]" title={h.notes}>{h.notes}</p>
                                    )}
                                  </td>
                                )}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

            </div>
          </div>
        </div>

        {/* ── Right: Sidebar ─────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-6">

          {/* Financial nexus */}
          <section className="bg-shadow border border-shadow p-6">
            <h3 className="mb-5 text-[10px] font-black text-accent uppercase tracking-[0.2em] border-b border-shadow pb-3">Financial Nexus</h3>
            {(hasPermission('payroll:view') || hasPermission('employee:sensitive')) ? (
              <div className="flex flex-col gap-5">
                <div className="bg-shadow p-4 border border-shadow">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-[9px] font-black text-muted uppercase tracking-widest">Base Compensation</span>
                    <span className="text-[8px] font-black text-accent bg-accent px-2 py-0.5">Encrypted</span>
                  </div>
                  <p className="text-xl font-black text-paper font-mono">
                    {showSensitive ? `SGD ${emp.basicSalaryEncrypted ?? '—'}` : 'SGD ••••••'}
                  </p>
                </div>
                <div className="space-y-3">
                  <div className="flex justify-between text-[10px] font-bold uppercase border-b border-shadow pb-2">
                    <span className="text-muted">Bank</span>
                    <span className="text-muted">{emp.bankName ?? 'Not set'}</span>
                  </div>
                  <div className="flex justify-between text-[10px] font-bold uppercase">
                    <span className="text-muted">Account</span>
                    <span className="text-muted font-mono">{showSensitive ? emp.bankAccountEncrypted : '•••• ••'}</span>
                  </div>
                </div>
                <button onClick={() => setShowSensitive(s => !s)} className="w-full py-2.5 bg-shadow text-paper text-[9px] font-black uppercase tracking-[0.2em] hover:bg-muted transition-all border border-shadow">
                  {showSensitive ? 'Hide Sensitive Data' : 'Reveal Sensitive Data'}
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-6 text-center">
                <div className="w-12 h-12 bg-shadow flex items-center justify-center text-2xl mb-4 opacity-30">🔒</div>
                <p className="text-[10px] font-black text-muted uppercase tracking-widest leading-relaxed">Insufficient clearance<br />for financial data.</p>
              </div>
            )}
          </section>

        </div>
      </div>
    </div>
  );
}
