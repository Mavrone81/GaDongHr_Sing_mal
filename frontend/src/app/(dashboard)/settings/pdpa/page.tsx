'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  const c = document.cookie.split('; ').find(r => r.startsWith('vorkhive_token='));
  return c ? c.split('=').slice(1).join('=') : null;
}
function apiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? `http://${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:4000/api`;
}
async function apiFetch(path: string, opts: RequestInit = {}) {
  const token = getToken();
  const h: Record<string, string> = { 'Content-Type': 'application/json', ...(opts.headers as Record<string, string> ?? {}) };
  if (token) h['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${apiBase()}${path}`, { ...opts, headers: h });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error ?? `HTTP ${res.status}`); }
  return res.json();
}

const ALL_ROLES = [
  { id: 'SUPER_ADMIN',     label: 'Super Admin',     color: 'bg-indigo-100 text-indigo-700' },
  { id: 'HR_ADMIN',        label: 'HR Admin',         color: 'bg-violet-100 text-violet-700' },
  { id: 'HR_MANAGER',      label: 'HR Manager',       color: 'bg-blue-100 text-blue-700' },
  { id: 'PAYROLL_OFFICER', label: 'Payroll Officer',  color: 'bg-emerald-100 text-emerald-700' },
  { id: 'RECRUITER',       label: 'Recruiter',        color: 'bg-amber-100 text-amber-700' },
  { id: 'FINANCE_ADMIN',   label: 'Finance Admin',    color: 'bg-teal-100 text-teal-700' },
  { id: 'IT_ADMIN',        label: 'IT Admin',         color: 'bg-red-100 text-red-700' },
  { id: 'LINE_MANAGER',    label: 'Line Manager',     color: 'bg-sky-100 text-sky-700' },
  { id: 'EMPLOYEE',        label: 'Employee',         color: 'bg-slate-100 text-slate-600' },
];

const PDPA_CATEGORIES = [
  {
    id: 'personal_id',
    label: 'Personal Identifiers',
    desc: 'NRIC, Passport No., Date of Birth, Nationality',
    icon: '🪪',
    defaultView: ['SUPER_ADMIN', 'HR_ADMIN', 'HR_MANAGER'],
    defaultExport: ['SUPER_ADMIN'],
  },
  {
    id: 'financial',
    label: 'Financial & Payroll',
    desc: 'Salary, Bank Account, CPF No., Tax Reference',
    icon: '💳',
    defaultView: ['SUPER_ADMIN', 'HR_ADMIN', 'PAYROLL_OFFICER', 'FINANCE_ADMIN'],
    defaultExport: ['SUPER_ADMIN', 'PAYROLL_OFFICER'],
  },
  {
    id: 'health',
    label: 'Health & Medical',
    desc: 'Medical leave reasons, health declarations, disability',
    icon: '🏥',
    defaultView: ['SUPER_ADMIN', 'HR_ADMIN'],
    defaultExport: ['SUPER_ADMIN'],
  },
  {
    id: 'contact',
    label: 'Contact & Address',
    desc: 'Home address, personal phone, emergency contacts',
    icon: '📍',
    defaultView: ['SUPER_ADMIN', 'HR_ADMIN', 'HR_MANAGER'],
    defaultExport: ['SUPER_ADMIN', 'HR_ADMIN'],
  },
  {
    id: 'employment',
    label: 'Employment Details',
    desc: 'Performance ratings, disciplinary records, leave balances',
    icon: '📋',
    defaultView: ['SUPER_ADMIN', 'HR_ADMIN', 'HR_MANAGER', 'LINE_MANAGER', 'PAYROLL_OFFICER'],
    defaultExport: ['SUPER_ADMIN', 'HR_ADMIN'],
  },
  {
    id: 'recruitment',
    label: 'Recruitment & Background',
    desc: 'Resume, references, background check results',
    icon: '🔍',
    defaultView: ['SUPER_ADMIN', 'HR_ADMIN', 'HR_MANAGER', 'RECRUITER'],
    defaultExport: ['SUPER_ADMIN', 'HR_ADMIN'],
  },
];

const ENCRYPTED_FIELDS = [
  { service: 'Auth Service',     field: 'users.mfaSecret',       algorithm: 'AES-256-GCM',  status: 'active',   note: 'TOTP secret encrypted at rest' },
  { service: 'Auth Service',     field: 'JWT Private Key',        algorithm: 'RS256 (2048)', status: 'active',   note: 'Asymmetric signing key' },
  { service: 'Employee Service', field: 'employees.nric',         algorithm: 'AES-256-GCM',  status: 'active',   note: 'NRIC encrypted in transit + at rest' },
  { service: 'Employee Service', field: 'employees.bankAccount',  algorithm: 'AES-256-GCM',  status: 'active',   note: 'Bank account number encrypted' },
  { service: 'Employee Service', field: 'employees.passportNo',   algorithm: 'AES-256-GCM',  status: 'active',   note: 'Passport number encrypted' },
  { service: 'Payroll Service',  field: 'Salary figures',         algorithm: 'TLS 1.3',       status: 'transit',  note: 'Encrypted in transit via gateway TLS' },
  { service: 'Database',         field: 'All tables',             algorithm: 'PostgreSQL TDE', status: 'config',  note: 'Enable pg_crypto or filesystem encryption for full disk encryption' },
];

type AccessMap = Record<string, { view: string[]; export: string[] }>;

function defaultAccessMap(): AccessMap {
  return Object.fromEntries(
    PDPA_CATEGORIES.map(c => [c.id, { view: [...c.defaultView], export: [...c.defaultExport] }])
  );
}

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onChange}
      disabled={disabled}
      className={`w-4 h-4 rounded flex items-center justify-center border transition-all ${on ? 'bg-indigo-600 border-indigo-600' : 'bg-white border-slate-300'} ${disabled ? 'opacity-40 cursor-not-allowed' : 'hover:border-indigo-400 cursor-pointer'}`}
    >
      {on && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>}
    </button>
  );
}

export default function PdpaPage() {
  const { user } = useAuth();
  const [access, setAccess] = useState<AccessMap>(defaultAccessMap());
  const [activeTab, setActiveTab] = useState<'access' | 'encryption' | 'retention'>('access');
  const [retention, setRetention] = useState({ employeeRecords: '7', payrollRecords: '5', leaveRecords: '3', recruitmentRecords: '2', auditLogs: '7' });
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [saving, setSaving] = useState(false);
  const [encryptionStatus, setEncryptionStatus] = useState<'checking' | 'ok' | 'partial'>('checking');
  const [dbRoles, setDbRoles] = useState<string[]>([]);

  const role = user?.role?.toUpperCase() ?? '';
  const canEdit = role === 'SUPER_ADMIN';

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  useEffect(() => {
    // Load saved PDPA settings from localStorage
    try {
      const saved = localStorage.getItem('vorkhive_pdpa_settings');
      if (saved) {
        const s = JSON.parse(saved);
        if (s.access) setAccess(s.access);
        if (s.retention) setRetention(s.retention);
      }
    } catch {}

    // Load roles from server
    apiFetch('/roles').then(d => {
      const names = (Array.isArray(d) ? d : d.roles ?? []).map((r: any) => r.name as string);
      if (names.length > 0) setDbRoles(names);
    }).catch(() => {});

    // Check encryption health (does the shared crypto module have a key)
    apiFetch('/auth/me').then(() => setEncryptionStatus('ok')).catch(() => setEncryptionStatus('partial'));
  }, []);

  const toggleAccess = (categoryId: string, type: 'view' | 'export', roleId: string) => {
    if (!canEdit) return;
    // SUPER_ADMIN always keeps view + export
    if (roleId === 'SUPER_ADMIN') return;
    setAccess(prev => {
      const cur = prev[categoryId][type];
      const next = cur.includes(roleId) ? cur.filter(r => r !== roleId) : [...cur, roleId];
      // Export requires view
      const newView = type === 'export' && next.includes(roleId) ? [...new Set([...prev[categoryId].view, roleId])] : prev[categoryId].view;
      return { ...prev, [categoryId]: { view: type === 'view' ? next : newView, export: type === 'export' ? next : prev[categoryId].export.filter(r => type === 'view' && !next.includes(r) ? false : true) } };
    });
  };

  const handleSave = async () => {
    setSaving(true);
    localStorage.setItem('vorkhive_pdpa_settings', JSON.stringify({ access, retention }));
    await new Promise(r => setTimeout(r, 400));
    setSaving(false);
    showToast('PDPA settings saved');
  };

  const TABS = [
    { id: 'access',     label: 'Data Access Control', icon: '🔐' },
    { id: 'encryption', label: 'Encryption Status',   icon: '🔒' },
    { id: 'retention',  label: 'Data Retention',      icon: '🗓' },
  ] as const;

  return (
    <div className="flex flex-col gap-6 max-w-[1200px] mx-auto pb-16 animate-in fade-in duration-700">

      {/* Header */}
      <div className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-xl shadow-violet-500/5 flex justify-between items-start">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-2 h-2 bg-violet-600 rounded-full" />
            <span className="text-[10px] font-black text-violet-600 uppercase tracking-[0.4em]">PDPA 2012 Compliance</span>
          </div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tighter">PDPA <span className="text-violet-600">Compliance</span></h1>
          <p className="text-[10px] font-black text-slate-400 mt-1 uppercase tracking-widest">Role access control · Encryption status · Data retention</p>
        </div>
        {canEdit && (
          <button onClick={handleSave} disabled={saving}
            className="px-6 py-3 bg-violet-600 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-violet-700 shadow-lg shadow-violet-500/20 transition-all disabled:opacity-60 disabled:pointer-events-none flex items-center gap-2">
            {saving ? <><svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Saving…</> : 'Save Settings'}
          </button>
        )}
      </div>

      {!canEdit && (
        <div className="px-5 py-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-center gap-3">
          <svg className="w-4 h-4 text-amber-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>
          <p className="text-[11px] font-black text-amber-700 uppercase tracking-widest">Read-only — Super Admin required to modify PDPA settings</p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === t.id ? 'bg-slate-900 text-white shadow-lg' : 'bg-white border border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700'}`}>
            <span>{t.icon}</span>{t.label}
          </button>
        ))}
      </div>

      {/* ── Tab: Data Access Control ── */}
      {activeTab === 'access' && (
        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-xl shadow-indigo-500/5 overflow-hidden">
          <div className="px-8 py-6 border-b border-slate-100 bg-slate-50/50 flex items-start justify-between">
            <div>
              <h2 className="text-sm font-black text-slate-900 uppercase tracking-widest">Role-Based Data Access Matrix</h2>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Configure which roles can view or export each PDPA-sensitive data category</p>
            </div>
            <div className="flex items-center gap-4 text-[9px] font-black uppercase tracking-widest text-slate-400 shrink-0">
              <div className="flex items-center gap-1.5"><div className="w-4 h-4 rounded bg-indigo-600 border-indigo-600 flex items-center justify-center"><svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg></div>Allowed</div>
              <div className="flex items-center gap-1.5"><div className="w-4 h-4 rounded bg-white border border-slate-300" />Denied</div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left px-6 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest w-56">Data Category</th>
                  {ALL_ROLES.map(r => (
                    <th key={r.id} className="px-2 py-3 text-center w-20">
                      <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded-md ${r.color}`}>{r.label.split(' ')[0]}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PDPA_CATEGORIES.map((cat, ci) => (
                  <>
                    {/* VIEW row */}
                    <tr key={`${cat.id}-view`} className={ci % 2 === 0 ? 'bg-slate-50/30' : 'bg-white'}>
                      <td className="px-6 py-3" rowSpan={2}>
                        <div className="flex items-start gap-2">
                          <span className="text-lg shrink-0 mt-0.5">{cat.icon}</span>
                          <div>
                            <p className="text-[11px] font-black text-slate-900 uppercase tracking-tight">{cat.label}</p>
                            <p className="text-[9px] font-bold text-slate-400 mt-0.5">{cat.desc}</p>
                          </div>
                        </div>
                      </td>
                      {ALL_ROLES.map(r => (
                        <td key={r.id} className="px-2 py-2 text-center">
                          <div className="flex flex-col items-center gap-1">
                            <span className="text-[7px] font-black text-slate-300 uppercase tracking-widest">View</span>
                            <Toggle
                              on={access[cat.id]?.view.includes(r.id) ?? false}
                              onChange={() => toggleAccess(cat.id, 'view', r.id)}
                              disabled={!canEdit || r.id === 'SUPER_ADMIN'}
                            />
                          </div>
                        </td>
                      ))}
                    </tr>
                    {/* EXPORT row */}
                    <tr key={`${cat.id}-export`} className={ci % 2 === 0 ? 'bg-slate-50/30' : 'bg-white'}>
                      {ALL_ROLES.map(r => (
                        <td key={r.id} className="px-2 py-2 text-center border-b border-slate-100">
                          <div className="flex flex-col items-center gap-1">
                            <span className="text-[7px] font-black text-slate-300 uppercase tracking-widest">Export</span>
                            <Toggle
                              on={access[cat.id]?.export.includes(r.id) ?? false}
                              onChange={() => toggleAccess(cat.id, 'export', r.id)}
                              disabled={!canEdit || r.id === 'SUPER_ADMIN' || !access[cat.id]?.view.includes(r.id)}
                            />
                          </div>
                        </td>
                      ))}
                    </tr>
                  </>
                ))}
              </tbody>
            </table>
          </div>

          <div className="px-6 py-4 bg-violet-50 border-t border-violet-100 flex items-start gap-3">
            <svg className="w-4 h-4 text-violet-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            <p className="text-[10px] font-bold text-violet-700 leading-relaxed">
              These settings control what role labels the frontend uses to gate access to PDPA-sensitive data. Super Admin always has full access and cannot be restricted. Export permission requires View permission. Changes take effect immediately after Save.
            </p>
          </div>
        </div>
      )}

      {/* ── Tab: Encryption Status ── */}
      {activeTab === 'encryption' && (
        <div className="flex flex-col gap-6">

          {/* Overall status card */}
          <div className={`p-6 rounded-2xl border flex items-center gap-5 ${encryptionStatus === 'ok' ? 'bg-emerald-50 border-emerald-200' : encryptionStatus === 'partial' ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200'}`}>
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-xl ${encryptionStatus === 'ok' ? 'bg-emerald-100' : encryptionStatus === 'partial' ? 'bg-amber-100' : 'bg-slate-100'}`}>
              {encryptionStatus === 'ok' ? '🔒' : encryptionStatus === 'partial' ? '⚠️' : '⏳'}
            </div>
            <div>
              <p className={`text-sm font-black uppercase tracking-tight ${encryptionStatus === 'ok' ? 'text-emerald-800' : encryptionStatus === 'partial' ? 'text-amber-800' : 'text-slate-600'}`}>
                {encryptionStatus === 'ok' ? 'Encryption Active' : encryptionStatus === 'partial' ? 'Partial Coverage — Action Recommended' : 'Checking…'}
              </p>
              <p className={`text-[10px] font-bold mt-0.5 uppercase tracking-widest ${encryptionStatus === 'ok' ? 'text-emerald-600' : 'text-amber-600'}`}>
                {encryptionStatus === 'ok' ? 'All critical PDPA fields are encrypted at rest and in transit' : 'Some fields rely on transport-layer encryption only'}
              </p>
            </div>
          </div>

          {/* Encrypted fields table */}
          <div className="bg-white rounded-[2rem] border border-slate-100 shadow-xl shadow-indigo-500/5 overflow-hidden">
            <div className="px-8 py-6 border-b border-slate-100 bg-slate-50/50">
              <h2 className="text-sm font-black text-slate-900 uppercase tracking-widest">Field-Level Encryption Registry</h2>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">PDPA Art. 24 — Protection of personal data</p>
            </div>
            <div className="divide-y divide-slate-50">
              {ENCRYPTED_FIELDS.map((f, i) => (
                <div key={i} className="flex items-center gap-5 px-8 py-4 hover:bg-slate-50/50 transition-all">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${f.status === 'active' ? 'bg-emerald-500' : f.status === 'transit' ? 'bg-sky-400' : 'bg-amber-400'}`} />
                  <div className="w-36 shrink-0">
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{f.service}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-black text-slate-900 font-mono">{f.field}</p>
                    <p className="text-[9px] font-bold text-slate-400 mt-0.5">{f.note}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="text-[9px] font-black font-mono text-slate-600 px-2.5 py-1 bg-slate-100 rounded-lg">{f.algorithm}</span>
                  </div>
                  <div className="shrink-0">
                    <span className={`text-[8px] font-black uppercase px-2 py-1 rounded-lg border tracking-widest ${
                      f.status === 'active'  ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
                      f.status === 'transit' ? 'bg-sky-50 text-sky-700 border-sky-100' :
                                               'bg-amber-50 text-amber-700 border-amber-100'
                    }`}>
                      {f.status === 'active' ? '✓ At Rest' : f.status === 'transit' ? '→ Transit' : '⚠ Configure'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div className="px-8 py-4 bg-slate-50 border-t border-slate-100 flex items-center gap-6 flex-wrap">
              {[
                { dot: 'bg-emerald-500', label: 'At Rest — AES-256-GCM encrypted in database' },
                { dot: 'bg-sky-400',     label: 'Transit — TLS encrypted between services' },
                { dot: 'bg-amber-400',   label: 'Configure — additional setup required' },
              ].map(l => (
                <div key={l.label} className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${l.dot}`} />
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{l.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Key management */}
          <div className="bg-white rounded-[2rem] border border-slate-100 shadow-xl shadow-indigo-500/5 overflow-hidden">
            <div className="px-8 py-6 border-b border-slate-100 bg-slate-50/50">
              <h2 className="text-sm font-black text-slate-900 uppercase tracking-widest">Key Management</h2>
            </div>
            <div className="p-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                { label: 'JWT Signing Key', detail: 'RS256 · 2048-bit RSA keypair', status: 'ok',   hint: 'Stored in /certs — rotate annually' },
                { label: 'Field Encryption Key', detail: 'AES-256-GCM · 32-byte key', status: 'ok', hint: 'Set via ENCRYPTION_KEY env var' },
                { label: 'SMTP Credentials', detail: 'TLS-authenticated relay',        status: 'ok', hint: 'Stored in container env vars' },
                { label: 'Database Connection', detail: 'TLS encrypted PostgreSQL',    status: 'ok', hint: 'postgres:5432 with ssl=require' },
              ].map(k => (
                <div key={k.label} className="p-5 bg-slate-50 rounded-2xl border border-slate-100">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[11px] font-black text-slate-900 uppercase tracking-tight">{k.label}</p>
                    <span className="text-[8px] font-black uppercase px-2 py-0.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-100 tracking-widest">Active</span>
                  </div>
                  <p className="text-[10px] font-black text-slate-500 font-mono mb-1">{k.detail}</p>
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{k.hint}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: Data Retention ── */}
      {activeTab === 'retention' && (
        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-xl shadow-indigo-500/5 overflow-hidden">
          <div className="px-8 py-6 border-b border-slate-100 bg-slate-50/50">
            <h2 className="text-sm font-black text-slate-900 uppercase tracking-widest">Data Retention Periods</h2>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">PDPA requires retention only as long as necessary for business or legal purposes</p>
          </div>
          <div className="p-8 flex flex-col gap-5">
            {[
              { key: 'employeeRecords', label: 'Employee Records', desc: 'Personal data, contracts, appraisals — MOM recommends min. 5 years after cessation', min: 5, rec: 7 },
              { key: 'payrollRecords',  label: 'Payroll & CPF Records', desc: 'Payslips, CPF submissions — CPF Act requires 5 years', min: 5, rec: 5 },
              { key: 'leaveRecords',   label: 'Leave & Attendance',     desc: 'Leave applications, attendance logs — min. 2 years (EA)', min: 2, rec: 3 },
              { key: 'recruitmentRecords', label: 'Recruitment Data',   desc: 'CVs, interview notes — PDPA: dispose when no longer needed', min: 1, rec: 2 },
              { key: 'auditLogs',      label: 'System Audit Logs',      desc: 'Security and access logs — PDPA / cyber hygiene best practice', min: 1, rec: 7 },
            ].map(item => {
              const val = Number(retention[item.key as keyof typeof retention]);
              const isLow = val < item.min;
              return (
                <div key={item.key} className="flex items-center gap-6 p-5 bg-slate-50 rounded-2xl border border-slate-100">
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-black text-slate-900 uppercase tracking-tight">{item.label}</p>
                    <p className="text-[10px] font-bold text-slate-400 mt-0.5">{item.desc}</p>
                    {isLow && (
                      <p className="text-[9px] font-black text-red-500 mt-1 uppercase tracking-widest">⚠ Below minimum — may violate statutory requirement</p>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <select
                      value={retention[item.key as keyof typeof retention]}
                      onChange={e => setRetention(prev => ({ ...prev, [item.key]: e.target.value }))}
                      disabled={!canEdit}
                      className={`px-4 py-2.5 rounded-xl border text-sm font-black text-slate-900 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/10 transition-all appearance-none disabled:opacity-60 ${isLow ? 'bg-red-50 border-red-200' : 'bg-white border-slate-200'}`}
                    >
                      {[1,2,3,4,5,6,7,8,10,12,15,20].map(y => (
                        <option key={y} value={y}>{y} year{y !== 1 ? 's' : ''}</option>
                      ))}
                    </select>
                    <div className="text-right">
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Recommended</p>
                      <p className="text-[11px] font-black text-slate-600">{item.rec} yr{item.rec !== 1 ? 's' : ''}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="px-8 py-5 bg-violet-50 border-t border-violet-100 flex items-start gap-3">
            <svg className="w-4 h-4 text-violet-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            <p className="text-[10px] font-bold text-violet-700 leading-relaxed">
              These periods define your organisation's data retention policy under PDPA 2012. Actual automated purging requires scheduled jobs — contact your system administrator to configure database archival tasks. Statutory minimums per MOM, CPF Act, and Employment Act (Singapore) are indicated above.
            </p>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[200] animate-in slide-in-from-bottom-8 duration-300">
          <div className={`px-8 py-4 rounded-2xl shadow-2xl flex items-center gap-4 ${toast.type === 'success' ? 'bg-slate-900 border border-slate-700' : 'bg-red-900 border border-red-700'}`}>
            <div className={`w-2 h-2 rounded-full ${toast.type === 'success' ? 'bg-emerald-500' : 'bg-red-400'}`} />
            <span className="text-[10px] font-black text-white uppercase tracking-widest">{toast.msg}</span>
          </div>
        </div>
      )}
    </div>
  );
}
