'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { apiFetch, apiFetchRaw } from '@/lib/api';
import { CountrySelect } from '@/components/employee/CountrySelect';
import { DatePicker } from '@/components/employee/DatePicker';
import { PostalLookup } from '@/components/employee/PostalLookup';
import {
  Badge, Button, Card, CardHeader, EmptyState, Field as FormField, Icon, Input, Modal, Select, Stat, Tabs, Textarea,
} from '@/components/ui';
import { KeyValue, Notice, PageLoading, PersonAvatar, Spinner } from '@/components/employee/RecordParts';

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
// Same look as the kit's Input/Select; kept as class strings because the edit
// form renders plain <input>/<select> elements inline.
const IX = 'w-full h-[42px] px-3 rounded-control border border-rule bg-paper text-sm text-ink outline-none transition-colors placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/20';
const SX = IX + ' cursor-pointer appearance-none pr-9';

// Format Prisma enum values into readable labels for display
function fmtEnum(v?: string | null) {
  if (!v) return '';
  const s = v.replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
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
  const spanCls = span === '2' ? 'sm:col-span-2' : span === '3' ? 'col-span-full' : '';
  const isEmpty = value == null || value === '' || value === '—' || value === '****';
  // When viewing (not editing), don't render fields with no value — e.g. data the
  // viewer isn't allowed to see (PDPA-masked) or that simply wasn't provided.
  if (!editing && isEmpty) return null;
  return (
    <div className={`flex flex-col gap-1.5 min-w-0 ${spanCls}`}>
      <span className="text-[12.5px] font-semibold text-muted">{label}</span>
      {editing && children ? children : (
        <div className="text-sm text-ink break-words">
          {value != null && value !== '' ? value : <span className="text-muted">Not provided</span>}
        </div>
      )}
    </div>
  );
}

// ─── Section wrapper ───────────────────────────────────────────────────────────
// `accent` is accepted for older call sites; the card look no longer uses it.
function Section({ title, children }: { title: string; accent?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} className="mb-4" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 items-start">
        {children}
      </div>
    </Card>
  );
}

// ─── Select helper ─────────────────────────────────────────────────────────────
type SelOption = string | { value: string; label: string };
function Sel({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: SelOption[] }) {
  return (
    <div className="relative">
      <select value={value} onChange={e => onChange(e.target.value)} className={SX}>
        <option value="">Select…</option>
        {options.map(o => {
          const v = typeof o === 'string' ? o : o.value;
          const l = typeof o === 'string' ? o : o.label;
          return <option key={v} value={v}>{l}</option>;
        })}
      </select>
      <Icon name="chevronDown" size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
    </div>
  );
}

// ─── Entitlement bar ───────────────────────────────────────────────────────────
function EntitlementRow({ label, total, used, color = 'bg-accent' }: { label: string; total: number; used: number; color?: string }) {
  const pct = total > 0 ? Math.round((used / total) * 100) : 0;
  return (
    <div className="flex flex-col gap-2 rounded-control bg-page p-4">
      <div className="flex items-center justify-between text-[13px]">
        <span className="font-semibold text-ink">{label}</span>
        <span className="text-muted tabular-nums">{total - used} of {total} days left</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-rule" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${label} used`}>
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="flex justify-between text-xs text-muted tabular-nums">
        <span>Used {used} days</span>
        <span>{pct}% used</span>
      </div>
    </div>
  );
}

/** Leave tile for the side card: remaining days over entitlement. */
function LeaveTile({ label, left, of }: { label: string; left?: number; of?: number }) {
  if (left == null && of == null) return null;
  return (
    <div className="flex flex-col gap-0.5 rounded-control bg-pill px-3 py-2.5">
      <span className="text-xs font-semibold text-muted">{label}</span>
      <span className="text-lg font-extrabold text-ink tabular-nums">{left ?? of}</span>
      {of != null && left != null && <span className="text-xs text-muted tabular-nums">of {of} days</span>}
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
  if (loading) return <PageLoading label="Loading employee…" />;
  if (!employee) return (
    <Card padding="p-0" className="max-w-2xl mx-auto mt-10">
      <EmptyState
        icon="user"
        title="Employee not found"
        description="The record may have been removed, or the link is wrong."
        action={<Link href="/employees" className="text-sm font-semibold text-accent hover:underline">Back to employees</Link>}
      />
    </Card>
  );

  const emp = isEditing ? { ...employee, ...editData } : employee;
  const tenureMs = Date.now() - new Date(emp.startDate).getTime();
  const tenureYrs = (tenureMs / (1000 * 60 * 60 * 24 * 365.25)).toFixed(1);

  const TABS: { key: Tab; label: string }[] = [
    { key: 'general', label: 'Profile' },
    { key: 'contracts', label: 'Contract and pay' },
  ];

  const canManage = hasPermission('employee:manage');
  const canSeePay = hasPermission('payroll:view') || hasPermission('employee:sensitive');
  const hasLeave = [emp.annualLeaveBalance, emp.annualLeaveEntitlement, emp.sickLeaveBalance, emp.sickLeaveEntitlement, emp.childcareLeaveEntitlement].some(v => v != null);

  const editActions = canManage && (
    !isEditing ? (
      <Button variant="secondary" icon="settings" onClick={startEditing}>Edit record</Button>
    ) : (
      <>
        <Button variant="secondary" onClick={cancelEditing}>Cancel</Button>
        <Button onClick={handleSave} disabled={saving} icon={saving ? undefined : 'check'}>
          {saving && <Spinner />}
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </>
    )
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className={`flex flex-col gap-5 ${isEditing ? 'pb-24 sm:pb-0' : ''}`}>
      <Link href="/employees" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted hover:text-accent w-fit rounded-control">
        <Icon name="chevronRight" size={14} className="rotate-180" /> Employees
      </Link>

      {/* Identity band */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-center gap-4 min-w-0">
          <PersonAvatar name={emp.fullName} photoUrl={emp.profilePhotoUrl} size={56} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-extrabold tracking-[-0.02em] text-ink">{emp.fullName}</h1>
              {emp.preferredName && <span className="text-sm text-muted">&ldquo;{emp.preferredName}&rdquo;</span>}
              <Badge tone={emp.isActive ? 'ok' : 'neutral'}>{emp.isActive ? 'Active' : 'Inactive'}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted">
              {[emp.designation, emp.department, emp.employeeCode].filter(Boolean).join(' · ')}
              {emp.reportingManager ? ` · reports to ${emp.reportingManager}` : ''}
            </p>
          </div>
        </div>
        {editActions && (
          <div className={isEditing
            ? 'fixed inset-x-0 bottom-16 z-20 flex items-center justify-end gap-2 border-t border-rule bg-paper px-4 py-3 sm:static sm:border-0 sm:bg-transparent sm:p-0'
            : 'flex items-center gap-2'}>
            {editActions}
          </div>
        )}
      </div>

      {isEditing && (
        <Notice tone="accent" title="You are editing this record">
          Changes are saved only when you press Save changes. Leaving the page discards them.
        </Notice>
      )}
      {isEditing && saveError && <Notice tone="danger" title="Changes not saved">{saveError}</Notice>}

      <Tabs<Tab>
        items={TABS.map(t => ({ id: t.key, label: t.label }))}
        active={activeTab}
        onChange={setActiveTab}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">

        {/* ── Main (2/3) ──────────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-5 lg:col-span-2 min-w-0">

              {/* ══ GENERAL PROFILE ══════════════════════════════════════════════ */}
              {activeTab === 'general' && (
                <>
                  <Section title="Personal details">
                    <Field label="Full legal name" value={emp.fullName} editing={isEditing}>
                      <input type="text" value={editData.fullName ?? ''} onChange={e => set('fullName', e.target.value)} className={IX} placeholder="Full legal name" />
                    </Field>
                    <Field label="Preferred name" value={emp.preferredName} editing={isEditing}>
                      <input type="text" value={editData.preferredName ?? ''} onChange={e => set('preferredName', e.target.value)} className={IX} placeholder="Name they go by" />
                    </Field>
                    <Field label="Gender" value={fmtEnum(emp.gender)} editing={isEditing}>
                      <Sel value={editData.gender ?? ''} onChange={v => set('gender', v)} options={[
                        { value: 'MALE', label: 'Male' },
                        { value: 'FEMALE', label: 'Female' },
                        { value: 'PREFER_NOT_TO_SAY', label: 'Prefer not to say' },
                      ]} />
                    </Field>
                    <Field label="Date of birth" value={fmtDate(emp.dateOfBirth, { day: 'numeric', month: 'long', year: 'numeric' })} editing={isEditing}>
                      <DatePicker value={toDateOnly(editData.dateOfBirth ?? emp.dateOfBirth)} onChange={v => set('dateOfBirth', v)} placeholder="Select birth date" minYear={1940} maxYear={new Date().getFullYear() - 16} />
                    </Field>
                    <Field label="Nationality" value={emp.nationality} editing={isEditing}>
                      <CountrySelect value={editData.nationality ?? ''} onChange={v => set('nationality', v)} />
                    </Field>
                    <Field label="Marital status" value={fmtEnum(emp.maritalStatus)} editing={isEditing}>
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

                  <Section title="Contact details">
                    <Field label="Work email" value={emp.workEmail} editing={isEditing}>
                      <input type="email" value={editData.workEmail ?? ''} onChange={e => set('workEmail', e.target.value)} className={IX} placeholder="work@company.com" />
                    </Field>
                    <Field label="Work phone" value={emp.workPhone} editing={isEditing}>
                      <input type="tel" value={editData.workPhone ?? ''} onChange={e => set('workPhone', e.target.value)} className={IX} placeholder="+65 XXXX XXXX" />
                    </Field>
                    <Field label="Personal email" value={emp.personalEmail} editing={isEditing}>
                      <input type="email" value={editData.personalEmail ?? ''} onChange={e => set('personalEmail', e.target.value)} className={IX} placeholder="personal@email.com" />
                    </Field>
                    <Field label="Personal phone" value={emp.personalPhone} editing={isEditing}>
                      <input type="tel" value={editData.personalPhone ?? ''} onChange={e => set('personalPhone', e.target.value)} className={IX} placeholder="+65 XXXX XXXX" />
                    </Field>
                    <Field label="Home address" value={showSensitive ? emp.homeAddressEncrypted : '•••• •••• ••••'} editing={isEditing} span="2">
                      <PostalLookup value={editData.homeAddressEncrypted ?? ''} onChange={v => set('homeAddressEncrypted', v)} />
                    </Field>
                  </Section>

                  <Section title="Emergency contact">
                    <Field label="Name" value={emp.emergencyContactName} editing={isEditing}>
                      <input type="text" value={editData.emergencyContactName ?? ''} onChange={e => set('emergencyContactName', e.target.value)} className={IX} placeholder="Full name" />
                    </Field>
                    <Field label="Relationship" value={emp.emergencyContactRelation} editing={isEditing}>
                      <Sel value={editData.emergencyContactRelation ?? ''} onChange={v => set('emergencyContactRelation', v)} options={['Spouse','Parent','Sibling','Child','Relative','Friend','Other']} />
                    </Field>
                    <Field label="Phone" value={emp.emergencyContactPhone} editing={isEditing}>
                      <input type="tel" value={editData.emergencyContactPhone ?? ''} onChange={e => set('emergencyContactPhone', e.target.value)} className={IX} placeholder="+65 XXXX XXXX" />
                    </Field>
                    <Field label="Email" value={emp.emergencyContactEmail} editing={isEditing}>
                      <input type="email" value={editData.emergencyContactEmail ?? ''} onChange={e => set('emergencyContactEmail', e.target.value)} className={IX} placeholder="emergency@email.com" />
                    </Field>
                  </Section>

                  <Section title="Employment">
                    <Field label="Employee code" value={emp.employeeCode}>
                      {/* read-only — never editable */}
                    </Field>
                    <Field label="Department" value={emp.department} editing={isEditing}>
                      <Sel value={editData.department ?? ''} onChange={v => set('department', v)} options={['Human Resources','Finance','Engineering','Operations','Sales','Marketing','Legal','Administration','IT','Other']} />
                    </Field>
                    <Field label="Designation" value={emp.designation} editing={isEditing}>
                      <input type="text" value={editData.designation ?? ''} onChange={e => set('designation', e.target.value)} className={IX} placeholder="Job title" />
                    </Field>
                    <Field label="Employment type" value={fmtEnum(emp.employmentType)} editing={isEditing}>
                      <Sel value={editData.employmentType ?? ''} onChange={v => set('employmentType', v)} options={[
                        { value: 'FULL_TIME',  label: 'Full time'  },
                        { value: 'PART_TIME',  label: 'Part time'  },
                        { value: 'CONTRACT',   label: 'Contract'   },
                        { value: 'INTERN',     label: 'Intern'     },
                        { value: 'TEMP',       label: 'Temporary'  },
                      ]} />
                    </Field>
                    <Field label="Cost centre" value={emp.costCentre} editing={isEditing}>
                      <input type="text" value={editData.costCentre ?? ''} onChange={e => set('costCentre', e.target.value)} className={IX} placeholder="e.g. CC-001" />
                    </Field>
                    <Field label="Reporting manager" value={emp.reportingManager} editing={isEditing}>
                      <input type="text" value={editData.reportingManager ?? ''} onChange={e => set('reportingManager', e.target.value)} className={IX} placeholder="Manager full name" />
                    </Field>
                    <Field label="Start date" value={fmtDate(emp.startDate)} editing={isEditing}>
                      <DatePicker value={toDateOnly(editData.startDate ?? emp.startDate)} onChange={v => set('startDate', v)} placeholder="Employment start date" minYear={1990} maxYear={new Date().getFullYear() + 1} />
                    </Field>
                    <Field label="Weekly hours" value={`${emp.weeklyHours ?? 44} hours`} editing={isEditing}>
                      <input type="number" min={1} max={80} value={editData.weeklyHours ?? ''} onChange={e => set('weeklyHours', Number(e.target.value))} className={`${IX} tabular-nums`} placeholder="44" />
                    </Field>
                    <Field label="Work days a week" value={`${emp.workDays ?? 5} days`} editing={isEditing}>
                      <Sel value={String(editData.workDays ?? emp.workDays ?? '')} onChange={v => set('workDays', Number(v))} options={['3','4','5','6']} />
                    </Field>
                  </Section>
                </>
              )}

              {/* ══ CONTRACTS & ENTITLEMENTS ══════════════════════════════════════ */}
              {activeTab === 'contracts' && (
                <>
                  <Section title="Contract terms">
                    <Field label="Contract type" value={fmtEnum(emp.employmentType)} editing={isEditing}>
                      <Sel value={editData.employmentType ?? ''} onChange={v => set('employmentType', v)} options={[
                        { value: 'FULL_TIME',  label: 'Full time'  },
                        { value: 'PART_TIME',  label: 'Part time'  },
                        { value: 'CONTRACT',   label: 'Contract'   },
                        { value: 'INTERN',     label: 'Intern'     },
                        { value: 'TEMP',       label: 'Temporary'  },
                      ]} />
                    </Field>
                    <Field label="Contract start" value={fmtDate(emp.startDate)} editing={isEditing}>
                      <DatePicker value={toDateOnly(editData.startDate ?? emp.startDate)} onChange={v => set('startDate', v)} minYear={1990} maxYear={new Date().getFullYear() + 2} />
                    </Field>
                    <Field label="Contract end" value={fmtDate(emp.endDate) || 'Permanent'} editing={isEditing}>
                      <DatePicker value={toDateOnly(editData.endDate ?? emp.endDate)} onChange={v => set('endDate', v)} placeholder="Leave blank if permanent" minYear={new Date().getFullYear()} maxYear={new Date().getFullYear() + 10} />
                    </Field>
                    <Field label="Probation ends" value={fmtDate(emp.probationEndDate) || 'Completed'} editing={isEditing}>
                      <DatePicker value={toDateOnly(editData.probationEndDate ?? emp.probationEndDate)} onChange={v => set('probationEndDate', v)} placeholder="Leave blank if completed" minYear={new Date().getFullYear() - 5} maxYear={new Date().getFullYear() + 2} />
                    </Field>
                    <Field label="Notice period" value={`${emp.noticePeriodDays ?? 30} days`} editing={isEditing}>
                      <input type="number" min={0} max={365} value={editData.noticePeriodDays ?? ''} onChange={e => set('noticePeriodDays', Number(e.target.value))} className={`${IX} tabular-nums`} placeholder="30" />
                    </Field>
                    <Field label="Weekly hours" value={`${emp.weeklyHours ?? 44} hours`} editing={isEditing}>
                      <input type="number" min={1} max={80} value={editData.weeklyHours ?? ''} onChange={e => set('weeklyHours', Number(e.target.value))} className={`${IX} tabular-nums`} placeholder="44" />
                    </Field>
                  </Section>

                  <Section title="Pay">
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[12.5px] font-semibold text-muted">Basic salary (SGD)</span>
                      {isEditing ? (
                        <input type="text" value={editData.basicSalaryEncrypted ?? ''} onChange={e => set('basicSalaryEncrypted', e.target.value)} className={`${IX} tabular-nums`} placeholder="e.g. 5000" />
                      ) : (
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm font-semibold text-ink tabular-nums">{showSensitive ? `SGD ${emp.basicSalaryEncrypted ?? '—'}` : 'SGD ••••••'}</span>
                          <Button size="sm" variant="ghost" icon={showSensitive ? 'lock' : 'eye'} onClick={() => setShowSensitive(s => !s)}>{showSensitive ? 'Hide' : 'Show'}</Button>
                        </div>
                      )}
                    </div>
                    <Field label="Bank" value={emp.bankName} editing={isEditing}>
                      <Sel value={editData.bankName ?? ''} onChange={v => set('bankName', v)} options={['DBS','OCBC','UOB','Standard Chartered','HSBC','Citibank','Maybank','RHB','Other']} />
                    </Field>
                    <Field label="Bank account number" value={showSensitive ? emp.bankAccountEncrypted : '•••• •••• ••'} editing={isEditing}>
                      <input type="text" value={editData.bankAccountEncrypted ?? ''} onChange={e => set('bankAccountEncrypted', e.target.value)} className={`${IX} tabular-nums`} placeholder="Account number" />
                    </Field>
                  </Section>
                </>
              )}

              {/* ══ STATUTORY & COMPLIANCE ═══════════════════════════════════════ */}
              {activeTab === 'statutory' && (
                <>
                  <Card>
                    <CardHeader title="CPF contributions" caption="Central Provident Fund statutory rates" action={<Badge tone="ok">Calculated automatically</Badge>} />
                    <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                      <div className="flex flex-col gap-3">
                        {[
                          { label: 'Ordinary wages (OW)', sub: 'Subject to the $6,000 ceiling' },
                          { label: 'Additional wages (AW)', sub: 'Annual ceiling applies' },
                        ].map(opt => (
                          <label key={opt.label} className="flex cursor-pointer items-center gap-3 rounded-control border border-rule p-3.5 hover:border-accent">
                            <input type="checkbox" defaultChecked className="h-4 w-4 accent-accent" />
                            <span>
                              <span className="block text-sm font-semibold text-ink">{opt.label}</span>
                              <span className="block text-xs text-muted">{opt.sub}</span>
                            </span>
                          </label>
                        ))}
                      </div>
                      <div className="flex flex-col gap-2">
                        <span className="text-[12.5px] font-semibold text-muted">Residency category</span>
                        {[
                          { label: 'Citizen / PR year 3+', note: 'Full rates', active: true },
                          { label: 'PR year 1 or 2', note: 'Graduated rates', active: false },
                          { label: 'Foreigner', note: 'No CPF', active: false },
                        ].map(opt => (
                          <button key={opt.label} type="button" aria-pressed={opt.active} className={`flex justify-between rounded-control px-3.5 py-2.5 text-[13px] font-semibold ${opt.active ? 'bg-accent text-on-accent' : 'border border-rule text-muted hover:border-accent hover:text-accent'}`}>
                            <span>{opt.label}</span>
                            <span className="font-normal">{opt.note}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </Card>
                  <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                    <Card>
                      <CardHeader title="Skills Development Levy" />
                      <label className="flex cursor-pointer items-center gap-3">
                        <input type="checkbox" defaultChecked className="h-4 w-4 accent-accent" />
                        <span className="text-sm text-ink">Apply SDL (0.25%)</span>
                      </label>
                      <p className="mt-2 text-xs text-muted">Capped at SGD 11.25 a month.</p>
                    </Card>
                    <Card>
                      <CardHeader title="Tax and IR8A" />
                      <p className="mb-3 text-[13px] text-muted">Included in AIS reporting to IRAS.</p>
                      <div className="flex gap-2">
                        <Badge tone="ok">IRAS ready</Badge>
                        <Badge tone="neutral">AIS 2026</Badge>
                      </div>
                    </Card>
                  </div>
                </>
              )}

              {/* ══ ASSETS ═══════════════════════════════════════════════════════ */}
              {activeTab === 'assets' && (
                <>
                  {assetToast && <Notice tone="accent">{assetToast}</Notice>}

                  {/* Assign new asset */}
                  <Card>
                    <CardHeader title="Assign an asset" />
                    <div className="flex flex-col gap-3 sm:flex-row">
                      <Select
                        aria-label="Available asset"
                        value={assignAssetId}
                        onChange={e => setAssignAssetId(e.target.value)}
                        className="flex-1"
                      >
                        <option value="">Select an available asset</option>
                        {allAssets.map(a => (
                          <option key={a.id} value={a.id}>{a.name} ({a.assetCode}) · {a.category}</option>
                        ))}
                      </Select>
                      <Button
                        disabled={!assignAssetId || assigningAsset}
                        reason={!assignAssetId && !assigningAsset ? 'Pick an asset first' : undefined}
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
                      >
                        {assigningAsset ? 'Assigning…' : 'Assign'}
                      </Button>
                    </div>
                    {allAssets.length === 0 && !loadingAssets && (
                      <p className="mt-2 text-[13px] text-muted">No assets are available. <a href="/assets" className="font-semibold text-accent hover:underline">Register assets first</a></p>
                    )}
                  </Card>

                  {/* Assigned assets list */}
                  <Card padding="p-0">
                    <div className="px-5 pt-5"><CardHeader title={<>Assigned <span className="text-muted tabular-nums">{empAssets.length}</span></>} /></div>
                    {loadingAssets ? (
                      <div className="flex flex-col gap-2 p-5">{[1,2].map(i => <div key={i} className="h-12 rounded-control bg-pill animate-pulse" />)}</div>
                    ) : empAssets.length === 0 ? (
                      <EmptyState icon="briefcase" title="No assets assigned" description="Laptops, phones and other equipment given to this employee will be listed here." />
                    ) : (
                      <ul className="divide-y divide-rule border-t border-rule">
                        {empAssets.map(a => (
                          <li key={a.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-ink">{a.name}</p>
                              <p className="text-xs text-muted tabular-nums">
                                {a.assetCode} · {a.category} · assigned {a.assignedAt ? new Date(a.assignedAt).toLocaleDateString('en-SG') : '—'} · ${(a.currentValue ?? 0).toLocaleString()}
                              </p>
                            </div>
                            <Button
                              size="sm"
                              variant="secondary"
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
                            >
                              {returningAsset === a.id ? 'Returning…' : 'Mark returned'}
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Card>
                </>
              )}

              {/* ══ DOCUMENT ARCHIVE ═════════════════════════════════════════════ */}
              {activeTab === 'documents' && (
                <>
                  <Modal
                    open={uploadOpen}
                    onClose={() => { setUploadOpen(false); setUploadFile(null); setUploadError(''); }}
                    title="Upload a document"
                    footer={
                      <>
                        <Button variant="secondary" onClick={() => { setUploadOpen(false); setUploadFile(null); setUploadError(''); }}>Cancel</Button>
                        <Button
                          disabled={!uploadFile || uploading}
                          reason={!uploadFile && !uploading ? 'Choose a file first' : undefined}
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
                        >
                          {uploading && <Spinner />}
                          {uploading ? 'Uploading…' : 'Upload'}
                        </Button>
                      </>
                    }
                  >
                    <div className="flex flex-col gap-4">
                      <div className="flex flex-col gap-1.5">
                        <span className="text-[12.5px] font-semibold text-muted">File</span>
                        <label className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-control border-2 border-dashed py-6 text-center focus-within:ring-2 focus-within:ring-accent/30 ${uploadFile ? 'border-accent bg-tint' : 'border-rule hover:border-accent'}`}>
                          <Icon name="file" size={24} className={uploadFile ? 'text-accent' : 'text-muted'} />
                          <span className="text-[13px] text-muted">{uploadFile ? uploadFile.name : 'Choose a file (up to 10 MB)'}</span>
                          <input type="file" className="sr-only" onChange={e => setUploadFile(e.target.files?.[0] ?? null)} />
                        </label>
                      </div>
                      <FormField label="Document type">
                        <Select value={uploadDocType} onChange={e => setUploadDocType(e.target.value)}>
                          <option value="CONTRACT">Employment contract</option>
                          <option value="NRIC_COPY">NRIC / FIN copy</option>
                          <option value="EMPLOYMENT_PASS">Employment or work pass</option>
                          <option value="CERT">Certificate or qualification</option>
                          <option value="OTHER">Other</option>
                        </Select>
                      </FormField>
                      <FormField label="Expiry date" help="Optional">
                        <Input type="date" value={uploadExpiry} onChange={e => setUploadExpiry(e.target.value)} />
                      </FormField>
                      {uploadError && <Notice tone="danger">{uploadError}</Notice>}
                    </div>
                  </Modal>

                  <Card padding="p-0">
                    <div className="px-5 pt-5">
                      <CardHeader
                        title="Documents"
                        action={<Button size="sm" icon="upload" onClick={() => { setUploadOpen(true); setUploadError(''); }}>Upload</Button>}
                      />
                    </div>

                    {docsLoading ? (
                      <PageLoading label="Loading documents…" />
                    ) : documents.length === 0 ? (
                      <EmptyState icon="file" title="No documents yet" description="Contracts, passes and certificates uploaded for this employee will be listed here." />
                    ) : (
                      <ul className="divide-y divide-rule border-t border-rule">
                        {documents.map(doc => {
                          const ext = doc.fileName.split('.').pop()?.toUpperCase() ?? 'FILE';
                          const expired = doc.expiryDate ? new Date(doc.expiryDate) < new Date() : false;
                          return (
                            <li key={doc.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                              <div className="flex min-w-0 items-center gap-3">
                                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-pill text-xs font-bold text-muted">{ext.slice(0, 4)}</span>
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-semibold text-ink">{doc.fileName}</p>
                                  <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted tabular-nums">
                                    <span>{fmtEnum(doc.docType)}</span>
                                    <span>· uploaded {new Date(doc.createdAt).toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                                    {doc.expiryDate
                                      ? <span className={expired ? 'font-semibold text-danger' : ''}>· {expired ? 'expired' : 'expires'} {new Date(doc.expiryDate).toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                                      : <span>· no expiry</span>}
                                  </p>
                                </div>
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  icon="eye"
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
                                >
                                  View
                                </Button>
                                <Button
                                  size="sm"
                                  variant="danger"
                                  onClick={async () => {
                                    if (!confirm(`Delete "${doc.fileName}"?`)) return;
                                    try {
                                      await apiFetch(`/documents/${doc.id}`, { method: 'DELETE' });
                                      loadDocuments();
                                    } catch {}
                                  }}
                                >
                                  Delete
                                </Button>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </Card>
                </>
              )}

              {/* ══ SUPERVISORS ══════════════════════════════════════════════════ */}
              {activeTab === 'supervisors' && (
                <Card>
                  {loadingSupervisors ? (
                    <PageLoading label="Loading supervisors…" />
                  ) : (
                    <>
                      <CardHeader
                        title="Leave approvers"
                        caption="Who approves this employee's leave requests"
                        action={hasPermission('employee:manage') && !editingSupervisors ? (
                          <Button
                            size="sm"
                            onClick={async () => {
                              if (allEmployees.length === 0) {
                                const data = await apiFetch('/employees?limit=500&isActive=true').catch(() => ({ employees: [] }));
                                setAllEmployees((data.employees ?? []).filter((e: any) => e.id !== params.id));
                              }
                              setDraftSupervisors(supervisorData?.supervisors ?? []);
                              setDraftFlowType(supervisorData?.flowType ?? 'ANY_ONE');
                              setEditingSupervisors(true);
                            }}
                          >
                            Edit approvers
                          </Button>
                        ) : undefined}
                      />

                      {!editingSupervisors ? (
                        <div className="flex flex-col gap-4">
                          <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
                            Approval flow
                            <Badge tone={supervisorData?.flowType === 'SEQUENTIAL' ? 'warn' : 'accent'}>
                              {supervisorData?.flowType === 'SEQUENTIAL' ? 'In order — each must approve' : 'Any one of them can approve'}
                            </Badge>
                          </div>

                          {supervisorData?.supervisors && supervisorData.supervisors.length > 0 ? (
                            <ul className="flex flex-col gap-2">
                              {supervisorData.supervisors.map((s: any, idx: number) => (
                                <li key={s.id} className="flex items-center gap-3 rounded-control border border-rule p-3">
                                  {supervisorData.flowType === 'SEQUENTIAL' && (
                                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-tint text-xs font-bold text-accent tabular-nums">{s.order ?? idx + 1}</span>
                                  )}
                                  <PersonAvatar name={s.fullName || '?'} size={36} />
                                  <div className="min-w-0 flex-1">
                                    <p className="text-sm font-semibold text-ink">{s.fullName}</p>
                                    <p className="text-xs text-muted">{s.designation || '—'} · {s.department || '—'}</p>
                                  </div>
                                  <span className="text-xs text-muted tabular-nums">{s.employeeCode}</span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <EmptyState icon="user" title="No approvers assigned" description="Only HR admins and super admins can approve this employee's leave." />
                          )}
                        </div>
                      ) : (
                        /* ── Edit mode ─────────────────────────────────────── */
                        <div className="flex flex-col gap-5">
                          {supervisorToast && (
                            <Notice tone={supervisorToast.startsWith('Error') ? 'danger' : 'ok'}>{supervisorToast}</Notice>
                          )}

                          <div className="flex flex-col gap-2">
                            <span className="text-[12.5px] font-semibold text-muted">Approval flow</span>
                            <div className="flex gap-2" role="group" aria-label="Approval flow">
                              {(['ANY_ONE', 'SEQUENTIAL'] as const).map(ft => (
                                <button
                                  key={ft}
                                  type="button"
                                  onClick={() => setDraftFlowType(ft)}
                                  aria-pressed={draftFlowType === ft}
                                  className={`h-10 flex-1 rounded-control border px-3 text-sm font-semibold transition-colors ${draftFlowType === ft ? 'border-accent bg-tint text-accent' : 'border-rule bg-paper text-muted hover:border-accent'}`}
                                >
                                  {ft === 'ANY_ONE' ? 'Any one' : 'In order'}
                                </button>
                              ))}
                            </div>
                            <p className="text-xs text-muted">
                              {draftFlowType === 'SEQUENTIAL' ? 'Approvers sign off in the listed order; each step opens after the one before.' : 'Any single approver can approve the leave request.'}
                            </p>
                          </div>

                          <div className="flex flex-col gap-2">
                            <span className="text-[12.5px] font-semibold text-muted">Approvers</span>
                            {draftSupervisors.map((s: any, idx: number) => (
                              <div key={idx} className="flex items-center gap-2">
                                {draftFlowType === 'SEQUENTIAL' && (
                                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-tint text-xs font-bold text-accent tabular-nums">{idx + 1}</span>
                                )}
                                <Select
                                  aria-label={`Approver ${idx + 1}`}
                                  value={s.employeeId}
                                  onChange={e => {
                                    const chosen = allEmployees.find((em: any) => em.id === e.target.value);
                                    setDraftSupervisors(prev => prev.map((x, i) => i === idx ? { ...x, employeeId: e.target.value, fullName: chosen?.fullName, designation: chosen?.designation, department: chosen?.department, employeeCode: chosen?.employeeCode } : x));
                                  }}
                                  className="flex-1"
                                >
                                  <option value="">Select an employee</option>
                                  {allEmployees.map((em: any) => (
                                    <option key={em.id} value={em.id}>{em.fullName} ({em.employeeCode})</option>
                                  ))}
                                </Select>
                                <button
                                  type="button"
                                  onClick={() => setDraftSupervisors(prev => prev.filter((_, i) => i !== idx))}
                                  aria-label={`Remove approver ${idx + 1}`}
                                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control text-muted hover:bg-page hover:text-danger"
                                >
                                  <Icon name="x" size={16} />
                                </button>
                              </div>
                            ))}
                            <Button
                              variant="secondary"
                              icon="plus"
                              onClick={() => setDraftSupervisors(prev => [...prev, { employeeId: '', fullName: '', order: prev.length + 1 }])}
                              className="w-full border-dashed"
                            >
                              Add approver
                            </Button>
                          </div>

                          <div className="flex flex-col-reverse gap-2.5 border-t border-rule pt-4 sm:flex-row sm:justify-end">
                            <Button variant="secondary" onClick={() => { setEditingSupervisors(false); setSupervisorToast(''); }}>Cancel</Button>
                            <Button
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
                            >{savingSupervisors ? 'Saving…' : 'Save approvers'}</Button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </Card>
              )}

              {/* ══ SALARY HISTORY ════════════════════════════════════════════════ */}
              {activeTab === 'salary' && (
                <>
                  <Modal
                    open={showRevisionForm}
                    onClose={() => { setShowRevisionForm(false); setRevisionToast(''); }}
                    title="Request a salary revision"
                    caption="Creates a pending revision for an HR manager to approve."
                    footer={
                      <>
                        <Button variant="secondary" onClick={() => { setShowRevisionForm(false); setRevisionToast(''); }}>Cancel</Button>
                        <Button
                          disabled={submittingRevision || !revForm.newSalary || !revForm.effectiveDate}
                          reason={!submittingRevision && (!revForm.newSalary || !revForm.effectiveDate) ? 'Enter the new salary and effective date' : undefined}
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
                        >
                          {submittingRevision && <Spinner />}
                          {submittingRevision ? 'Submitting…' : 'Submit for approval'}
                        </Button>
                      </>
                    }
                  >
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <FormField label="New monthly salary (SGD)" required>
                        <Input type="number" min={0} step={100} className="tabular-nums" value={revForm.newSalary} onChange={e => setRevForm(p => ({ ...p, newSalary: e.target.value }))} placeholder="e.g. 5500" />
                      </FormField>
                      <FormField label="Effective date" required>
                        <Input type="date" value={revForm.effectiveDate} onChange={e => setRevForm(p => ({ ...p, effectiveDate: e.target.value }))} />
                      </FormField>
                      <FormField label="Reason">
                        <Select value={revForm.reasonCode} onChange={e => setRevForm(p => ({ ...p, reasonCode: e.target.value }))}>
                          {[
                            { value: 'PROMOTION',         label: 'Promotion' },
                            { value: 'ANNUAL_INCREMENT',  label: 'Annual increment' },
                            { value: 'MARKET_ADJUSTMENT', label: 'Market adjustment' },
                            { value: 'ROLE_CHANGE',       label: 'Role change' },
                            { value: 'CORRECTION',        label: 'Correction' },
                            { value: 'OTHER',             label: 'Other' },
                          ].map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </Select>
                      </FormField>
                      <FormField label="Recommended by">
                        <Input value={revForm.recommendedBy} onChange={e => setRevForm(p => ({ ...p, recommendedBy: e.target.value }))} placeholder="Name or email" />
                      </FormField>
                      <FormField label="Notes" help="Optional" className="sm:col-span-2">
                        <Textarea rows={2} value={revForm.notes} onChange={e => setRevForm(p => ({ ...p, notes: e.target.value }))} placeholder="Justification, performance notes and so on" />
                      </FormField>
                      {revisionToast && (
                        <Notice tone={revisionToast.startsWith('Error') ? 'danger' : 'ok'} className="sm:col-span-2">{revisionToast}</Notice>
                      )}
                    </div>
                  </Modal>

                  {budgetEnvelope && budgetEnvelope.totalRevisions > 0 && (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <Stat label={`${budgetEnvelope.year} revisions`} value={String(budgetEnvelope.totalRevisions)} />
                      <Stat label="Annual cost change" value={`SGD ${Number(budgetEnvelope.totalAnnualDelta).toLocaleString('en-SG', { minimumFractionDigits: 2 })}`} />
                      <Stat label="Monthly impact" value={`SGD ${(budgetEnvelope.totalAnnualDelta / 12).toLocaleString('en-SG', { minimumFractionDigits: 2 })}`} />
                    </div>
                  )}

                  {revisionToast && !showRevisionForm && (
                    <Notice tone={revisionToast.startsWith('Error') ? 'danger' : 'ok'}>{revisionToast}</Notice>
                  )}

                  <Card padding="p-0">
                    <div className="px-5 pt-5">
                      <CardHeader
                        title="Salary history"
                        action={hasPermission('employee:manage') ? (
                          <Button size="sm" icon="plus" onClick={() => { setShowRevisionForm(true); setRevisionToast(''); }}>Request revision</Button>
                        ) : undefined}
                      />
                    </div>
                    {loadingSalaryHistory ? (
                      <div className="flex flex-col gap-2 p-5">{[1,2,3].map(i => <div key={i} className="h-12 rounded-control bg-pill animate-pulse" />)}</div>
                    ) : salaryHistory.length === 0 ? (
                      <EmptyState icon="wallet" title="No salary revisions yet" description="Use Request revision to create the first record." />
                    ) : (
                      <ul className="divide-y divide-rule border-t border-rule">
                        {salaryHistory.map((h: any, i: number) => {
                          const isPending = h.status === 'PENDING';
                          const isApproved = h.status === 'APPROVED';
                          const reasonLabel: Record<string,string> = {
                            PROMOTION: 'Promotion', ANNUAL_INCREMENT: 'Annual increment',
                            MARKET_ADJUSTMENT: 'Market adjustment', ROLE_CHANGE: 'Role change',
                            CORRECTION: 'Correction', OTHER: 'Other',
                          };
                          const fmt = (v: number | null) => v != null ? `$${Number(v).toLocaleString('en-SG', { minimumFractionDigits: 2 })}` : '—';
                          const pct = h.incrementPct;
                          const pctLabel = pct != null ? `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%` : null;
                          return (
                            <li key={h.id ?? i} className="flex flex-col gap-3 px-5 py-3.5 md:flex-row md:items-center md:justify-between">
                              <div className="flex min-w-0 flex-col gap-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-sm font-semibold text-ink tabular-nums">{fmt(h.previousSalary ?? h.basicSalary)}</span>
                                  <Icon name="arrowRight" size={14} className="text-muted" />
                                  <span className="text-sm font-bold text-ink tabular-nums">{fmt(h.newSalary)}</span>
                                  {pctLabel && <span className={`text-xs font-semibold tabular-nums ${(pct ?? 0) >= 0 ? 'text-ok' : 'text-danger'}`}>{pctLabel}</span>}
                                  <Badge tone={isPending ? 'warn' : isApproved ? 'ok' : 'danger'}>{fmtEnum(h.status)}</Badge>
                                </div>
                                <p className="text-xs text-muted tabular-nums">
                                  Effective {fmtDate(h.effectiveDate)} · {reasonLabel[h.reasonCode] || h.changeReason || '—'}{h.recommendedBy ? ` · recommended by ${h.recommendedBy}` : ''}
                                </p>
                                {h.catchUpAmount != null && h.catchUpAmount > 0 && (
                                  <p className="text-xs font-semibold text-ink tabular-nums">Catch-up: SGD {Number(h.catchUpAmount).toLocaleString('en-SG', { minimumFractionDigits: 2 })}</p>
                                )}
                                {hasPermission('employee:manage') && h.notes && (
                                  <p className="text-xs text-muted" title={h.notes}>{h.notes}</p>
                                )}
                              </div>
                              {hasPermission('employee:manage') && isPending && (
                                <div className="flex shrink-0 gap-2">
                                  <Button
                                    size="sm"
                                    variant="secondary"
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
                                  >Reject</Button>
                                  <Button
                                    size="sm"
                                    icon="check"
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
                                  >Approve</Button>
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </Card>
                </>
              )}

        </div>

        {/* ── Side (1/3) ──────────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="At a glance" />
            <KeyValue label="Employee ID" value={<span className="tabular-nums">{emp.employeeCode}</span>} />
            {emp.workEmail && <KeyValue label="Work email" value={<a href={`mailto:${emp.workEmail}`} className="text-accent hover:underline">{emp.workEmail}</a>} />}
            <KeyValue label="Joined" value={<span className="tabular-nums">{fmtDate(emp.startDate) || '—'}</span>} />
            <KeyValue label="Tenure" value={<span className="tabular-nums">{tenureYrs} years</span>} />
            {emp.probationEndDate && <KeyValue label="Probation ends" value={<span className="tabular-nums">{fmtDate(emp.probationEndDate)}</span>} />}
          </Card>

          {hasLeave && (
            <Card>
              <CardHeader title="Leave balance" />
              <div className="grid grid-cols-3 gap-2">
                <LeaveTile label="Annual" left={emp.annualLeaveBalance} of={emp.annualLeaveEntitlement} />
                <LeaveTile label="Sick" left={emp.sickLeaveBalance} of={emp.sickLeaveEntitlement} />
                <LeaveTile label="Childcare" of={emp.childcareLeaveEntitlement} />
              </div>
            </Card>
          )}

          {/* Pay and bank */}
          <Card>
            <CardHeader title="Pay and bank" caption={canSeePay ? 'Hidden until you choose to show it' : undefined} />
            {canSeePay ? (
              <div className="flex flex-col">
                <KeyValue label="Basic salary" value={<span className="tabular-nums">{showSensitive ? `SGD ${emp.basicSalaryEncrypted ?? '—'}` : 'SGD ••••••'}</span>} />
                <KeyValue label="Bank" value={emp.bankName ?? 'Not set'} />
                <KeyValue label="Account" value={<span className="tabular-nums">{showSensitive ? emp.bankAccountEncrypted : '•••• ••'}</span>} />
                <Button variant="secondary" icon={showSensitive ? 'lock' : 'eye'} onClick={() => setShowSensitive(s => !s)} className="mt-3 w-full">
                  {showSensitive ? 'Hide pay details' : 'Show pay details'}
                </Button>
              </div>
            ) : (
              <div className="flex items-start gap-3 rounded-control bg-pill p-3.5 text-[13px] text-muted">
                <Icon name="lock" size={16} className="mt-0.5" />
                You do not have access to pay and bank details.
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
