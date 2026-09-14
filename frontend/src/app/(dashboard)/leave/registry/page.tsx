'use client';

import { useState, useEffect, useMemo, type ReactNode } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { apiFetch, apiFetchRaw } from '@/lib/api';
import { PageHeader, Stat, Card, CardHeader, Tabs, DataTable, Badge, Button, Field, Input, EmptyState, Modal, useToast, Icon, SplitPane, InboxList, Avatar, type Column } from '@/components/ui';

const ALLOWED_ROLES = ['SUPER_ADMIN', 'HR_ADMIN', 'HR_MANAGER', 'PAYROLL_OFFICER'];

function fmtDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
}

interface PendingLeave {
  id: string; employeeId: string; employeeName: string; employeeCode?: string; designation?: string; dept: string;
  leaveTypeName: string; from: string; to: string; days: number; reason: string;
  hasAttachment: boolean;
}

interface LeaveDetail {
  id: string;
  employeeId: string;
  status: string;
  startDate: string;
  endDate: string;
  totalDays: number;
  reason: string | null;
  createdAt: string;
  isHalfDay: boolean;
  halfDaySlot: string | null;
  leaveType?: { code: string; name: string; isPaid: boolean; requiresDocument: boolean };
  employee?: { id: string; fullName: string; employeeCode: string; department: string; designation: string; workEmail: string; profilePhotoUrl: string | null };
  attachment?: { fileName: string; mimeType: string; downloadUrl: string } | null;
  approvalSteps?: { step: number; approvedByEmpId: string; approvedAt: string }[];
}

interface LeaveType {
  id: string; code: string; name: string; isPaid: boolean; isStatutory: boolean;
  annualEntitlement: number; maxCarryForward: number; isGovtPaid: boolean;
  requiresDocument: boolean; minNoticeDays: number; isActive: boolean;
}

const BLANK_TYPE: Omit<LeaveType, 'id' | 'isActive'> = {
  code: '', name: '', isPaid: true, isStatutory: false,
  annualEntitlement: 0, maxCarryForward: 0, isGovtPaid: false,
  requiresDocument: false, minNoticeDays: 0,
};

export default function LeaveRegistryPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-10 h-10 border-4 border-t-accent border-accent animate-spin rounded-full" />
      </div>
    );
  }

  const role = user?.role?.toUpperCase() ?? '';
  if (!ALLOWED_ROLES.includes(role)) {
    router.replace('/leave');
    return null;
  }

  return <AdminLeaveView />;
}

interface TeamMember {
  id: string; fullName: string; designation: string; department: string; employeeCode: string;
}
interface TeamLeave {
  id: string; employeeId: string; startDate: string; endDate: string; totalDays: number;
  leaveType: { name: string; isPaid: boolean; code: string };
  status: string;
}

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAY_LABELS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function TeamCalendar({ subordinates }: { subordinates: TeamMember[] }) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth()); // 0-indexed
  const [teamLeaves, setTeamLeaves] = useState<TeamLeave[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (subordinates.length === 0) return;
    setLoading(true);
    const from = new Date(year, month, 1).toISOString().slice(0, 10);
    const to = new Date(year, month + 1, 0).toISOString().slice(0, 10);
    const ids = subordinates.map(s => s.id);
    Promise.all(
      ids.map(id => apiFetch(`/leave/applications?employeeId=${id}&status=APPROVED&startDateFrom=${from}&startDateTo=${to}&limit=50`).catch(() => ({ applications: [] })))
    ).then(results => {
      setTeamLeaves(results.flatMap(r => r.applications ?? []));
    }).finally(() => setLoading(false));
  }, [subordinates, year, month]);

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const calDays = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  const leaveMap = useMemo(() => {
    const m: Record<string, TeamLeave[]> = {};
    teamLeaves.forEach(lv => {
      const start = new Date(lv.startDate);
      const end = new Date(lv.endDate);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const key = d.toISOString().slice(0, 10);
        if (!m[key]) m[key] = [];
        m[key].push(lv);
      }
    });
    return m;
  }, [teamLeaves]);

  const prevMonth = () => { if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1); };

  /**
   * Eight distinguishable swatches out of the token set.
   *
   * This was an eight-hue palette (indigo, emerald, amber, rose, sky, purple,
   * teal, orange). Mapped onto the tokens it collapsed to three values with
   * five duplicates, so different people on the team calendar silently began
   * sharing a swatch. Varying FILL as well as hue restores eight distinct
   * treatments without inventing colours the system does not have.
   *
   * The swatch is only a scanning aid in any case — every chip and row prints
   * the member's name beside it, so nothing depends on telling the shades apart.
   */
  const MEMBER_SWATCHES = [
    'bg-accent text-on-accent',
    'bg-ink text-paper',
    'bg-highlight text-ink',
    'bg-paper text-ink border border-accent',
    'bg-paper text-ink border border-ink',
    'bg-paper text-ink border border-highlight',
    'bg-muted text-paper',
    'bg-pill text-ink border border-rule',
  ];
  const colorFor = (empId: string) => {
    const idx = subordinates.findIndex(s => s.id === empId);
    if (idx < 0) return 'bg-muted text-paper';
    return MEMBER_SWATCHES[idx % MEMBER_SWATCHES.length];
  };

  if (subordinates.length === 0) {
    return (
      <EmptyState
        icon="users"
        title="No team members assigned"
        description="Assign supervisors to employees from their profile to see team leave here."
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <Button variant="secondary" aria-label="Previous month" onClick={prevMonth}><Icon name="chevronRight" size={16} className="rotate-180" /></Button>
        <h3 className="text-base font-bold text-ink tabular-nums">{MONTH_NAMES[month]} {year}</h3>
        <Button variant="secondary" aria-label="Next month" onClick={nextMonth}><Icon name="chevronRight" size={16} /></Button>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {subordinates.map((s, i) => (
          <div key={s.id} className="flex items-center gap-1.5">
            <span className={`w-3 h-3 rounded-[3px] ${MEMBER_SWATCHES[i % MEMBER_SWATCHES.length]}`} aria-hidden="true" />
            <span className="text-xs font-semibold text-muted">{s.fullName.split(' ')[0]}</span>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="h-40 rounded-control bg-pill animate-pulse" />
      ) : (
        <div className="rounded-control border border-rule overflow-hidden">
          <div className="grid grid-cols-7 bg-page border-b border-rule">
            {DAY_LABELS.map(d => (
              <div key={d} className="py-2 text-center text-xs font-semibold text-muted">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {Array.from({ length: firstDay }).map((_, i) => (
              <div key={`empty-${i}`} className="min-h-[84px] border-b border-r border-rule bg-page" />
            ))}
            {calDays.map(day => {
              const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const dayLeaves = leaveMap[dateStr] ?? [];
              const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
              return (
                <div key={day} className={`min-h-[84px] border-b border-r border-rule p-1.5 flex flex-col gap-1 ${isToday ? 'bg-tint' : ''}`}>
                  <span className={`text-xs font-semibold self-start w-6 h-6 flex items-center justify-center rounded-full tabular-nums ${isToday ? 'bg-accent text-on-accent' : 'text-muted'}`}>{day}</span>
                  {dayLeaves.slice(0, 3).map(lv => (
                    <div key={lv.id} title={`${subordinates.find(s => s.id === lv.employeeId)?.fullName}: ${lv.leaveType.name}`} className={`${colorFor(lv.employeeId)} px-1.5 py-0.5 rounded-[4px] text-xs font-semibold truncate leading-tight`}>
                      {subordinates.find(s => s.id === lv.employeeId)?.fullName.split(' ')[0]}
                    </div>
                  ))}
                  {dayLeaves.length > 3 && <div className="text-xs font-semibold text-muted">+{dayLeaves.length - 3}</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {teamLeaves.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-[12.5px] font-semibold text-muted">Approved leave this month</p>
          {teamLeaves.map(lv => {
            const member = subordinates.find(s => s.id === lv.employeeId);
            return (
              <div key={lv.id} className="flex items-center gap-3 px-3.5 py-3 rounded-control border border-rule bg-paper">
                <span className={`w-1.5 h-8 rounded-full ${colorFor(lv.employeeId)} shrink-0`} aria-hidden="true" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-ink truncate">{member?.fullName}</p>
                  <p className="text-xs text-muted">{lv.leaveType.name} · {lv.totalDays} day{lv.totalDays > 1 ? 's' : ''}</p>
                </div>
                <p className="text-xs text-muted tabular-nums text-right shrink-0">
                  {new Date(lv.startDate + 'T00:00:00').toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })}
                  {' – '}
                  {new Date(lv.endDate + 'T00:00:00').toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AdminLeaveView() {
  const [activeTab, setActiveTab] = useState<'approvals' | 'types' | 'calendar'>('approvals');
  const [pending, setPending] = useState<PendingLeave[]>([]);
  const [loadingApprovals, setLoadingApprovals] = useState(true);
  const { toast } = useToast();

  // Leave Types state
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [loadingTypes, setLoadingTypes] = useState(false);
  const [typeSort, setTypeSort] = useState<{ col: 'code' | 'name' | 'entitlement' | 'carry' | 'paid' | 'statutory' | 'doc' | 'status'; dir: 'asc' | 'desc' }>({ col: 'code', dir: 'asc' });
  const [typeModal, setTypeModal] = useState(false);
  const [editingType, setEditingType] = useState<LeaveType | null>(null);
  const [typeForm, setTypeForm] = useState<Omit<LeaveType, 'id' | 'isActive'>>(BLANK_TYPE);
  const [savingType, setSavingType] = useState(false);

  // Team calendar state
  const [subordinates, setSubordinates] = useState<TeamMember[]>([]);
  const [loadingSubordinates, setLoadingSubordinates] = useState(false);

  // Detail modal
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<LeaveDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [attachmentObjectUrl, setAttachmentObjectUrl] = useState<string | null>(null);
  const [decisionBusy, setDecisionBusy] = useState(false);

  useEffect(() => {
    apiFetch('/leave/applications?status=PENDING&limit=100')
      .then(data => {
        const apps = data.applications ?? [];
        setPending(apps.map((a: any) => ({
          id: a.id, employeeId: a.employeeId,
          employeeName: a.employee?.fullName ?? a.employeeId,
          employeeCode: a.employee?.employeeCode,
          designation: a.employee?.designation,
          dept: a.employee?.department ?? '—',
          leaveTypeName: a.leaveType?.name ?? a.leaveTypeId,
          from: a.startDate.slice(0, 10), to: a.endDate.slice(0, 10),
          days: a.totalDays, reason: a.reason ?? '',
          hasAttachment: !!a.attachment,
        })));
      })
      .catch(e => console.error('[LeaveRegistry] load failed:', e.message))
      .finally(() => setLoadingApprovals(false));
  }, []);

  useEffect(() => {
    if (activeTab !== 'types') return;
    setLoadingTypes(true);
    apiFetch('/leave/types?all=true')
      .then(d => setLeaveTypes(d))
      .catch(e => showToast(e.message, 'error'))
      .finally(() => setLoadingTypes(false));
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'calendar') return;
    setLoadingSubordinates(true);
    apiFetch('/employees/me/subordinates')
      .then(d => setSubordinates(Array.isArray(d) ? d : []))
      .catch(() => setSubordinates([]))
      .finally(() => setLoadingSubordinates(false));
  }, [activeTab]);

  const showToast = (msg: string, type: 'success' | 'error') => toast(msg, type === 'success' ? 'ok' : 'danger');

  const sortedLeaveTypes = [...leaveTypes].sort((a, b) => {
    const d = typeSort.dir === 'asc' ? 1 : -1;
    switch (typeSort.col) {
      case 'code':        return d * a.code.localeCompare(b.code);
      case 'name':        return d * a.name.localeCompare(b.name);
      case 'entitlement': return d * (a.annualEntitlement - b.annualEntitlement);
      case 'carry':       return d * (a.maxCarryForward - b.maxCarryForward);
      case 'paid':        return d * (Number(a.isPaid) - Number(b.isPaid));
      case 'statutory':   return d * (Number(a.isStatutory) - Number(b.isStatutory));
      case 'doc':         return d * (Number(a.requiresDocument) - Number(b.requiresDocument));
      case 'status':      return d * (Number(a.isActive) - Number(b.isActive));
      default: return 0;
    }
  });
  function toggleTypeSort(col: typeof typeSort.col) {
    setTypeSort(prev => prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' });
  }
  function SortHead({ col, children }: { col: typeof typeSort.col; children: ReactNode }) {
    const on = typeSort.col === col;
    return (
      <button type="button" onClick={() => toggleTypeSort(col)} className={`inline-flex items-center gap-1 hover:text-ink ${on ? 'text-ink' : ''}`} aria-sort={on ? (typeSort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
        {children}
        <Icon name="chevronDown" size={13} className={`transition-transform ${on ? (typeSort.dir === 'asc' ? 'rotate-180' : '') : 'opacity-40'}`} />
      </button>
    );
  }

  // Fetch full detail when opening the modal
  useEffect(() => {
    if (!detailId) {
      setDetail(null);
      if (attachmentObjectUrl) { URL.revokeObjectURL(attachmentObjectUrl); setAttachmentObjectUrl(null); }
      return;
    }
    setLoadingDetail(true);
    apiFetch(`/leave/applications/${detailId}`)
      .then(async (d: LeaveDetail) => {
        setDetail(d);
        // For image attachments, fetch with auth header and create an object URL
        if (d.attachment && d.attachment.mimeType.startsWith('image/')) {
          try {
            const res = await apiFetchRaw(d.attachment.downloadUrl);
            if (res.ok) {
              const blob = await res.blob();
              setAttachmentObjectUrl(URL.createObjectURL(blob));
            }
          } catch { /* fall through — UI shows download link instead */ }
        }
      })
      .catch(e => showToast(e.message, 'error'))
      .finally(() => setLoadingDetail(false));
  }, [detailId]);

  // Authenticated download (cannot use plain <a> — the HttpOnly auth cookie is
  // attached by apiFetchRaw via credentials:'include').
  const downloadAttachment = async () => {
    if (!detail?.attachment) return;
    try {
      const res = await apiFetchRaw(detail.attachment.downloadUrl);
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = detail.attachment.fileName;
      document.body.appendChild(a); a.click();
      a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e: any) { showToast(e.message ?? 'Download failed', 'error'); }
  };

  const handleApprove = async (id: string) => {
    setDecisionBusy(true);
    try {
      await apiFetch(`/leave/applications/${id}/approve`, { method: 'PUT' });
      setPending(prev => prev.filter(p => p.id !== id));
      setDetailId(null);
      showToast('Leave approved', 'success');
    } catch (e: any) { showToast(e.message, 'error'); }
    finally { setDecisionBusy(false); }
  };

  const handleReject = async (id: string) => {
    setDecisionBusy(true);
    try {
      await apiFetch(`/leave/applications/${id}/reject`, { method: 'PUT', body: JSON.stringify({ reason: 'Rejected by HR' }) });
      setPending(prev => prev.filter(p => p.id !== id));
      setDetailId(null);
      showToast('Leave rejected', 'success');
    } catch (e: any) { showToast(e.message, 'error'); }
    finally { setDecisionBusy(false); }
  };

  const openNewType = () => { setEditingType(null); setTypeForm(BLANK_TYPE); setTypeModal(true); };
  const openEditType = (t: LeaveType) => { setEditingType(t); setTypeForm({ code: t.code, name: t.name, isPaid: t.isPaid, isStatutory: t.isStatutory, annualEntitlement: t.annualEntitlement, maxCarryForward: t.maxCarryForward, isGovtPaid: t.isGovtPaid, requiresDocument: t.requiresDocument, minNoticeDays: t.minNoticeDays }); setTypeModal(true); };

  const handleSaveType = async () => {
    if (!typeForm.code || !typeForm.name) return showToast('Code and name are required', 'error');
    setSavingType(true);
    try {
      if (editingType) {
        const updated = await apiFetch(`/leave/types/${editingType.id}`, { method: 'PUT', body: JSON.stringify(typeForm) });
        setLeaveTypes(prev => prev.map(t => t.id === editingType.id ? updated : t));
        showToast('Leave type updated', 'success');
      } else {
        const created = await apiFetch('/leave/types', { method: 'POST', body: JSON.stringify(typeForm) });
        setLeaveTypes(prev => [...prev, created]);
        showToast('Leave type created', 'success');
      }
      setTypeModal(false);
    } catch (e: any) { showToast(e.message, 'error'); }
    finally { setSavingType(false); }
  };

  const handleDeactivate = async (t: LeaveType) => {
    try {
      await apiFetch(`/leave/types/${t.id}`, { method: editingType ? 'PUT' : 'DELETE' });
      const updated = await apiFetch(`/leave/types/${t.id}`, { method: 'PUT', body: JSON.stringify({ isActive: !t.isActive }) });
      setLeaveTypes(prev => prev.map(x => x.id === t.id ? updated : x));
      showToast(updated.isActive ? 'Leave type activated' : 'Leave type deactivated', 'success');
    } catch (e: any) { showToast(e.message, 'error'); }
  };

  const tf = (k: keyof typeof typeForm, v: any) => setTypeForm(p => ({ ...p, [k]: v }));

  const pendingDays = pending.reduce((s, p) => s + p.days, 0);

  const pendingList = loadingApprovals ? (
    <Card className="items-center py-14"><div className="w-8 h-8 border-4 border-accent border-t-accent animate-spin rounded-full" /></Card>
  ) : (
    <InboxList
      aria-label="Leave applications waiting for approval"
      items={pending}
      itemKey={(p) => p.id}
      selectedKey={detailId}
      onSelect={(p) => setDetailId(p.id === detailId ? null : p.id)}
      footer={pending.length > 0 ? <><span>{pending.length} of {pending.length}</span><span>Pick a row for the full application</span></> : undefined}
      empty={<EmptyState icon="calendar" title="No pending leave applications" description="New applications from employees appear here for a decision." />}
      render={(req) => (
        <div className="flex items-start gap-3 min-w-0">
          <Avatar name={req.employeeName} tone="soft" size={36} className="mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-semibold text-ink truncate">{req.employeeName}</span>
              <span className="text-sm font-semibold text-ink tabular-nums shrink-0">{req.days} day{req.days === 1 ? '' : 's'}</span>
            </div>
            <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
              <span className="text-xs text-muted truncate">{req.leaveTypeName} · {fmtDate(req.from)} – {fmtDate(req.to)}</span>
              {req.hasAttachment && <Icon name="paperclip" size={13} className="text-muted shrink-0" aria-label="Has attachment" />}
            </div>
            {req.reason && <p className="text-xs text-muted truncate mt-0.5">{req.reason}</p>}
            {/* Decide from the row: a reviewer never has to open an application to clear it. */}
            <div className="flex gap-1.5 mt-2.5" onClick={(e) => e.stopPropagation()}>
              <Button size="sm" variant="secondary" onClick={() => handleReject(req.id)} disabled={decisionBusy}>Reject</Button>
              <Button size="sm" variant="primary" onClick={() => handleApprove(req.id)} disabled={decisionBusy}>Approve</Button>
            </div>
          </div>
        </div>
      )}
    />
  );

  const typeColumns: Column<LeaveType>[] = [
    { key: 'code', label: <SortHead col="code">Code</SortHead>, width: '90px', render: (t) => <span className="font-mono text-xs font-semibold text-accent">{t.code}</span> },
    { key: 'name', label: <SortHead col="name">Name</SortHead>, width: 'minmax(0, 1.5fr)', render: (t) => <span className="font-semibold">{t.name}</span> },
    {
      key: 'entitlement', label: <SortHead col="entitlement">Entitlement</SortHead>, width: '120px', numeric: true,
      render: (t) => (!t.isPaid || t.annualEntitlement === 0) ? <Badge tone="neutral">No limit</Badge> : `${t.annualEntitlement} days`,
    },
    { key: 'carry', label: <SortHead col="carry">Carry forward</SortHead>, width: '120px', numeric: true, render: (t) => t.maxCarryForward > 0 ? `${t.maxCarryForward} days` : <span className="text-faint">—</span> },
    { key: 'paid', label: <SortHead col="paid">Paid</SortHead>, width: '90px', render: (t) => <Badge tone={t.isPaid ? 'ok' : 'neutral'}>{t.isPaid ? 'Paid' : 'Unpaid'}</Badge> },
    { key: 'statutory', label: <SortHead col="statutory">Statutory</SortHead>, width: '100px', render: (t) => t.isStatutory ? <Badge tone="accent">Statutory</Badge> : <span className="text-faint">—</span> },
    { key: 'doc', label: <SortHead col="doc">Document</SortHead>, width: '100px', render: (t) => t.requiresDocument ? <Badge tone="neutral">Required</Badge> : <span className="text-faint">—</span> },
    { key: 'status', label: <SortHead col="status">Status</SortHead>, width: '90px', render: (t) => <Badge tone={t.isActive ? 'ok' : 'neutral'}>{t.isActive ? 'Active' : 'Inactive'}</Badge> },
    {
      key: 'actions', label: '', width: '180px', align: 'right',
      render: (t) => (
        <span className="inline-flex justify-end gap-1.5">
          <Button size="sm" variant="secondary" onClick={() => openEditType(t)}>Edit</Button>
          <Button size="sm" variant={t.isActive ? 'danger' : 'secondary'} onClick={() => handleDeactivate(t)}>{t.isActive ? 'Deactivate' : 'Activate'}</Button>
        </span>
      ),
    },
  ];

  const detailBody = (
    <LeaveDetailBody
      detail={detail}
      loading={loadingDetail}
      attachmentObjectUrl={attachmentObjectUrl}
      onDownload={downloadAttachment}
    />
  );
  const detailFooter = detail?.status === 'PENDING' ? (
    <>
      <Button variant="secondary" className="flex-1" onClick={() => handleReject(detail.id)} disabled={decisionBusy}>Reject</Button>
      <Button variant="primary" className="flex-1" onClick={() => handleApprove(detail.id)} disabled={decisionBusy}>{decisionBusy ? 'Working…' : 'Approve'}</Button>
    </>
  ) : null;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Leave management"
        subtitle={loadingApprovals ? 'Loading the queue…' : pending.length === 0 ? 'Nothing waiting for a decision' : `${pending.length} application${pending.length === 1 ? '' : 's'} waiting · ${pendingDays} day${pendingDays === 1 ? '' : 's'} requested`}
        actions={activeTab === 'types' ? <Button variant="primary" icon="plus" onClick={openNewType}>New leave type</Button> : undefined}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Stat label="Pending approval" value={loadingApprovals ? '—' : pending.length} note="Awaiting a decision" />
        <Stat label="Days requested" value={loadingApprovals ? '—' : pendingDays} note="Across pending applications" />
        <Stat label="Active leave types" value={leaveTypes.length === 0 ? '—' : leaveTypes.filter(t => t.isActive).length} note={leaveTypes.length === 0 ? 'Open the Leave types tab to load' : `${leaveTypes.length} configured`} />
      </div>

      <Tabs
        items={[
          { id: 'approvals', label: 'Approvals', count: loadingApprovals ? undefined : pending.length },
          { id: 'types', label: 'Leave types' },
          { id: 'calendar', label: 'Team calendar' },
        ]}
        active={activeTab}
        onChange={setActiveTab}
      />

      {/* ── APPROVALS ── inbox: queue left, selected application right at ≥1280px */}
      {activeTab === 'approvals' && (
        <SplitPane
          hasDetail={!!detailId}
          onBack={() => setDetailId(null)}
          backLabel="Back to the queue"
          list={pendingList}
          detail={detailId ? (
            <Card>
              <CardHeader
                title="Leave application"
                caption={loadingDetail ? 'Loading…' : detail ? `${detail.leaveType?.name ?? '—'} · ${detail.totalDays} day${detail.totalDays !== 1 ? 's' : ''}` : ''}
                action={<Button size="sm" variant="ghost" aria-label="Close" onClick={() => setDetailId(null)} className="hidden xl:inline-flex"><Icon name="x" size={16} /></Button>}
              />
              {detailBody}
              {detailFooter && <div className="flex gap-2.5 mt-5">{detailFooter}</div>}
            </Card>
          ) : null}
        />
      )}

      {/* ── LEAVE TYPES ── */}
      {activeTab === 'types' && (
        loadingTypes ? (
          <Card className="items-center py-14"><div className="w-8 h-8 border-4 border-accent border-t-accent animate-spin rounded-full" /></Card>
        ) : (
          <DataTable
            columns={typeColumns}
            rows={sortedLeaveTypes}
            rowKey={(t) => t.id}
            aria-label="Leave types"
            mobileCard={(t) => (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-ink truncate"><span className="font-mono text-xs text-accent mr-2">{t.code}</span>{t.name}</span>
                  <Badge tone={t.isActive ? 'ok' : 'neutral'}>{t.isActive ? 'Active' : 'Inactive'}</Badge>
                </div>
                <p className="text-xs text-muted tabular-nums">
                  {(!t.isPaid || t.annualEntitlement === 0) ? 'No limit' : `${t.annualEntitlement} days`} · carry forward {t.maxCarryForward > 0 ? `${t.maxCarryForward} days` : 'none'} · {t.isPaid ? 'paid' : 'unpaid'}{t.isStatutory ? ' · statutory' : ''}{t.requiresDocument ? ' · document required' : ''}
                </p>
                <div className="flex gap-1.5">
                  <Button size="sm" variant="secondary" onClick={() => openEditType(t)}>Edit</Button>
                  <Button size="sm" variant={t.isActive ? 'danger' : 'secondary'} onClick={() => handleDeactivate(t)}>{t.isActive ? 'Deactivate' : 'Activate'}</Button>
                </div>
              </div>
            )}
            footer={leaveTypes.length > 0 ? <><span>{leaveTypes.length} type{leaveTypes.length === 1 ? '' : 's'}</span><span>{leaveTypes.filter(t => t.isActive).length} active</span></> : undefined}
            empty={
              <EmptyState
                icon="calendar"
                title="No leave types configured"
                description="Create the leave policies employees can apply against."
                action={<Button variant="primary" icon="plus" onClick={openNewType}>Create first leave type</Button>}
              />
            }
          />
        )
      )}

      {/* ── CALENDAR ── */}
      {activeTab === 'calendar' && (
        <Card>
          <CardHeader
            title="Team calendar"
            caption={loadingSubordinates ? 'Loading your team…' : `${subordinates.length} direct report${subordinates.length !== 1 ? 's' : ''}`}
            action={subordinates.length > 0 ? (
              <div className="flex -space-x-2">
                {subordinates.slice(0, 6).map(s => (
                  <Avatar key={s.id} name={s.fullName} tone="soft" size={32} className="border-2 border-paper" />
                ))}
                {subordinates.length > 6 && <span className="flex items-center justify-center w-8 h-8 rounded-full bg-pill border-2 border-paper text-xs font-bold text-muted">+{subordinates.length - 6}</span>}
              </div>
            ) : undefined}
          />
          {loadingSubordinates ? (
            <div className="h-40 rounded-control bg-pill animate-pulse" />
          ) : (
            <TeamCalendar subordinates={subordinates} />
          )}
        </Card>
      )}

      {/* ── LEAVE TYPE MODAL ── single-column form */}
      {typeModal && (
        <Modal open
          title={editingType ? 'Edit leave type' : 'New leave type'}
          caption={editingType ? `Editing ${editingType.code}` : 'A leave policy employees can apply against'}
          onClose={() => setTypeModal(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setTypeModal(false)}>Cancel</Button>
              <Button variant="primary" onClick={handleSaveType} disabled={savingType}>
                {savingType ? 'Saving…' : editingType ? 'Save changes' : 'Create leave type'}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-1 sm:grid-cols-[120px_minmax(0,1fr)] gap-4">
              <Field label="Code" required help={editingType ? 'Cannot change once created' : undefined}>
                <Input value={typeForm.code} onChange={e => tf('code', e.target.value)} disabled={!!editingType} placeholder="AL" className="uppercase" />
              </Field>
              <Field label="Name" required>
                <Input value={typeForm.name} onChange={e => tf('name', e.target.value)} placeholder="Annual leave" />
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="Annual entitlement" help="Days">
                <Input type="number" min={0} max={365} value={typeForm.annualEntitlement} onChange={e => tf('annualEntitlement', parseFloat(e.target.value) || 0)} />
              </Field>
              <Field label="Max carry forward" help="Days">
                <Input type="number" min={0} max={365} value={typeForm.maxCarryForward} onChange={e => tf('maxCarryForward', parseFloat(e.target.value) || 0)} />
              </Field>
              <Field label="Minimum notice" help="Days">
                <Input type="number" min={0} max={90} value={typeForm.minNoticeDays} onChange={e => tf('minNoticeDays', parseInt(e.target.value) || 0)} />
              </Field>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-semibold text-muted">Policy</span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {([
                  { key: 'isPaid', label: 'Paid leave' },
                  { key: 'isStatutory', label: 'Statutory leave' },
                  { key: 'isGovtPaid', label: 'Government-paid' },
                  { key: 'requiresDocument', label: 'Requires a document' },
                ] as const).map(({ key, label }) => (
                  <label key={key} className={`flex items-center gap-3 px-3.5 py-3 rounded-control border cursor-pointer transition-colors ${typeForm[key] ? 'border-accent bg-tint' : 'border-rule bg-paper hover:bg-pill'}`}>
                    <input type="checkbox" checked={typeForm[key] as boolean} onChange={e => tf(key, e.target.checked)} className="w-4 h-4 accent-accent" />
                    <span className="text-sm font-semibold text-ink">{label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </Modal>
      )}

    </div>
  );
}

/** The application record: who, when, why, the document, the trail. */
function LeaveDetailBody({ detail, loading, attachmentObjectUrl, onDownload }: {
  detail: LeaveDetail | null; loading: boolean; attachmentObjectUrl: string | null; onDownload: () => void;
}) {
  if (loading) return <div className="h-40 rounded-control bg-pill animate-pulse" />;
  if (!detail) return <EmptyState icon="alert" title="Unable to load application" className="py-8" />;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3.5">
        <Avatar name={detail.employee?.fullName} tone="soft" size={48} />
        <div className="flex-1 min-w-0">
          <p className="text-base font-bold text-ink truncate">{detail.employee?.fullName ?? detail.employeeId}</p>
          <p className="text-xs text-muted truncate">{detail.employee?.designation ?? '—'} · {detail.employee?.department ?? '—'}</p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {detail.employee?.employeeCode && <Badge tone="neutral">{detail.employee.employeeCode}</Badge>}
            {detail.employee?.workEmail && <a href={`mailto:${detail.employee.workEmail}`} className="text-xs font-semibold text-accent hover:underline truncate">{detail.employee.workEmail}</a>}
          </div>
        </div>
      </div>

      <dl className="flex flex-col divide-y divide-rule text-sm border-y border-rule">
        <Row k="Leave type" v={<>{detail.leaveType?.name ?? '—'}{detail.leaveType && <span className="text-muted"> · {detail.leaveType.isPaid ? 'Paid' : 'Unpaid'}</span>}</>} />
        <Row k="From" v={<span className="tabular-nums">{fmtDate(detail.startDate.slice(0, 10))}</span>} />
        <Row k="To" v={<span className="tabular-nums">{fmtDate(detail.endDate.slice(0, 10))}</span>} />
        <Row k="Total" v={<span className="font-semibold tabular-nums">{detail.totalDays} day{detail.totalDays !== 1 ? 's' : ''}{detail.isHalfDay ? ` (${detail.halfDaySlot ?? 'half'})` : ''}</span>} />
        <Row k="Status" v={<Badge tone={detail.status === 'PENDING' ? 'warn' : detail.status === 'APPROVED' ? 'ok' : 'neutral'}>{detail.status === 'PENDING' ? 'Awaiting decision' : detail.status.charAt(0) + detail.status.slice(1).toLowerCase()}</Badge>} />
      </dl>

      <div>
        <p className="text-[12.5px] font-semibold text-muted mb-1.5">Reason</p>
        <p className="text-sm text-ink leading-relaxed whitespace-pre-wrap">
          {detail.reason?.trim() ? detail.reason : <span className="text-faint">No reason given</span>}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-[12.5px] font-semibold text-muted">Supporting document</p>
          {detail.attachment && <Button size="sm" variant="ghost" icon="download" onClick={onDownload}>Download</Button>}
        </div>
        {!detail.attachment ? (
          <div className="px-4 py-5 rounded-control border border-dashed border-rule text-center text-sm text-faint">No attachment provided</div>
        ) : detail.attachment.mimeType.startsWith('image/') ? (
          <div className="rounded-control border border-rule overflow-hidden bg-page">
            {attachmentObjectUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={attachmentObjectUrl} alt={detail.attachment.fileName} className="w-full max-h-[400px] object-contain" />
            ) : (
              <div className="h-40 flex items-center justify-center text-sm text-muted animate-pulse">Loading image…</div>
            )}
            <p className="text-xs text-muted text-center py-2 border-t border-rule truncate px-3">{detail.attachment.fileName}</p>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-4 px-3.5 py-3 rounded-control border border-rule bg-paper">
            <div className="flex items-center gap-3 min-w-0">
              <Icon name="file" size={20} className="text-muted shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink truncate">{detail.attachment.fileName}</p>
                <p className="text-xs text-muted">{detail.attachment.mimeType === 'application/pdf' ? 'PDF document' : detail.attachment.mimeType}</p>
              </div>
            </div>
            <Button size="sm" variant="secondary" onClick={onDownload}>{detail.attachment.mimeType === 'application/pdf' ? 'Open' : 'Download'}</Button>
          </div>
        )}
      </div>

      {detail.approvalSteps && detail.approvalSteps.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-[12.5px] font-semibold text-muted">Approval trail</p>
          {detail.approvalSteps.map(s => (
            <div key={s.step} className="flex items-center gap-3 px-3.5 py-2.5 rounded-control bg-pill text-sm">
              <Badge tone="accent">Step {s.step}</Badge>
              <span className="text-ink tabular-nums">{new Date(s.approvedAt).toLocaleString('en-SG')}</span>
              <span className="text-xs text-muted ml-auto font-mono">{s.approvedByEmpId.slice(0, 8)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <dt className="text-muted shrink-0">{k}</dt>
      <dd className="text-right text-ink min-w-0">{v}</dd>
    </div>
  );
}
