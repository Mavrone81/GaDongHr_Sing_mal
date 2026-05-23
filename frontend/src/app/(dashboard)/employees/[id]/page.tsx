'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { apiFetch } from '@/lib/api';
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

type Tab = 'general' | 'contracts' | 'statutory' | 'documents' | 'assets' | 'supervisors';

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
const IX = 'w-full bg-white border border-indigo-300 rounded-lg px-4 py-2.5 text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all placeholder:text-slate-400 placeholder:font-normal';
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
  return (
    <div className={`flex flex-col gap-1.5 ${spanCls}`}>
      <label className="label-form">{label}</label>
      {editing && children ? children : (
        <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 text-sm font-bold text-slate-900 min-h-[42px] flex items-center">
          {value != null && value !== '' ? value : <span className="text-slate-400 italic text-xs font-normal">Not provided</span>}
        </div>
      )}
    </div>
  );
}

// ─── Section wrapper ───────────────────────────────────────────────────────────
function Section({ title, accent = 'bg-indigo-600', children }: { title: string; accent?: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-5 flex items-center gap-3">
        <div className={`w-1.5 h-4 ${accent} rounded-full shrink-0`} />
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
      <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    </div>
  );
}

// ─── Entitlement bar ───────────────────────────────────────────────────────────
function EntitlementRow({ label, total, used, color = 'bg-indigo-600' }: { label: string; total: number; used: number; color?: string }) {
  const pct = total > 0 ? Math.round((used / total) * 100) : 0;
  return (
    <div className="flex flex-col gap-2 p-4 bg-slate-50 rounded-xl border border-slate-200">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-black text-slate-700 uppercase tracking-wider">{label}</span>
        <span className="text-[10px] font-black text-slate-400">{total - used} / {total} days left</span>
      </div>
      <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="flex justify-between text-[8px] font-black text-slate-400 uppercase tracking-widest">
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
  const [checklist, setChecklist] = useState([
    { id: 1, label: 'Employment Contract Signed', completed: true },
    { id: 2, label: 'Bank Details Provided', completed: true },
    { id: 3, label: 'NRIC / Work Pass Copy', completed: false },
    { id: 4, label: 'Equipment Handover', completed: false },
    { id: 5, label: 'Statutory Declaration', completed: false },
  ]);

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

  // Supervisors
  const [supervisorData, setSupervisorData] = useState<{ flowType: string; supervisors: any[] } | null>(null);
  const [loadingSupervisors, setLoadingSupervisors] = useState(false);
  const [supervisorToast, setSupervisorToast] = useState('');
  const [editingSupervisors, setEditingSupervisors] = useState(false);
  const [draftSupervisors, setDraftSupervisors] = useState<any[]>([]);
  const [draftFlowType, setDraftFlowType] = useState('ANY_ONE');
  const [allEmployees, setAllEmployees] = useState<any[]>([]);
  const [savingSupervisors, setSavingSupervisors] = useState(false);

  const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

  const fetchEmployee = useCallback(async () => {
    try {
      const token = document.cookie.split('vorkhive_token=')[1]?.split(';')[0];
      const headers = { 'Authorization': `Bearer ${token}` };
      let res = await fetch(`${apiBaseUrl}/employees/${params.id}`, { headers });
      if (!res.ok) res = await fetch(`${apiBaseUrl}/employees/code/${params.id}`, { headers });
      if (res.ok) setEmployee(await res.json());
    } catch (err) {
      console.error('Failed to fetch employee:', err);
    } finally {
      setLoading(false);
    }
  }, [params.id, apiBaseUrl]);

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
      const token = document.cookie.split('vorkhive_token=')[1]?.split(';')[0];
      const res = await fetch(`${apiBaseUrl}/employees/${employee.id}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(editData),
      });
      if (res.ok) {
        const updated = await res.json();
        setEmployee(updated);
        setIsEditing(false);
        setEditData({});
      } else {
        const body = await res.json().catch(() => ({}));
        setSaveError(body.message || `Save failed (${res.status})`);
      }
    } catch {
      setSaveError('Network error — changes not saved.');
    } finally {
      setSaving(false);
    }
  };

  // ── Derived values ─────────────────────────────────────────────────────────
  if (loading) return (
    <div className="p-20 text-center flex flex-col items-center gap-4">
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-600" />
      <p className="text-xs font-bold text-slate-400 uppercase tracking-widest animate-pulse">Syncing Employee Records…</p>
    </div>
  );
  if (!employee) return <div className="p-20 text-center text-red-600">Employee record not found.</div>;

  const emp = isEditing ? { ...employee, ...editData } : employee;
  const initials = emp.fullName.split(' ').map(n => n[0]).join('').toUpperCase();
  const completionRate = Math.round((checklist.filter(c => c.completed).length / checklist.length) * 100);
  const tenureMs = Date.now() - new Date(emp.startDate).getTime();
  const tenureYrs = (tenureMs / (1000 * 60 * 60 * 24 * 365.25)).toFixed(1);

  const alTotal = emp.annualLeaveEntitlement ?? 14;
  const alUsed = alTotal - (emp.annualLeaveBalance ?? alTotal);
  const slTotal = emp.sickLeaveEntitlement ?? 14;
  const slUsed = slTotal - (emp.sickLeaveBalance ?? slTotal);
  const clTotal = emp.childcareLeaveEntitlement ?? 6;

  const TABS: { key: Tab; label: string }[] = [
    { key: 'general', label: 'General Profile' },
    { key: 'contracts', label: 'Contracts & Entitlements' },
    { key: 'supervisors', label: 'Supervisors' },
    { key: 'assets', label: 'Assets' },
    { key: 'statutory', label: 'Statutory & Compliance' },
    { key: 'documents', label: 'Document Archive' },
  ];

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-6 max-w-[1600px] mx-auto pb-12">

      {/* Editing mode banner */}
      {isEditing && (
        <div className="flex items-center justify-between bg-indigo-600 px-6 py-3 rounded-xl shadow-lg shadow-indigo-500/20">
          <div className="flex items-center gap-3">
            <svg className="w-4 h-4 text-indigo-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            <span className="text-xs font-black text-white uppercase tracking-widest">Editing Mode — unsaved changes will be lost if you navigate away</span>
          </div>
          {saveError && (
            <span className="text-xs font-black text-red-200 bg-red-500/30 px-3 py-1 rounded-lg">{saveError}</span>
          )}
        </div>
      )}

      {/* Breadcrumb bar */}
      <div className="flex items-center justify-between bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-3">
          <Link href="/employees" className="text-[10px] font-black text-slate-500 hover:text-indigo-600 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded uppercase tracking-widest transition-all">
            ← Directory
          </Link>
          <span className="text-slate-300">/</span>
          <h2 className="text-sm font-black text-slate-800 uppercase tracking-widest">
            {emp.fullName}
            <span className="text-slate-400 font-bold ml-2">[{emp.employeeCode}]</span>
          </h2>
        </div>
        <div className="flex gap-3 items-center">
          <div className="hidden sm:flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
            <span className="eyebrow-tight">Profile Health:</span>
            <div className="w-24 h-1.5 bg-slate-200 rounded-full overflow-hidden">
              <div className="h-full bg-indigo-600 transition-all" style={{ width: `${completionRate}%` }} />
            </div>
            <span className="text-[10px] font-black text-indigo-600">{completionRate}%</span>
          </div>
          {hasPermission('employee:manage') && (
            !isEditing ? (
              <button onClick={startEditing} className="px-5 py-2 rounded-lg border border-slate-200 text-[10px] font-black text-slate-600 hover:bg-slate-50 shadow-sm transition-all uppercase tracking-widest">
                Edit Record
              </button>
            ) : (
              <div className="flex gap-2">
                <button onClick={cancelEditing} className="px-4 py-2 rounded-lg border border-slate-200 text-[10px] font-black text-slate-600 hover:bg-slate-50 transition-all uppercase tracking-widest">
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-5 py-2 rounded-lg text-[10px] font-black text-white bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-500/20 transition-all uppercase tracking-widest disabled:opacity-60 flex items-center gap-2"
                >
                  {saving && <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>}
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
          <section className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm flex items-start gap-8 relative overflow-hidden">
            <div className={`absolute top-0 left-0 w-1 h-full ${isEditing ? 'bg-amber-400' : 'bg-indigo-600'} transition-colors`} />
            <div className="h-28 w-28 rounded-3xl bg-slate-900 border-4 border-slate-800 shadow-2xl flex items-center justify-center shrink-0 relative overflow-hidden">
              {emp.profilePhotoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={emp.profilePhotoUrl} alt={emp.fullName} className="absolute inset-0 w-full h-full object-cover" />
              ) : (
                <span className="text-3xl font-black text-white">{initials}</span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="text-2xl font-black text-slate-900">{emp.fullName}</h3>
                {emp.preferredName && <span className="text-slate-400 font-bold text-sm">&quot;{emp.preferredName}&quot;</span>}
                <span className={`px-3 py-1 rounded-full text-[9px] font-black border uppercase tracking-widest ${emp.isActive ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                  {emp.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>
              <p className="text-sm font-bold text-slate-400 mt-1 uppercase tracking-widest">
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
                    <p className="text-xs font-bold text-slate-900 truncate">{val}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Tab panel */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            {/* Tab bar */}
            <div className="border-b border-slate-100 flex px-6 bg-slate-50/50 overflow-x-auto">
              {TABS.map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`py-4 px-4 text-[10px] font-black uppercase tracking-[0.18em] border-b-2 whitespace-nowrap transition-all mr-2 ${
                    activeTab === tab.key ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-400 hover:text-slate-600'
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

                  {/* ── Leave Entitlements (dynamic) ── */}
                  <section>
                    <div className="flex items-center justify-between mb-5">
                      <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] flex items-center gap-3">
                        <div className="w-1.5 h-4 bg-emerald-500 rounded-full shrink-0" />
                        Leave Entitlements — {new Date().getFullYear()}
                      </h4>
                      {Object.keys(entitlementEdits).length > 0 && (
                        <button
                          disabled={savingEntitlements}
                          onClick={async () => {
                            setSavingEntitlements(true);
                            try {
                              const payload = leaveEntitlements
                                .filter(e => !e.isUnlimited && entitlementEdits[e.leaveTypeId] !== undefined)
                                .map(e => ({ leaveTypeId: e.leaveTypeId, entitledDays: parseFloat(entitlementEdits[e.leaveTypeId] ?? e.entitledDays) || 0, carryForward: e.carryForward }));
                              await apiFetch(`/leave/entitlements/${params.id}`, {
                                method: 'PUT',
                                body: JSON.stringify({ year: new Date().getFullYear(), entitlements: payload }),
                              });
                              const updated = await apiFetch(`/leave/entitlements/${params.id}`);
                              setLeaveEntitlements(updated);
                              setEntitlementEdits({});
                              setEntitlementToast('Entitlements saved');
                              setTimeout(() => setEntitlementToast(''), 3000);
                            } catch (e: any) {
                              setEntitlementToast(e.message);
                              setTimeout(() => setEntitlementToast(''), 3000);
                            } finally { setSavingEntitlements(false); }
                          }}
                          className="px-4 py-2 text-[9px] font-black text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-xl uppercase tracking-widest transition-all"
                        >
                          {savingEntitlements ? 'Saving…' : 'Save Entitlements'}
                        </button>
                      )}
                    </div>
                    {entitlementToast && (
                      <div className="mb-4 px-4 py-2 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold rounded-xl">{entitlementToast}</div>
                    )}
                    {loadingEntitlements ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {[1,2,3,4].map(i => <div key={i} className="h-24 bg-slate-100 rounded-xl animate-pulse" />)}
                      </div>
                    ) : leaveEntitlements.length === 0 ? (
                      <div className="py-10 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200">
                        <p className="text-xs font-black text-slate-400 uppercase tracking-widest">No leave types configured</p>
                        <Link href="/leave/registry" className="mt-2 inline-block text-[10px] font-black text-indigo-600 hover:underline uppercase tracking-widest">Set up leave types →</Link>
                      </div>
                    ) : (
                      <>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                          {leaveEntitlements.map(e => {
                            const isUnlimited = e.isUnlimited;
                            const total = isUnlimited ? 0 : (parseFloat(entitlementEdits[e.leaveTypeId] ?? e.entitledDays) || 0);
                            const used = e.usedDays ?? 0;
                            const colors = ['bg-indigo-600','bg-emerald-500','bg-amber-500','bg-sky-500','bg-violet-500','bg-rose-500'];
                            const color = colors[leaveEntitlements.indexOf(e) % colors.length];
                            return (
                              <div key={e.leaveTypeId} className={`flex flex-col gap-2 p-4 rounded-xl border ${isUnlimited ? 'bg-slate-900 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
                                <div className="flex items-center justify-between">
                                  <div>
                                    <span className={`text-[10px] font-black uppercase tracking-wider ${isUnlimited ? 'text-slate-200' : 'text-slate-700'}`}>{e.name}</span>
                                    {isUnlimited && <span className="ml-2 text-[8px] font-black text-amber-400 uppercase tracking-widest">Unpaid · No Limit</span>}
                                  </div>
                                  {isUnlimited ? (
                                    <span className="text-sm font-black text-amber-400">∞</span>
                                  ) : (
                                    <div className="flex items-center gap-2">
                                      <input
                                        type="number" min={0} max={365} step={0.5}
                                        value={entitlementEdits[e.leaveTypeId] ?? e.entitledDays}
                                        onChange={ev => setEntitlementEdits(p => ({ ...p, [e.leaveTypeId]: ev.target.value }))}
                                        className="w-16 text-center text-xs font-black text-slate-800 bg-white border border-slate-300 rounded-lg px-2 py-1 focus:outline-none focus:border-indigo-400"
                                      />
                                      <span className="text-[9px] font-black text-slate-400">days</span>
                                    </div>
                                  )}
                                </div>
                                <div className={`w-full h-2 rounded-full overflow-hidden ${isUnlimited ? 'bg-slate-700' : 'bg-slate-200'}`}>
                                  {!isUnlimited && <div className={`h-full rounded-full ${color}`} style={{ width: total > 0 ? `${Math.min(100, Math.round((used / total) * 100))}%` : '0%' }} />}
                                </div>
                                <div className={`flex justify-between text-[8px] font-black uppercase tracking-widest ${isUnlimited ? 'text-slate-500' : 'text-slate-400'}`}>
                                  <span>Used: {used} days</span>
                                  {isUnlimited
                                    ? <span className="text-amber-500">Payroll deducts automatically</span>
                                    : <span>Balance: {Math.max(0, total - used - (e.pendingDays ?? 0))} days</span>
                                  }
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        <div className="overflow-hidden border border-slate-200 rounded-xl">
                          <table className="w-full text-left">
                            <thead>
                              <tr className="bg-slate-50 border-b border-slate-200 label-form">
                                <th className="px-5 py-3">Leave Type</th>
                                <th className="px-5 py-3">Entitlement</th>
                                <th className="px-5 py-3">Used</th>
                                <th className="px-5 py-3">Pending</th>
                                <th className="px-5 py-3">Carry Fwd</th>
                                <th className="px-5 py-3">Balance</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 text-xs font-bold text-slate-700">
                              {leaveEntitlements.map(e => {
                                const isUnlimited = e.isUnlimited;
                                const ent = isUnlimited ? null : (parseFloat(entitlementEdits[e.leaveTypeId] ?? e.entitledDays) || 0);
                                const balance = isUnlimited ? null : Math.max(0, (ent ?? 0) + (e.carryForward ?? 0) - (e.usedDays ?? 0) - (e.pendingDays ?? 0));
                                return (
                                  <tr key={e.leaveTypeId} className="hover:bg-slate-50 transition-all">
                                    <td className="px-5 py-3">
                                      <div className="flex flex-col gap-0.5">
                                        <span className="font-black text-slate-800">{e.name}</span>
                                        <span className="text-[9px] font-black text-slate-400 uppercase">{e.code} · {e.isPaid ? 'Paid' : 'Unpaid'}</span>
                                      </div>
                                    </td>
                                    <td className="px-5 py-3">
                                      {isUnlimited
                                        ? <span className="text-[9px] font-black px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-100 uppercase">No Limit</span>
                                        : `${ent} days`
                                      }
                                    </td>
                                    <td className="px-5 py-3">{e.usedDays ?? 0} days</td>
                                    <td className="px-5 py-3 text-amber-600">{e.pendingDays ?? 0} days</td>
                                    <td className="px-5 py-3">{isUnlimited ? '—' : `${e.carryForward ?? 0} days`}</td>
                                    <td className="px-5 py-3">
                                      {isUnlimited
                                        ? <span className="text-[9px] font-black text-amber-600 uppercase">Unlimited</span>
                                        : <span className={`font-black ${(balance ?? 0) > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>{balance} days</span>
                                      }
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                  </section>

                  <Section title="Compensation" accent="bg-violet-500">
                    <div className="flex flex-col gap-1.5">
                      <label className="label-form">Basic Salary (SGD)</label>
                      {isEditing ? (
                        <input type="text" value={editData.basicSalaryEncrypted ?? ''} onChange={e => set('basicSalaryEncrypted', e.target.value)} className={IX} placeholder="e.g. 5000" />
                      ) : (
                        <div className="bg-slate-900 border border-slate-800 rounded-lg px-4 py-2.5 text-sm font-bold text-indigo-400 flex items-center justify-between min-h-[42px]">
                          <span className="font-mono">{showSensitive ? `SGD ${emp.basicSalaryEncrypted ?? '—'}` : 'SGD ••••••'}</span>
                          <button onClick={() => setShowSensitive(s => !s)} className="text-[9px] font-black text-indigo-400/60 hover:text-indigo-400 uppercase ml-4 shrink-0">{showSensitive ? 'Hide' : 'Reveal'}</button>
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
                  <section className="bg-slate-50 p-8 rounded-2xl border border-dashed border-slate-300">
                    <div className="flex items-center justify-between mb-8">
                      <div>
                        <h4 className="text-[11px] font-black text-slate-900 uppercase tracking-widest">CPF Contribution Configuration</h4>
                        <p className="text-[10px] text-slate-500 font-bold uppercase mt-1">Central Provident Fund Board statutory rates</p>
                      </div>
                      <div className="flex items-center gap-2 px-3 py-1 bg-white border border-slate-200 rounded-full">
                        <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                        <span className="text-[9px] font-black text-emerald-600 uppercase">Computed Active</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div className="space-y-4">
                        {[
                          { label: 'Enable Ordinary Wages (OW) Calc', sub: 'Subject to $6,000 ceiling' },
                          { label: 'Enable Additional Wages (AW) Calc', sub: 'Annual ceiling formula protection' },
                        ].map(opt => (
                          <label key={opt.label} className="flex items-center gap-4 cursor-pointer p-4 bg-white rounded-xl border border-slate-200 hover:border-indigo-600 transition-all">
                            <input type="checkbox" defaultChecked className="w-5 h-5 text-indigo-600 rounded-md border-slate-300" />
                            <div>
                              <p className="text-xs font-black text-slate-900 uppercase">{opt.label}</p>
                              <p className="text-[9px] text-slate-400 font-bold uppercase mt-0.5">{opt.sub}</p>
                            </div>
                          </label>
                        ))}
                      </div>
                      <div className="bg-white p-6 rounded-xl border border-slate-200">
                        <label className="label-form block mb-4">Citizenship Category</label>
                        <div className="flex flex-col gap-3">
                          {[
                            { label: 'SC / SPR 3rd Year+', note: 'Full rates', active: true },
                            { label: 'SPR Year 1 / 2', note: 'Graduated rates', active: false },
                            { label: 'Foreigner', note: 'No CPF', active: false },
                          ].map(opt => (
                            <button key={opt.label} className={`flex justify-between px-4 py-2.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${opt.active ? 'bg-indigo-600 text-white' : 'border border-slate-200 text-slate-400 hover:border-indigo-600 hover:text-indigo-600'}`}>
                              <span>{opt.label}</span>
                              <span className="opacity-70">{opt.note}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </section>
                  <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-indigo-50/50 p-6 rounded-2xl border border-indigo-100">
                      <h4 className="text-[10px] font-black text-indigo-700 uppercase tracking-widest mb-4">SDL Management</h4>
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input type="checkbox" defaultChecked className="w-5 h-5 text-indigo-600 rounded-md" />
                        <span className="text-[11px] font-black text-slate-700 uppercase">Apply Skills Development Levy (0.25%)</span>
                      </label>
                      <p className="text-[9px] text-indigo-400 font-bold uppercase mt-3 leading-relaxed">Capped at SGD 11.25 per month.</p>
                    </div>
                    <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800">
                      <h4 className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-4">Tax & IR8A AIS Integration</h4>
                      <p className="text-[10px] text-slate-400 font-bold uppercase leading-relaxed mb-4">Auto-include in AIS reporting for IRAS.</p>
                      <div className="flex gap-2">
                        <span className="text-[9px] font-black px-2 py-0.5 bg-indigo-600 text-white rounded">IRAS-READY</span>
                        <span className="text-[9px] font-black px-2 py-0.5 bg-slate-800 text-slate-400 rounded">AIS-2026</span>
                      </div>
                    </div>
                  </section>
                </div>
              )}

              {/* ══ ASSETS ═══════════════════════════════════════════════════════ */}
              {activeTab === 'assets' && (
                <div className="flex flex-col gap-6">
                  {assetToast && (
                    <div className="px-4 py-3 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold rounded-xl">{assetToast}</div>
                  )}

                  {/* Assign new asset */}
                  <section>
                    <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4 flex items-center gap-3">
                      <div className="w-1.5 h-4 bg-teal-500 rounded-full shrink-0" />
                      Assign Asset
                    </h4>
                    <div className="flex gap-3">
                      <select
                        value={assignAssetId}
                        onChange={e => setAssignAssetId(e.target.value)}
                        className="flex-1 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-teal-500"
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
                        className="px-5 py-2.5 text-[10px] font-black text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 rounded-xl uppercase tracking-widest transition-all"
                      >
                        {assigningAsset ? 'Assigning…' : 'Assign'}
                      </button>
                    </div>
                    {allAssets.length === 0 && !loadingAssets && (
                      <p className="text-xs text-slate-400 font-bold mt-2">No available assets. <a href="/assets" className="text-teal-600 hover:underline">Register assets first →</a></p>
                    )}
                  </section>

                  {/* Assigned assets list */}
                  <section>
                    <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4 flex items-center gap-3">
                      <div className="w-1.5 h-4 bg-teal-500 rounded-full shrink-0" />
                      Currently Assigned ({empAssets.length})
                    </h4>
                    {loadingAssets ? (
                      <div className="flex flex-col gap-2">{[1,2].map(i => <div key={i} className="h-14 bg-slate-100 rounded-xl animate-pulse" />)}</div>
                    ) : empAssets.length === 0 ? (
                      <div className="py-10 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200">
                        <p className="text-xs font-black text-slate-400 uppercase tracking-widest">No assets assigned to this employee</p>
                      </div>
                    ) : (
                      <div className="overflow-hidden border border-slate-200 rounded-xl">
                        <table className="w-full text-left">
                          <thead>
                            <tr className="bg-slate-50 border-b border-slate-200 label-form">
                              <th className="px-5 py-3">Asset</th>
                              <th className="px-5 py-3">Category</th>
                              <th className="px-5 py-3">Assigned</th>
                              <th className="px-5 py-3">Value</th>
                              <th className="px-5 py-3 text-right">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 text-xs font-bold text-slate-700">
                            {empAssets.map(a => (
                              <tr key={a.id} className="hover:bg-slate-50 transition-all">
                                <td className="px-5 py-3">
                                  <div className="flex flex-col">
                                    <span className="font-black text-slate-800">{a.name}</span>
                                    <span className="text-[9px] font-black text-slate-400 uppercase">{a.assetCode}</span>
                                  </div>
                                </td>
                                <td className="px-5 py-3 text-slate-500 uppercase text-[10px]">{a.category}</td>
                                <td className="px-5 py-3 text-slate-400 text-[10px]">
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
                                    className="px-3 py-1.5 text-[9px] font-black text-red-600 bg-red-50 border border-red-100 rounded-lg hover:bg-red-100 uppercase tracking-widest disabled:opacity-50 transition-all"
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
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
                      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-8 flex flex-col gap-5">
                        <div className="flex items-center justify-between">
                          <h3 className="text-sm font-black text-slate-900">Upload Document</h3>
                          <button onClick={() => { setUploadOpen(false); setUploadFile(null); setUploadError(''); }} className="text-slate-400 hover:text-slate-700 text-lg font-black">✕</button>
                        </div>
                        <div>
                          <label className="label-form block mb-2">File</label>
                          <label className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-xl py-6 cursor-pointer transition-all ${uploadFile ? 'border-indigo-300 bg-indigo-50/40' : 'border-slate-200 hover:border-indigo-300'}`}>
                            <svg className={`w-6 h-6 ${uploadFile ? 'text-indigo-500' : 'text-slate-300'}`} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>
                            <span className="text-[10px] font-bold text-slate-500">{uploadFile ? uploadFile.name : 'Click to select file (max 10 MB)'}</span>
                            <input type="file" className="hidden" onChange={e => setUploadFile(e.target.files?.[0] ?? null)} />
                          </label>
                        </div>
                        <div>
                          <label className="label-form block mb-2">Document Type</label>
                          <select value={uploadDocType} onChange={e => setUploadDocType(e.target.value)} className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 bg-slate-50 outline-none focus:border-indigo-500 appearance-none">
                            <option value="CONTRACT">Employment Contract</option>
                            <option value="NRIC_COPY">NRIC / FIN Copy</option>
                            <option value="EMPLOYMENT_PASS">Employment / Work Pass</option>
                            <option value="CERT">Certificate / Qualification</option>
                            <option value="OTHER">Other</option>
                          </select>
                        </div>
                        <div>
                          <label className="label-form block mb-2">Expiry Date <span className="normal-case font-bold">(optional)</span></label>
                          <input type="date" value={uploadExpiry} onChange={e => setUploadExpiry(e.target.value)} className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 bg-slate-50 outline-none focus:border-indigo-500" />
                        </div>
                        {uploadError && <p className="text-[11px] font-bold text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">{uploadError}</p>}
                        <div className="flex gap-3">
                          <button onClick={() => { setUploadOpen(false); setUploadFile(null); setUploadError(''); }} className="flex-1 px-4 py-2.5 border border-slate-200 rounded-xl text-[10px] font-black text-slate-600 uppercase tracking-widest hover:bg-slate-50">Cancel</button>
                          <button
                            disabled={!uploadFile || uploading}
                            onClick={async () => {
                              if (!uploadFile) return;
                              setUploading(true); setUploadError('');
                              try {
                                const { getAccessToken } = await import('@/lib/api');
                                const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
                                const form = new FormData();
                                form.append('file', uploadFile);
                                form.append('docType', uploadDocType);
                                if (uploadExpiry) form.append('expiryDate', uploadExpiry);
                                const res = await fetch(`${apiBase}/documents/employee/${params.id}`, {
                                  method: 'POST',
                                  headers: { Authorization: `Bearer ${getAccessToken()}` },
                                  body: form,
                                });
                                if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Upload failed'); }
                                setUploadOpen(false); setUploadFile(null); setUploadExpiry(''); setUploadDocType('OTHER');
                                loadDocuments();
                              } catch (e: any) { setUploadError(e.message); }
                              finally { setUploading(false); }
                            }}
                            className="flex-1 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2"
                          >
                            {uploading && <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
                            {uploading ? 'Uploading…' : 'Upload'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="flex justify-between items-center">
                    <h4 className="eyebrow-tight">Secure Document Archive</h4>
                    <button onClick={() => { setUploadOpen(true); setUploadError(''); }} className="text-[10px] font-black uppercase text-indigo-600 bg-indigo-50 px-4 py-2 rounded-lg hover:bg-indigo-100 transition-all">+ Upload Document</button>
                  </div>

                  {docsLoading ? (
                    <div className="py-12 flex items-center justify-center gap-3 text-slate-400 text-xs font-bold">
                      <span className="w-4 h-4 border-2 border-slate-200 border-t-slate-400 rounded-full animate-spin" /> Loading documents…
                    </div>
                  ) : documents.length === 0 ? (
                    <div className="py-14 flex flex-col items-center gap-3 text-center opacity-40">
                      <span className="text-3xl">📄</span>
                      <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">No documents uploaded yet</p>
                    </div>
                  ) : (
                    <div className="overflow-hidden border border-slate-200 rounded-2xl shadow-sm">
                      <table className="w-full text-left">
                        <thead>
                          <tr className="bg-slate-50 label-form border-b border-slate-200">
                            <th className="px-6 py-4">Document</th>
                            <th className="px-6 py-4">Type</th>
                            <th className="px-6 py-4">Uploaded</th>
                            <th className="px-6 py-4">Expiry</th>
                            <th className="px-6 py-4 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-xs">
                          {documents.map(doc => {
                            const ext = doc.fileName.split('.').pop()?.toUpperCase() ?? 'FILE';
                            const isImg = doc.mimeType?.startsWith('image/');
                            const isPdf = doc.mimeType === 'application/pdf';
                            const extColor = isPdf ? 'bg-red-50 text-red-500' : isImg ? 'bg-blue-50 text-blue-500' : 'bg-slate-50 text-slate-500';
                            const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
                            return (
                              <tr key={doc.id} className="hover:bg-slate-50/50 transition-all">
                                <td className="px-6 py-4">
                                  <div className="flex items-center gap-3">
                                    <div className={`w-8 h-8 rounded flex items-center justify-center font-black text-[9px] ${extColor}`}>{ext}</div>
                                    <span className="font-bold text-slate-900 truncate max-w-[200px]">{doc.fileName}</span>
                                  </div>
                                </td>
                                <td className="px-6 py-4">
                                  <span className="text-[9px] font-black uppercase text-slate-500 border border-slate-200 px-2 py-0.5 rounded">
                                    {doc.docType.replace(/_/g, ' ')}
                                  </span>
                                </td>
                                <td className="px-6 py-4 text-slate-400 font-bold text-[10px]">
                                  {new Date(doc.createdAt).toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' })}
                                </td>
                                <td className="px-6 py-4 text-[10px] font-bold">
                                  {doc.expiryDate ? (
                                    <span className={new Date(doc.expiryDate) < new Date() ? 'text-red-500' : 'text-slate-400'}>
                                      {new Date(doc.expiryDate).toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' })}
                                    </span>
                                  ) : <span className="text-slate-300">Permanent</span>}
                                </td>
                                <td className="px-6 py-4 text-right flex items-center justify-end gap-3">
                                  <button
                                    onClick={async () => {
                                      try {
                                        const { getAccessToken: tok } = await import('@/lib/api');
                                        const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
                                        const res = await fetch(`${apiBase}/documents/${doc.id}/download`, {
                                          headers: { Authorization: `Bearer ${tok()}` },
                                        });
                                        if (!res.ok) throw new Error();
                                        const blob = await res.blob();
                                        const url = URL.createObjectURL(blob);
                                        window.open(url, '_blank');
                                        setTimeout(() => URL.revokeObjectURL(url), 60000);
                                      } catch { alert('Could not load document.'); }
                                    }}
                                    className="text-indigo-600 hover:underline font-black uppercase text-[9px]"
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
                                    className="text-red-400 hover:text-red-600 hover:underline font-black uppercase text-[9px]"
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
                      <div className="w-8 h-8 border-[3px] border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
                    </div>
                  ) : (
                    <>
                      {/* Header row */}
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">Leave Approval Supervisors</h3>
                          <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-widest">Supervisors assigned for this employee&apos;s leave requests</p>
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
                            className="px-5 py-2.5 text-[10px] font-black text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl uppercase tracking-widest transition-all"
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
                            <span className={`text-[10px] font-black px-3 py-1 rounded-lg uppercase tracking-widest ${supervisorData?.flowType === 'SEQUENTIAL' ? 'bg-amber-50 text-amber-700 border border-amber-100' : 'bg-indigo-50 text-indigo-700 border border-indigo-100'}`}>
                              {supervisorData?.flowType === 'SEQUENTIAL' ? 'Sequential — Must approve in order' : 'Any One — Any supervisor can approve'}
                            </span>
                          </div>

                          {/* Supervisor list */}
                          {supervisorData?.supervisors && supervisorData.supervisors.length > 0 ? (
                            <div className="flex flex-col gap-3">
                              {supervisorData.supervisors.map((s: any, idx: number) => (
                                <div key={s.id} className="flex items-center gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                                  {supervisorData.flowType === 'SEQUENTIAL' && (
                                    <div className="w-8 h-8 bg-indigo-600 rounded-full flex items-center justify-center text-white text-xs font-black shrink-0">{s.order ?? idx + 1}</div>
                                  )}
                                  <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center text-[10px] font-black text-indigo-400 shrink-0">
                                    {s.fullName?.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-black text-slate-900 uppercase tracking-tight">{s.fullName}</p>
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">{s.designation || '—'} · {s.department || '—'}</p>
                                  </div>
                                  <span className="label-form">{s.employeeCode}</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="py-12 flex flex-col items-center gap-3 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                              <div className="w-12 h-12 bg-white border-2 border-dashed border-slate-200 rounded-2xl flex items-center justify-center text-slate-300 text-xl">👤</div>
                              <p className="eyebrow-tight">No supervisors assigned</p>
                              <p className="text-[9px] font-bold text-slate-300 text-center max-w-xs">Only HR Admin / Super Admin can approve this employee&apos;s leave requests</p>
                            </div>
                          )}
                        </>
                      ) : (
                        /* ── Edit mode ─────────────────────────────────────── */
                        <div className="flex flex-col gap-5 bg-slate-50 rounded-2xl border border-slate-200 p-6">
                          {supervisorToast && (
                            <div className={`px-4 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest ${supervisorToast.startsWith('Error') ? 'bg-red-50 text-red-600 border border-red-100' : 'bg-emerald-50 text-emerald-700 border border-emerald-100'}`}>
                              {supervisorToast}
                            </div>
                          )}

                          {/* Flow type selector */}
                          <div className="flex flex-col gap-2">
                            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Approval Flow Type</label>
                            <div className="flex gap-3">
                              {(['ANY_ONE', 'SEQUENTIAL'] as const).map(ft => (
                                <button
                                  key={ft}
                                  onClick={() => setDraftFlowType(ft)}
                                  className={`flex-1 py-3 px-4 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${draftFlowType === ft ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-500 border-slate-200 hover:border-indigo-200'}`}
                                >
                                  {ft === 'ANY_ONE' ? 'Any One' : 'Sequential'}
                                </button>
                              ))}
                            </div>
                            <p className="text-[9px] font-bold text-slate-400">
                              {draftFlowType === 'SEQUENTIAL' ? 'Supervisors must approve in listed order. Each step unlocks after the previous.' : 'Any single supervisor can approve the leave request.'}
                            </p>
                          </div>

                          {/* Supervisor entries */}
                          <div className="flex flex-col gap-2">
                            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Supervisors</label>
                            {draftSupervisors.map((s: any, idx: number) => (
                              <div key={idx} className="flex items-center gap-3 bg-white rounded-xl border border-slate-200 p-3">
                                {draftFlowType === 'SEQUENTIAL' && (
                                  <span className="w-7 h-7 bg-indigo-100 text-indigo-700 rounded-full flex items-center justify-center text-xs font-black shrink-0">{idx + 1}</span>
                                )}
                                <select
                                  value={s.employeeId}
                                  onChange={e => {
                                    const chosen = allEmployees.find((em: any) => em.id === e.target.value);
                                    setDraftSupervisors(prev => prev.map((x, i) => i === idx ? { ...x, employeeId: e.target.value, fullName: chosen?.fullName, designation: chosen?.designation, department: chosen?.department, employeeCode: chosen?.employeeCode } : x));
                                  }}
                                  className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold text-slate-900 outline-none focus:border-indigo-500"
                                >
                                  <option value="">— Select employee —</option>
                                  {allEmployees.map((em: any) => (
                                    <option key={em.id} value={em.id}>{em.fullName} ({em.employeeCode})</option>
                                  ))}
                                </select>
                                <button
                                  onClick={() => setDraftSupervisors(prev => prev.filter((_, i) => i !== idx))}
                                  className="w-7 h-7 flex items-center justify-center text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                                >✕</button>
                              </div>
                            ))}
                            <button
                              onClick={() => setDraftSupervisors(prev => [...prev, { employeeId: '', fullName: '', order: prev.length + 1 }])}
                              className="mt-1 py-2.5 bg-white border border-dashed border-slate-300 text-[10px] font-black text-slate-400 rounded-xl hover:border-indigo-300 hover:text-indigo-600 uppercase tracking-widest transition-all"
                            >+ Add Supervisor</button>
                          </div>

                          {/* Action buttons */}
                          <div className="flex gap-3 pt-2">
                            <button
                              onClick={() => { setEditingSupervisors(false); setSupervisorToast(''); }}
                              className="flex-1 py-3 text-[10px] font-black text-slate-500 border border-slate-200 rounded-xl hover:bg-slate-100 uppercase tracking-widest transition-all"
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
                              className="flex-1 py-3 text-[10px] font-black text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-xl uppercase tracking-widest transition-all"
                            >{savingSupervisors ? 'Saving…' : 'Save Supervisors'}</button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

            </div>
          </div>
        </div>

        {/* ── Right: Sidebar ─────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-6">

          {/* Onboarding checklist */}
          <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 relative overflow-hidden">
            <div className="absolute top-0 right-0 text-indigo-600 font-black text-[9px] uppercase tracking-widest px-2 py-1 border-b border-l border-indigo-100 bg-indigo-600/5 rounded-bl-xl">Lifecycle</div>
            <h3 className="mb-5 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-100 pb-3">Onboarding Compliance</h3>
            <div className="flex flex-col gap-1.5">
              {checklist.map(item => (
                <button
                  key={item.id}
                  onClick={() => setChecklist(checklist.map(c => c.id === item.id ? { ...c, completed: !c.completed } : c))}
                  className={`flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${item.completed ? 'bg-indigo-50/50 border-indigo-100' : 'border-slate-100 hover:border-indigo-300'}`}
                >
                  <div className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-all ${item.completed ? 'bg-indigo-600 border-indigo-600 shadow-lg shadow-indigo-500/20' : 'bg-white border-slate-200'}`}>
                    {item.completed && <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>}
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className={`text-[10px] font-black uppercase tracking-tight truncate ${item.completed ? 'text-slate-900' : 'text-slate-400'}`}>{item.label}</span>
                    <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">{item.completed ? 'Verified' : 'Pending'}</span>
                  </div>
                </button>
              ))}
            </div>
          </section>

          {/* Leave snapshot */}
          <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
            <h3 className="mb-5 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-100 pb-3">Leave Snapshot</h3>
            <div className="flex flex-col gap-3">
              {[
                { label: 'Annual Leave', bal: alTotal - alUsed, total: alTotal },
                { label: 'Sick Leave', bal: slTotal - slUsed, total: slTotal },
                { label: 'Childcare', bal: clTotal, total: clTotal },
              ].map(item => (
                <div key={item.label} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <span className="text-[10px] font-black text-slate-600 uppercase tracking-wider">{item.label}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-black text-slate-900">{item.bal}</span>
                    <span className="text-[9px] font-bold text-slate-400">/ {item.total} days</span>
                  </div>
                </div>
              ))}
              <button onClick={() => setActiveTab('contracts')} className="w-full mt-1 py-2 text-[9px] font-black text-indigo-600 border border-indigo-100 bg-indigo-50 rounded-xl hover:bg-indigo-100 uppercase tracking-widest transition-all">
                View All Entitlements →
              </button>
            </div>
          </section>

          {/* Financial nexus */}
          <section className="bg-slate-900 rounded-2xl border border-slate-800 shadow-xl p-6">
            <h3 className="mb-5 text-[10px] font-black text-indigo-400 uppercase tracking-[0.2em] border-b border-slate-800 pb-3">Financial Nexus</h3>
            {(hasPermission('payroll:view') || hasPermission('employee:sensitive')) ? (
              <div className="flex flex-col gap-5">
                <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700/50">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Base Compensation</span>
                    <span className="text-[8px] font-black text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded">Encrypted</span>
                  </div>
                  <p className="text-xl font-black text-white font-mono">
                    {showSensitive ? `SGD ${emp.basicSalaryEncrypted ?? '—'}` : 'SGD ••••••'}
                  </p>
                </div>
                <div className="space-y-3">
                  <div className="flex justify-between text-[10px] font-bold uppercase border-b border-slate-800 pb-2">
                    <span className="text-slate-500">Bank</span>
                    <span className="text-slate-300">{emp.bankName ?? 'Not set'}</span>
                  </div>
                  <div className="flex justify-between text-[10px] font-bold uppercase">
                    <span className="text-slate-500">Account</span>
                    <span className="text-slate-300 font-mono">{showSensitive ? emp.bankAccountEncrypted : '•••• ••'}</span>
                  </div>
                </div>
                <button onClick={() => setShowSensitive(s => !s)} className="w-full py-2.5 bg-slate-800 text-white text-[9px] font-black uppercase tracking-[0.2em] rounded-xl hover:bg-slate-700 transition-all border border-slate-700">
                  {showSensitive ? 'Hide Sensitive Data' : 'Reveal Sensitive Data'}
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-6 text-center">
                <div className="w-12 h-12 bg-slate-800 rounded-full flex items-center justify-center text-2xl mb-4 opacity-30">🔒</div>
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest leading-relaxed">Insufficient clearance<br />for financial data.</p>
              </div>
            )}
          </section>

        </div>
      </div>
    </div>
  );
}
