'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { CountrySelect } from '@/components/employee/CountrySelect';
import { DatePicker } from '@/components/employee/DatePicker';
import { PostalLookup } from '@/components/employee/PostalLookup';

// ─── Types ────────────────────────────────────────────────────────────────────
interface Employee {
  id: string;
  employeeCode: string;
  fullName: string;
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

type Tab = 'general' | 'contracts' | 'statutory' | 'documents';

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
      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{label}</label>
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
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Profile Health:</span>
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
            <div className="h-28 w-28 rounded-3xl bg-slate-900 border-4 border-slate-800 shadow-2xl flex items-center justify-center shrink-0">
              <span className="text-3xl font-black text-white">{initials}</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="text-2xl font-black text-slate-900">{emp.fullName}</h3>
                {emp.preferredName && <span className="text-slate-400 font-bold text-sm">"{emp.preferredName}"</span>}
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
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{label}</p>
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

                  <Section title="Leave Entitlements" accent="bg-emerald-500">
                    <Field label="Annual Leave (days/year)" value={`${alTotal} days`} editing={isEditing}>
                      <input type="number" min={0} max={60} value={editData.annualLeaveEntitlement ?? ''} onChange={e => set('annualLeaveEntitlement', Number(e.target.value))} className={IX} placeholder="14" />
                    </Field>
                    <Field label="Sick Leave (days/year)" value={`${slTotal} days`} editing={isEditing}>
                      <input type="number" min={0} max={60} value={editData.sickLeaveEntitlement ?? ''} onChange={e => set('sickLeaveEntitlement', Number(e.target.value))} className={IX} placeholder="14" />
                    </Field>
                    <Field label="Childcare Leave (days/year)" value={`${clTotal} days`} editing={isEditing}>
                      <Sel value={String(editData.childcareLeaveEntitlement ?? emp.childcareLeaveEntitlement ?? '')} onChange={v => set('childcareLeaveEntitlement', Number(v))} options={['6', '2']} />
                    </Field>
                  </Section>

                  {/* Leave balance bars */}
                  <section>
                    <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-5 flex items-center gap-3">
                      <div className="w-1.5 h-4 bg-emerald-500 rounded-full shrink-0" />
                      Leave Balance — 2026
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                      <EntitlementRow label="Annual Leave" total={alTotal} used={alUsed} color="bg-indigo-600" />
                      <EntitlementRow label="Medical / Sick Leave" total={slTotal} used={slUsed} color="bg-emerald-500" />
                      <EntitlementRow label="Childcare Leave" total={clTotal} used={0} color="bg-amber-500" />
                      <EntitlementRow label="Hospitalisation Leave" total={60} used={0} color="bg-sky-500" />
                    </div>

                    {/* Statutory table */}
                    <div className="overflow-hidden border border-slate-200 rounded-xl">
                      <table className="w-full text-left">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200 text-[9px] font-black text-slate-400 uppercase tracking-widest">
                            <th className="px-5 py-3">Leave Type</th>
                            <th className="px-5 py-3">Entitlement</th>
                            <th className="px-5 py-3">Used</th>
                            <th className="px-5 py-3">Balance</th>
                            <th className="px-5 py-3">Basis</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-xs font-bold text-slate-700">
                          {[
                            { type: 'Annual Leave', ent: alTotal, used: alUsed, basis: 'EA s.88A' },
                            { type: 'Sick Leave (Outpatient)', ent: slTotal, used: slUsed, basis: 'EA s.89' },
                            { type: 'Hospitalisation Leave', ent: 60, used: 0, basis: 'EA s.89' },
                            { type: 'Childcare Leave', ent: clTotal, used: 0, basis: 'CDCSA' },
                            { type: 'Extended Childcare Leave', ent: 2, used: 0, basis: 'CDCSA s.12A' },
                            { type: 'Maternity Leave', ent: 16, used: 0, basis: 'CDCSA s.9' },
                            { type: 'Paternity Leave', ent: 4, used: 0, basis: 'CDCSA s.12H' },
                            { type: 'NS / Reservist Leave', ent: 0, used: 0, basis: 'NS Pay' },
                          ].map(row => (
                            <tr key={row.type} className="hover:bg-slate-50 transition-all">
                              <td className="px-5 py-3 font-black text-slate-800">{row.type}</td>
                              <td className="px-5 py-3">{row.ent > 0 ? `${row.ent} days` : 'As req.'}</td>
                              <td className="px-5 py-3">{row.used} days</td>
                              <td className="px-5 py-3">
                                <span className={`font-black ${row.ent - row.used > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                                  {row.ent > 0 ? `${row.ent - row.used} days` : '—'}
                                </span>
                              </td>
                              <td className="px-5 py-3">
                                <span className="text-[9px] font-black px-2 py-0.5 bg-indigo-50 text-indigo-600 border border-indigo-100 rounded uppercase">{row.basis}</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>

                  <Section title="Compensation" accent="bg-violet-500">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Basic Salary (SGD)</label>
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
                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-4">Citizenship Category</label>
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

              {/* ══ DOCUMENT ARCHIVE ═════════════════════════════════════════════ */}
              {activeTab === 'documents' && (
                <div className="flex flex-col gap-6">
                  <div className="flex justify-between items-center">
                    <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Secure Document Archive</h4>
                    <button className="text-[10px] font-black uppercase text-indigo-600 bg-indigo-50 px-4 py-2 rounded-lg hover:bg-indigo-100 transition-all">+ Upload Document</button>
                  </div>
                  <div className="overflow-hidden border border-slate-200 rounded-2xl shadow-sm">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="bg-slate-50 text-[9px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-200">
                          <th className="px-6 py-4">Document</th>
                          <th className="px-6 py-4">Category</th>
                          <th className="px-6 py-4">Security</th>
                          <th className="px-6 py-4">Expiry</th>
                          <th className="px-6 py-4 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-xs">
                        {[
                          { name: 'Employment_Contract_Signed_Final.pdf', ext: 'PDF', cat: 'Contract', expiry: 'Permanent' },
                          { name: 'NRIC_Front_Scan.jpg', ext: 'IMG', cat: 'Identification', expiry: '31 Dec 2030' },
                        ].map(doc => (
                          <tr key={doc.name} className="hover:bg-slate-50/50 transition-all">
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded bg-red-50 flex items-center justify-center text-red-500 font-black text-[9px]">{doc.ext}</div>
                                <span className="font-bold text-slate-900 truncate max-w-[180px]">{doc.name}</span>
                              </div>
                            </td>
                            <td className="px-6 py-4"><span className="text-[9px] font-black uppercase text-slate-500 border border-slate-200 px-2 py-0.5 rounded">{doc.cat}</span></td>
                            <td className="px-6 py-4"><span className="text-[9px] font-black uppercase text-red-600 bg-red-50 px-2 py-0.5 rounded">High (Enc)</span></td>
                            <td className="px-6 py-4 text-slate-400 font-bold uppercase text-[10px]">{doc.expiry}</td>
                            <td className="px-6 py-4 text-right">
                              <button className="text-indigo-600 hover:underline font-black uppercase text-[9px]">View</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
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
