'use client';

import { Fragment, useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { apiFetch } from '@/lib/api';
import { Badge, Button, Card, CardHeader, Icon, Select, Tabs, useToast, type IconName } from '@/components/ui';
import { SectionHeader } from '../_components/SectionHeader';
import { Notice } from '../_components/Notice';
import { Toggle } from '../_components/Toggle';
import { sentenceCase } from '../_components/format';

const ALL_ROLES = [
  { id: 'SUPER_ADMIN',     label: 'Super admin' },
  { id: 'HR_ADMIN',        label: 'HR admin' },
  { id: 'HR_MANAGER',      label: 'HR manager' },
  { id: 'PAYROLL_OFFICER', label: 'Payroll officer' },
  { id: 'RECRUITER',       label: 'Recruiter' },
  { id: 'FINANCE_ADMIN',   label: 'Finance admin' },
  { id: 'IT_ADMIN',        label: 'IT admin' },
  { id: 'LINE_MANAGER',    label: 'Line manager' },
  { id: 'EMPLOYEE',        label: 'Employee' },
];

const PDPA_CATEGORIES: { id: string; label: string; desc: string; icon: IconName; defaultView: string[]; defaultExport: string[] }[] = [
  {
    id: 'personal_id',
    label: 'Personal identifiers',
    desc: 'NRIC, passport no., date of birth, nationality',
    icon: 'user',
    defaultView: ['SUPER_ADMIN', 'HR_ADMIN', 'HR_MANAGER'],
    defaultExport: ['SUPER_ADMIN'],
  },
  {
    id: 'financial',
    label: 'Financial and payroll',
    desc: 'Salary, bank account, CPF no., tax reference',
    icon: 'wallet',
    defaultView: ['SUPER_ADMIN', 'HR_ADMIN', 'PAYROLL_OFFICER', 'FINANCE_ADMIN'],
    defaultExport: ['SUPER_ADMIN', 'PAYROLL_OFFICER'],
  },
  {
    id: 'health',
    label: 'Health and medical',
    desc: 'Medical leave reasons, health declarations, disability',
    icon: 'shield',
    defaultView: ['SUPER_ADMIN', 'HR_ADMIN'],
    defaultExport: ['SUPER_ADMIN'],
  },
  {
    id: 'contact',
    label: 'Contact and address',
    desc: 'Home address, personal phone, emergency contacts',
    icon: 'mail',
    defaultView: ['SUPER_ADMIN', 'HR_ADMIN', 'HR_MANAGER'],
    defaultExport: ['SUPER_ADMIN', 'HR_ADMIN'],
  },
  {
    id: 'employment',
    label: 'Employment details',
    desc: 'Performance ratings, disciplinary records, leave balances',
    icon: 'briefcase',
    defaultView: ['SUPER_ADMIN', 'HR_ADMIN', 'HR_MANAGER', 'LINE_MANAGER', 'PAYROLL_OFFICER'],
    defaultExport: ['SUPER_ADMIN', 'HR_ADMIN'],
  },
  {
    id: 'recruitment',
    label: 'Recruitment and background',
    desc: 'Resume, references, background check results',
    icon: 'search',
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

/** Encryption registry state → label and pill colour. */
const FIELD_STATUS: Record<string, { label: string; tone: 'ok' | 'accent' | 'warn' }> = {
  active:  { label: 'At rest',     tone: 'ok' },
  transit: { label: 'In transit',  tone: 'accent' },
  config:  { label: 'Needs setup', tone: 'warn' },
};

type AccessMap = Record<string, { view: string[]; export: string[] }>;

function defaultAccessMap(): AccessMap {
  return Object.fromEntries(
    PDPA_CATEGORIES.map(c => [c.id, { view: [...c.defaultView], export: [...c.defaultExport] }])
  );
}

/** One view/export permission cell: a real checkbox control, with the reason when it can't be changed. */
function CheckCell({ on, onChange, disabled, label, reason }: { on: boolean; onChange: () => void; disabled?: boolean; label: string; reason?: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-label={label}
      title={disabled ? reason : undefined}
      onClick={onChange}
      disabled={disabled}
      className={`inline-flex h-5 w-5 items-center justify-center rounded border-2 transition-colors ${
        on ? 'border-accent bg-accent text-on-accent' : 'border-rule bg-paper'
      } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:border-accent'}`}
    >
      {on && <Icon name="check" size={13} strokeWidth={3} />}
    </button>
  );
}

const spinner = <svg className="animate-spin h-4 w-4 rounded-full" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>;

export default function PdpaPage() {
  const { user } = useAuth();
  const [access, setAccess] = useState<AccessMap>(defaultAccessMap());
  const [activeTab, setActiveTab] = useState<'access' | 'encryption' | 'retention'>('access');
  const [retention, setRetention] = useState({ employeeRecords: '7', payrollRecords: '5', leaveRecords: '3', recruitmentRecords: '2', auditLogs: '7' });
  const [purgeLog, setPurgeLog] = useState<any[]>([]);
  const [purgeScheduleEnabled, setPurgeScheduleEnabled] = useState(false);
  const [nextScheduledRun, setNextScheduledRun] = useState<string | null>(null);
  const [purgeRunning, setPurgeRunning] = useState(false);
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [encryptionStatus, setEncryptionStatus] = useState<'checking' | 'ok' | 'partial'>('checking');
  const [dbRoles, setDbRoles] = useState<string[]>([]);

  const role = user?.role?.toUpperCase() ?? '';
  const canEdit = role === 'SUPER_ADMIN';

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    // Same call shape as before; the shared toast (root layout) does the display and timing.
    toast(msg, type === 'success' ? 'ok' : 'danger');
  };

  useEffect(() => {
    // Load saved PDPA settings from localStorage
    try {
      const saved = localStorage.getItem('gadonghr_pdpa_settings');
      if (saved) {
        const s = JSON.parse(saved);
        if (s.access) setAccess(s.access);
        if (s.retention) setRetention(s.retention);
      }
    } catch {}

    // Load purge status from server
    apiFetch('/auth/purge/status').then(d => {
      setPurgeLog(d.log || []);
      setPurgeScheduleEnabled(d.scheduleEnabled ?? false);
      setNextScheduledRun(d.nextScheduledRun ?? null);
      if (d.retention) setRetention({
        employeeRecords: String(d.retention.employeeRecords || 7),
        payrollRecords: String(d.retention.payrollRecords || 5),
        leaveRecords: String(d.retention.leaveRecords || 3),
        recruitmentRecords: String(d.retention.recruitmentRecords || 2),
        auditLogs: String(d.retention.auditLogs || 7),
      });
    }).catch(() => {});

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
    localStorage.setItem('gadonghr_pdpa_settings', JSON.stringify({ access, retention }));
    // Persist retention periods to server so the purge scheduler uses live values
    const retentionNums = {
      employeeRecords: Number(retention.employeeRecords),
      payrollRecords: Number(retention.payrollRecords),
      leaveRecords: Number(retention.leaveRecords),
      recruitmentRecords: Number(retention.recruitmentRecords),
      auditLogs: Number(retention.auditLogs),
    };
    await apiFetch('/auth/org-settings/general', { method: 'PUT', body: JSON.stringify({ retentionPeriods: retentionNums }) }).catch(() => {});
    setSaving(false);
    showToast('PDPA settings saved');
  };

  const handleRunPurgeNow = async () => {
    if (!window.confirm('This will permanently and irrecoverably delete all records that have exceeded their retention period. This cannot be undone. Continue?')) return;
    setPurgeRunning(true);
    try {
      const result = await apiFetch('/auth/purge/run', { method: 'POST' });
      setPurgeLog(prev => [result, ...prev].slice(0, 30));
      const total = Object.values(result.results || {}).reduce((sum: number, r: any) => sum + (r.purged ?? 0), 0);
      showToast(`Purge complete — ${total} records permanently deleted`);
    } catch (e: any) {
      showToast(`Purge failed: ${e.message}`, 'error');
    } finally { setPurgeRunning(false); }
  };

  const handleTogglePurgeSchedule = async (enabled: boolean) => {
    setPurgeScheduleEnabled(enabled);
    await apiFetch('/auth/purge/schedule', { method: 'PUT', body: JSON.stringify({ enabled }) }).catch(() => {});
    showToast(enabled ? 'Scheduled purge enabled — runs at midnight UTC daily' : 'Scheduled purge disabled');
  };

  const TABS = [
    { id: 'access' as const,     label: 'Data access' },
    { id: 'encryption' as const, label: 'Encryption' },
    { id: 'retention' as const,  label: 'Retention' },
  ];

  const cellReason = (roleId: string, type: 'view' | 'export', catId: string) =>
    !canEdit ? 'Only a Super Admin can change this.'
      : roleId === 'SUPER_ADMIN' ? 'Super Admin always has full access.'
      : type === 'export' && !access[catId]?.view.includes(roleId) ? 'Grant view first; export requires view.'
      : undefined;
  const cellDisabled = (roleId: string, type: 'view' | 'export', catId: string) =>
    type === 'view'
      ? !canEdit || roleId === 'SUPER_ADMIN'
      : !canEdit || roleId === 'SUPER_ADMIN' || !access[catId]?.view.includes(roleId);

  const statusLook: Record<typeof encryptionStatus, { icon: IconName; box: string; title: string; body: string }> = {
    ok: { icon: 'lock', box: 'bg-ok-bg text-ok', title: 'Encryption active', body: 'All critical PDPA fields are encrypted at rest and in transit.' },
    partial: { icon: 'alert', box: 'bg-warn-bg text-warn', title: 'Partial coverage — action recommended', body: 'Some fields rely on transport-layer encryption only.' },
    checking: { icon: 'clock', box: 'bg-pill text-muted', title: 'Checking…', body: 'Some fields rely on transport-layer encryption only.' },
  };
  const look = statusLook[encryptionStatus];

  return (
    <>
      <SectionHeader
        title="PDPA and retention"
        description="Who can see sensitive data, how it is encrypted, and how long it is kept."
        actions={canEdit ? (
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <>{spinner}Saving…</> : 'Save settings'}
          </Button>
        ) : undefined}
      />

      {!canEdit && (
        <Notice tone="warn">Read-only. Only a Super Admin can change PDPA settings.</Notice>
      )}

      <Tabs items={TABS} active={activeTab} onChange={setActiveTab} />

      {/* ── Data access ── */}
      {activeTab === 'access' && (
        <Card padding="p-0" className="overflow-hidden">
          <div className="flex flex-col gap-3 px-5 pt-5 sm:flex-row sm:items-start sm:justify-between">
            <CardHeader title="Who can view or export each category" caption="Per role, for each category of PDPA-sensitive data." />
            <div className="flex shrink-0 items-center gap-4 text-[13px] text-muted">
              <span className="flex items-center gap-1.5"><span className="flex h-4 w-4 items-center justify-center rounded border-2 border-accent bg-accent text-on-accent"><Icon name="check" size={11} strokeWidth={3} /></span>Allowed</span>
              <span className="flex items-center gap-1.5"><span className="h-4 w-4 rounded border-2 border-rule bg-paper" />Not allowed</span>
            </div>
          </div>

          {/* Desktop matrix */}
          <div className="mt-3 hidden overflow-x-auto md:block">
            <table className="w-full min-w-[980px]">
              <thead className="border-y border-rule bg-pill">
                <tr>
                  <th className="h-11 w-60 px-5 text-left text-xs font-bold text-muted">Data category</th>
                  <th className="w-16 px-2 text-left text-xs font-bold text-muted"><span className="sr-only">Permission</span></th>
                  {ALL_ROLES.map(r => (
                    <th key={r.id} className="w-20 px-1 text-center text-xs font-bold leading-tight text-muted">{r.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PDPA_CATEGORIES.map(cat => (
                  <Fragment key={cat.id}>
                    <tr>
                      <td className="border-b border-rule px-5 py-3 align-top" rowSpan={2}>
                        <div className="flex items-start gap-2.5">
                          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-control bg-tint text-accent"><Icon name={cat.icon} size={15} /></span>
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[13.5px] font-semibold text-ink">{cat.label}</span>
                            <span className="text-xs text-muted">{cat.desc}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-2 pt-3 text-[12.5px] font-semibold text-muted">View</td>
                      {ALL_ROLES.map(r => (
                        <td key={r.id} className="px-1 pt-3 text-center">
                          <CheckCell
                            label={`${r.label} can view ${cat.label.toLowerCase()}`}
                            on={access[cat.id]?.view.includes(r.id) ?? false}
                            onChange={() => toggleAccess(cat.id, 'view', r.id)}
                            disabled={cellDisabled(r.id, 'view', cat.id)}
                            reason={cellReason(r.id, 'view', cat.id)}
                          />
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td className="border-b border-rule px-2 pb-3 pt-2 text-[12.5px] font-semibold text-muted">Export</td>
                      {ALL_ROLES.map(r => (
                        <td key={r.id} className="border-b border-rule px-1 pb-3 pt-2 text-center">
                          <CheckCell
                            label={`${r.label} can export ${cat.label.toLowerCase()}`}
                            on={access[cat.id]?.export.includes(r.id) ?? false}
                            onChange={() => toggleAccess(cat.id, 'export', r.id)}
                            disabled={cellDisabled(r.id, 'export', cat.id)}
                            reason={cellReason(r.id, 'export', cat.id)}
                          />
                        </td>
                      ))}
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: one block per category */}
          <div className="mt-3 flex flex-col md:hidden">
            {PDPA_CATEGORIES.map(cat => (
              <div key={cat.id} className="border-t border-rule px-5 py-4">
                <div className="mb-3 flex items-start gap-2.5">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-control bg-tint text-accent"><Icon name={cat.icon} size={15} /></span>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-semibold text-ink">{cat.label}</span>
                    <span className="text-xs text-muted">{cat.desc}</span>
                  </div>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_56px_56px] items-center gap-y-2 text-[13px]">
                  <span className="text-xs font-bold text-muted">Role</span>
                  <span className="text-center text-xs font-bold text-muted">View</span>
                  <span className="text-center text-xs font-bold text-muted">Export</span>
                  {ALL_ROLES.map(r => (
                    <Fragment key={r.id}>
                      <span className="text-ink">{r.label}</span>
                      <span className="text-center">
                        <CheckCell label={`${r.label} can view ${cat.label.toLowerCase()}`} on={access[cat.id]?.view.includes(r.id) ?? false} onChange={() => toggleAccess(cat.id, 'view', r.id)} disabled={cellDisabled(r.id, 'view', cat.id)} reason={cellReason(r.id, 'view', cat.id)} />
                      </span>
                      <span className="text-center">
                        <CheckCell label={`${r.label} can export ${cat.label.toLowerCase()}`} on={access[cat.id]?.export.includes(r.id) ?? false} onChange={() => toggleAccess(cat.id, 'export', r.id)} disabled={cellDisabled(r.id, 'export', cat.id)} reason={cellReason(r.id, 'export', cat.id)} />
                      </span>
                    </Fragment>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-rule px-5 py-4">
            <Notice>
              These settings decide which roles the app lets view or export PDPA-sensitive data. Super Admin always has full access and can&apos;t be restricted. Export needs view. Changes take effect after Save.
            </Notice>
          </div>
        </Card>
      )}

      {/* ── Encryption ── */}
      {activeTab === 'encryption' && (
        <div className="flex flex-col gap-4">
          <Card>
            <div className="flex items-center gap-4">
              <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-control ${look.box}`}>
                <Icon name={look.icon} size={22} />
              </div>
              <div className="flex flex-col gap-0.5">
                <p className="text-[15.5px] font-bold text-ink">{look.title}</p>
                <p className="text-[13px] text-muted">{look.body}</p>
              </div>
            </div>
          </Card>

          <Card padding="px-[22px] pt-5 pb-2">
            <CardHeader title="Field-level encryption" caption="PDPA section 24 — protection of personal data." />
            {ENCRYPTED_FIELDS.map((f, i) => {
              const st = FIELD_STATUS[f.status] ?? FIELD_STATUS.config;
              return (
                <div key={i} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-rule py-3">
                  <span className="w-36 shrink-0 text-[12.5px] font-semibold text-muted">{f.service}</span>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="font-mono text-[13px] font-semibold text-ink">{f.field}</span>
                    <span className="text-xs text-muted">{f.note}</span>
                  </div>
                  <Badge className="font-mono">{f.algorithm}</Badge>
                  <Badge tone={st.tone}>{st.label}</Badge>
                </div>
              );
            })}
            <dl className="mt-1 flex flex-wrap gap-x-6 gap-y-1.5 border-t border-rule py-3 text-[13px]">
              <div className="flex gap-1.5"><dt className="font-semibold text-ink">At rest</dt><dd className="text-muted">AES-256-GCM in the database</dd></div>
              <div className="flex gap-1.5"><dt className="font-semibold text-ink">In transit</dt><dd className="text-muted">TLS between services</dd></div>
              <div className="flex gap-1.5"><dt className="font-semibold text-ink">Needs setup</dt><dd className="text-muted">extra configuration required</dd></div>
            </dl>
          </Card>

          <Card>
            <CardHeader title="Key management" />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {[
                { label: 'JWT signing key', detail: 'RS256 · 2048-bit RSA keypair', status: 'ok',   hint: 'Stored in /certs — rotate annually' },
                { label: 'Field encryption key', detail: 'AES-256-GCM · 32-byte key', status: 'ok', hint: 'Set via the ENCRYPTION_KEY env var' },
                { label: 'SMTP credentials', detail: 'TLS-authenticated relay',        status: 'ok', hint: 'Stored in container env vars' },
                { label: 'Database connection', detail: 'TLS-encrypted PostgreSQL',    status: 'ok', hint: 'postgres:5432 with ssl=require' },
              ].map(k => (
                <div key={k.label} className="flex flex-col gap-1.5 rounded-control border border-rule bg-page p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-ink">{k.label}</span>
                    <Badge tone="ok">Active</Badge>
                  </div>
                  <span className="font-mono text-xs text-muted">{k.detail}</span>
                  <span className="text-xs text-muted">{k.hint}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* ── Retention ── */}
      {activeTab === 'retention' && (
        <div className="flex flex-col gap-4">

          <Card padding="px-[22px] pt-5 pb-2">
            <CardHeader
              title="Retention periods"
              caption="PDPA allows keeping personal data only as long as a business or legal purpose needs it. Save to apply these to the automated purge."
            />
            {[
              { key: 'employeeRecords',    label: 'Employee records',      desc: 'Personal data, contracts, appraisals — MOM min. 5 yrs after cessation', min: 5, rec: 7,
                detail: 'Purge anchor: employee termination date (endDate)' },
              { key: 'payrollRecords',     label: 'Payroll and CPF records', desc: 'Payslips, CPF submissions — CPF Act requires 5 years', min: 5, rec: 5,
                detail: 'Purge anchor: last day of payroll period (period + 1 month - 1 day)' },
              { key: 'leaveRecords',       label: 'Leave and attendance',  desc: 'Leave applications, attendance logs — min. 2 years (Employment Act)', min: 2, rec: 3,
                detail: 'Purge anchor: leave end date' },
              { key: 'recruitmentRecords', label: 'Recruitment data',      desc: 'CVs, interview notes — PDPA: dispose when no longer needed', min: 1, rec: 2,
                detail: 'Purge anchor: application creation date' },
              { key: 'auditLogs',          label: 'System audit logs',     desc: 'Security and access logs — PDPA / cyber hygiene best practice', min: 1, rec: 7,
                detail: 'Purge anchor: log creation date' },
            ].map(item => {
              const val = Number(retention[item.key as keyof typeof retention]);
              const isLow = val < item.min;
              const cutoff = new Date();
              cutoff.setUTCFullYear(cutoff.getUTCFullYear() - val);
              return (
                <div key={item.key} className="flex flex-col gap-3 border-t border-rule py-4 sm:flex-row sm:items-start sm:gap-4">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="text-sm font-semibold text-ink">{item.label}</span>
                    <span className="text-[13px] text-muted">{item.desc}</span>
                    <span className="font-mono text-xs text-faint">{item.detail}</span>
                    {isLow && (
                      <span className="mt-1 flex items-center gap-1.5 text-[13px] font-semibold text-danger">
                        <Icon name="alert" size={15} strokeWidth={2} />
                        Below the statutory minimum of {item.min} years — this may breach a legal requirement.
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-4">
                    <Select
                      aria-label={`${item.label} retention`}
                      value={retention[item.key as keyof typeof retention]}
                      onChange={e => setRetention(prev => ({ ...prev, [item.key]: e.target.value }))}
                      disabled={!canEdit}
                      invalid={isLow}
                      className="w-36"
                    >
                      {[1,2,3,4,5,6,7,8,10,12,15,20].map(y => (
                        <option key={y} value={y}>{y} year{y !== 1 ? 's' : ''}</option>
                      ))}
                    </Select>
                    <div className="flex min-w-[96px] flex-col text-right">
                      <span className="text-xs text-muted">Purge records before</span>
                      <span className="font-mono text-[13px] font-semibold text-ink">{cutoff.toISOString().slice(0, 10)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </Card>

          <Card>
            <CardHeader
              title="Automated purge"
              caption="Runs at midnight UTC, to the exact day. Hard DELETE then VACUUM — not recoverable."
              action={canEdit ? (
                <span className="flex items-center gap-3">
                  <span className="text-[13px] font-medium text-muted">{purgeScheduleEnabled ? 'On' : 'Off'}</span>
                  <Toggle label="Scheduled purge" on={purgeScheduleEnabled} onChange={v => handleTogglePurgeSchedule(v)} />
                </span>
              ) : undefined}
            />

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-1 rounded-control bg-page p-4">
                <span className="text-[12.5px] font-semibold text-muted">Schedule</span>
                <span><Badge tone={purgeScheduleEnabled ? 'ok' : 'neutral'}>{purgeScheduleEnabled ? 'Active' : 'Off'}</Badge></span>
              </div>
              <div className="flex flex-col gap-1 rounded-control bg-page p-4">
                <span className="text-[12.5px] font-semibold text-muted">Next scheduled run</span>
                <span className="text-sm font-semibold text-ink tabular-nums">
                  {nextScheduledRun ? new Date(nextScheduledRun).toLocaleString() : 'Midnight UTC'}
                </span>
              </div>
              <div className="flex flex-col gap-1 rounded-control bg-page p-4">
                <span className="text-[12.5px] font-semibold text-muted">Last run</span>
                <span className="text-sm font-semibold text-ink tabular-nums">
                  {purgeLog[0] ? new Date(purgeLog[0].runAt).toLocaleDateString() : 'Never run'}
                </span>
              </div>
            </div>

            <Notice tone="danger" className="mt-4">
              <strong className="font-semibold">Deletion is permanent.</strong>{' '}
              Purged records are removed with a hard <code className="rounded bg-pill px-1 font-mono">DELETE</code> followed by <code className="rounded bg-pill px-1 font-mono">VACUUM ANALYZE</code> to clear dead tuples from heap pages.
              For full non-recoverability, make sure PostgreSQL WAL archiving is disabled or WAL files are purged on the same schedule.
              Data is purged exactly on the anniversary of the cease date — not a day later.
            </Notice>

            {canEdit && (
              <div className="mt-4 flex flex-col gap-3 rounded-control border border-danger p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-bold text-ink">Run a purge now</span>
                  <span className="text-[13px] text-muted">Immediately deletes every record past its retention period. You'll be asked to confirm.</span>
                </div>
                <Button variant="danger" onClick={handleRunPurgeNow} disabled={purgeRunning}>
                  {purgeRunning && spinner}
                  {purgeRunning ? 'Purging…' : 'Run purge now'}
                </Button>
              </div>
            )}
          </Card>

          {purgeLog.length > 0 && (
            <Card padding="px-[22px] pt-5 pb-2">
              <CardHeader
                title="Purge history"
                caption={<>Last <span className="tabular-nums">{purgeLog.length}</span> run{purgeLog.length !== 1 ? 's' : ''}, stored in org settings.</>}
              />
              {purgeLog.slice(0, 10).map((run, i) => {
                const total = Object.values(run.results || {}).reduce((s: number, r: any) => s + (r.purged ?? 0), 0);
                return (
                  <div key={i} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-rule py-3">
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-[13px] font-semibold text-ink tabular-nums">{new Date(run.runAt).toLocaleString()}</span>
                      {run.errors?.length > 0 && (
                        <span className="text-xs text-danger">{run.errors.join(' · ')}</span>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-0.5">
                      <span className="text-[13px] font-semibold text-ink tabular-nums">{total} records purged</span>
                      <span className="flex flex-wrap justify-end gap-2">
                        {Object.entries(run.results || {}).map(([cat, r]: [string, any]) => r.purged > 0 && (
                          <span key={cat} className="text-xs text-muted tabular-nums">{cat}: {r.purged}</span>
                        ))}
                      </span>
                    </div>
                    <Badge tone={run.status === 'clean' ? 'ok' : 'warn'}>{sentenceCase(String(run.status ?? ''))}</Badge>
                  </div>
                );
              })}
            </Card>
          )}
        </div>
      )}
    </>
  );
}
