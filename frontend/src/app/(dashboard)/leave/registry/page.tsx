'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { apiFetch, apiFetchRaw } from '@/lib/api';

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

function Toast({ msg, type, onClose }: { msg: string; type: 'success' | 'error'; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 3500); return () => clearTimeout(t); }, [onClose]);
  return (
    <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[200] animate-in slide-in-from-bottom-8 duration-300">
      <div className={`px-8 py-4   flex items-center gap-4 ${type === 'success' ? 'bg-shadow border border-shadow' : 'bg-ink border border-ink'}`}>
        <div className={`w-2 h-2  ${type === 'success' ? 'bg-accent' : 'bg-ink'}`} />
        <span className="text-[10px] font-black text-paper uppercase tracking-widest">{msg}</span>
      </div>
    </div>
  );
}

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
   * Eight distinguishable swatches out of three tokens.
   *
   * This was an eight-hue palette (indigo, emerald, amber, rose, sky, purple,
   * teal, orange). Mapped onto the Official Record tokens it collapsed to three
   * values with five duplicates, so different people on the team calendar
   * silently began sharing a swatch. Varying FILL as well as hue restores eight
   * distinct treatments without inventing colours the system does not have.
   *
   * The swatch is only a scanning aid in any case — every chip and row prints
   * the member's name beside it, so nothing depends on telling the shades apart.
   */
  const MEMBER_SWATCHES = [
    'bg-accent text-paper',
    'bg-ink text-paper',
    'bg-highlight text-ink',
    'bg-paper text-ink border border-accent',
    'bg-paper text-ink border border-ink',
    'bg-paper text-ink border border-highlight',
    'bg-muted text-paper',
    'bg-page text-ink border border-rule',
  ];
  const colorFor = (empId: string) => {
    const idx = subordinates.findIndex(s => s.id === empId);
    if (idx < 0) return 'bg-muted text-paper';
    return MEMBER_SWATCHES[idx % MEMBER_SWATCHES.length];
  };

  if (subordinates.length === 0) {
    return (
      <div className="py-16 flex flex-col items-center gap-4">
        <div className="w-14 h-14 bg-shadow flex items-center justify-center text-xl border border-shadow">👥</div>
        <p className="text-sm font-black text-muted uppercase tracking-widest">No team members assigned</p>
        <p className="text-[10px] font-bold text-muted text-center max-w-xs">Assign supervisors to employees from their profile to see team leave here</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Navigation */}
      <div className="flex items-center justify-between">
        <button onClick={prevMonth} className="w-9 h-9 border border-rule flex items-center justify-center text-muted hover:bg-page transition-all">‹</button>
        <h3 className="text-sm font-black text-ink uppercase tracking-widest">{MONTH_NAMES[month]} {year}</h3>
        <button onClick={nextMonth} className="w-9 h-9 border border-rule flex items-center justify-center text-muted hover:bg-page transition-all">›</button>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-2">
        {subordinates.map((s, i) => (
          <div key={s.id} className="flex items-center gap-1.5">
            <div className={`w-2.5 h-2.5  ${MEMBER_SWATCHES[i % MEMBER_SWATCHES.length]}`} />
            <span className="text-[9px] font-black text-muted uppercase tracking-widest">{s.fullName.split(' ')[0]}</span>
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      {loading ? (
        <div className="h-40 bg-page animate-pulse" />
      ) : (
        <div className="border border-rule overflow-hidden">
          {/* Day labels */}
          <div className="grid grid-cols-7 bg-page border-b border-rule">
            {DAY_LABELS.map(d => (
              <div key={d} className="py-2 text-center label-form">{d}</div>
            ))}
          </div>
          {/* Weeks */}
          <div className="grid grid-cols-7">
            {Array.from({ length: firstDay }).map((_, i) => (
              <div key={`empty-${i}`} className="min-h-[72px] border-b border-r border-rule bg-page" />
            ))}
            {calDays.map(day => {
              const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const dayLeaves = leaveMap[dateStr] ?? [];
              const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
              return (
                <div key={day} className={`min-h-[72px] border-b border-r border-rule p-1.5 flex flex-col gap-1 ${isToday ? 'bg-page' : ''}`}>
                  <span className={`text-[9px] font-black self-start w-5 h-5 flex items-center justify-center  ${isToday ? 'bg-accent text-paper' : 'text-muted'}`}>{day}</span>
                  {dayLeaves.slice(0, 3).map(lv => (
                    <div key={lv.id} title={`${subordinates.find(s => s.id === lv.employeeId)?.fullName}: ${lv.leaveType.name}`} className={`${colorFor(lv.employeeId)} px-1 py-0.5 text-[7px] font-black truncate leading-tight`}>
                      {subordinates.find(s => s.id === lv.employeeId)?.fullName.split(' ')[0]}
                    </div>
                  ))}
                  {dayLeaves.length > 3 && <div className="text-[7px] font-black text-muted">+{dayLeaves.length - 3}</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* On-leave list for selected month */}
      {teamLeaves.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="eyebrow-tight">Approved Leave This Month</p>
          {teamLeaves.map(lv => {
            const member = subordinates.find(s => s.id === lv.employeeId);
            return (
              <div key={lv.id} className="flex items-center gap-3 p-3 bg-page border border-rule">
                <div className={`w-2 h-8  ${colorFor(lv.employeeId)} shrink-0`} />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-black text-ink uppercase tracking-tight">{member?.fullName}</p>
                  <p className="text-[9px] font-bold text-muted uppercase">{lv.leaveType.name} · {lv.totalDays} day{lv.totalDays > 1 ? 's' : ''}</p>
                </div>
                <div className="text-right">
                  <p className="text-[9px] font-bold text-muted">{new Date(lv.startDate + 'T00:00:00').toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })}</p>
                  <p className="text-[9px] font-bold text-muted">→ {new Date(lv.endDate + 'T00:00:00').toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })}</p>
                </div>
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
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

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

  const showToast = (msg: string, type: 'success' | 'error') => setToast({ msg, type });

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
  function TypeSortIcon({ col }: { col: typeof typeSort.col }) {
    return <span className="text-[8px] ml-1">{typeSort.col === col ? (typeSort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span>;
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

  return (
    <div className="flex flex-col gap-6 max-w-[1600px] mx-auto pb-12 animate-in fade-in duration-700">

      <div className="bg-paper p-8 border border-rule flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-black text-ink tracking-tighter">Leave <span className="text-accent">Management</span></h1>
          <p className="text-[10px] font-black text-muted mt-1 uppercase tracking-widest">Organizational leave portal · Statutory compliance</p>
        </div>
        {activeTab === 'types' && (
          <button onClick={openNewType} className="px-6 py-2.5 text-[10px] font-black text-paper bg-accent hover:bg-accent transition-all uppercase tracking-widest">
            + New Leave Type
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="bg-paper p-7 border border-rule">
          <p className="eyebrow-tight mb-3">Pending Approval</p>
          {loadingApprovals ? <div className="h-10 w-16 bg-page animate-pulse" /> : <p className="text-4xl font-black text-ink">{pending.length}</p>}
          <p className="text-[9px] font-black text-ink mt-4 uppercase tracking-widest flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-highlight animate-pulse" />
            Awaiting decision
          </p>
        </div>
        <div className="bg-shadow p-7 border border-shadow">
          <p className="text-[10px] font-black text-accent uppercase tracking-widest mb-3">Leave Types Active</p>
          <p className="text-4xl font-black text-paper">{leaveTypes.filter(t => t.isActive).length || '—'}</p>
          <p className="text-[9px] font-black text-muted mt-4 uppercase tracking-widest italic">Configured types</p>
        </div>
        <div className="bg-page p-7 border border-accent">
          <p className="text-[10px] font-black text-accent uppercase tracking-widest mb-3 text-center">Total Submissions</p>
          <p className="text-4xl font-black text-accent text-center">{loadingApprovals ? '—' : pending.length}</p>
        </div>
      </div>

      <div className="bg-paper border border-rule overflow-hidden">
        <div className="border-b border-rule px-8 flex gap-8 bg-page">
          {([
            { key: 'approvals', label: `Authorization Queue (${loadingApprovals ? '…' : pending.length})` },
            { key: 'types', label: 'Leave Types' },
            { key: 'calendar', label: 'Team Calendar' },
          ] as const).map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`py-5 text-[11px] font-black uppercase tracking-widest border-b-2 transition-all ${activeTab === tab.key ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-ink'}`}>
              {tab.label}
            </button>
          ))}
        </div>

        <div className="p-8">
          {/* ── APPROVALS ── */}
          {activeTab === 'approvals' && (
            <div className="flex flex-col gap-3">
              {loadingApprovals ? (
                [1,2,3].map(i => <div key={i} className="h-20 bg-page animate-pulse" />)
              ) : pending.length === 0 ? (
                <div className="py-16 text-center">
                  <p className="text-sm font-black text-muted uppercase tracking-widest">No pending leave applications</p>
                </div>
              ) : pending.map(req => (
                <div
                  key={req.id}
                  onClick={() => setDetailId(req.id)}
                  className="flex items-center gap-5 p-5 border bg-page border-rule hover:border-accent hover:bg-paper hover: transition-all cursor-pointer"
                >
                  <div className="w-10 h-10 bg-shadow flex items-center justify-center text-[11px] font-black text-paper shrink-0">
                    {req.employeeName.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-black text-ink uppercase tracking-tight text-sm">{req.employeeName}</p>
                      {req.employeeCode && <span className="text-[8px] font-black bg-page text-muted px-2 py-0.5 uppercase tracking-widest">{req.employeeCode}</span>}
                      {req.hasAttachment && <span className="text-[8px] font-black bg-page text-accent border border-accent px-2 py-0.5 uppercase tracking-widest flex items-center gap-1">📎 Attachment</span>}
                    </div>
                    <p className="text-[10px] font-bold text-muted mt-0.5 uppercase tracking-widest">{req.dept} · {req.leaveTypeName} · {req.days} day{req.days > 1 ? 's' : ''}</p>
                    <p className="text-[10px] font-bold text-muted mt-0.5">{fmtDate(req.from)} → {fmtDate(req.to)}</p>
                    {req.reason && <p className="text-[9px] font-bold text-muted mt-0.5 truncate">&quot;{req.reason}&quot;</p>}
                  </div>
                  <div className="flex gap-3 shrink-0" onClick={e => e.stopPropagation()}>
                    <button onClick={() => handleReject(req.id)} className="px-5 py-2 bg-page text-ink border border-ink text-[9px] font-black uppercase tracking-widest hover:bg-page transition-all">Reject</button>
                    <button onClick={() => handleApprove(req.id)} className="px-5 py-2 bg-accent text-paper text-[9px] font-black uppercase tracking-widest hover:bg-accent transition-all">Approve</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── LEAVE TYPES ── */}
          {activeTab === 'types' && (
            <div className="flex flex-col gap-4">
              {loadingTypes ? (
                [1,2,3,4].map(i => <div key={i} className="h-16 bg-page animate-pulse" />)
              ) : leaveTypes.length === 0 ? (
                <div className="py-16 text-center">
                  <p className="text-sm font-black text-muted uppercase tracking-widest">No leave types configured</p>
                  <button onClick={openNewType} className="mt-4 px-6 py-2.5 bg-accent text-paper text-[10px] font-black uppercase tracking-widest hover:bg-accent transition-all">Create First Leave Type</button>
                </div>
              ) : (
                <div className="overflow-hidden border border-rule">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-page border-b border-rule label-form">
                        {([
                          { col: 'code',        label: 'Code' },
                          { col: 'name',        label: 'Name' },
                          { col: 'entitlement', label: 'Entitlement' },
                          { col: 'carry',       label: 'Carry Fwd' },
                          { col: 'paid',        label: 'Paid' },
                          { col: 'statutory',   label: 'Statutory' },
                          { col: 'doc',         label: 'Doc Req.' },
                          { col: 'status',      label: 'Status' },
                        ] as const).map(h => (
                          <th key={h.col} className="px-5 py-3">
                            <button onClick={() => toggleTypeSort(h.col)} className="flex items-center hover:text-ink transition-colors">
                              {h.label}<TypeSortIcon col={h.col} />
                            </button>
                          </th>
                        ))}
                        <th className="px-5 py-3"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-rule text-xs font-bold text-ink">
                      {sortedLeaveTypes.map(t => (
                        <tr key={t.id} className={`hover:bg-page transition-all ${!t.isActive ? 'opacity-50' : ''}`}>
                          <td className="px-5 py-3"><span className="font-mono text-[10px] bg-page text-accent border border-accent px-2 py-0.5 uppercase">{t.code}</span></td>
                          <td className="px-5 py-3 font-black text-ink">{t.name}</td>
                          <td className="px-5 py-3">
                            {(!t.isPaid || t.annualEntitlement === 0)
                              ? <span className="text-[9px] font-black px-2 py-0.5 bg-page text-ink border border-highlight uppercase">No Limit</span>
                              : `${t.annualEntitlement} days`
                            }
                          </td>
                          <td className="px-5 py-3">{t.maxCarryForward > 0 ? `${t.maxCarryForward} days` : '—'}</td>
                          <td className="px-5 py-3">
                            <span className={`text-[9px] font-black px-2 py-0.5  uppercase ${t.isPaid ? 'bg-page text-accent border border-accent' : 'bg-page text-muted border border-rule'}`}>
                              {t.isPaid ? 'Paid' : 'Unpaid'}
                            </span>
                          </td>
                          <td className="px-5 py-3">
                            {t.isStatutory ? <span className="text-[9px] font-black px-2 py-0.5 uppercase bg-page text-ink border border-highlight">Statutory</span> : <span className="text-muted">—</span>}
                          </td>
                          <td className="px-5 py-3">
                            {t.requiresDocument ? <span className="text-[9px] font-black px-2 py-0.5 uppercase bg-page text-accent border border-accent">Yes</span> : <span className="text-muted">—</span>}
                          </td>
                          <td className="px-5 py-3">
                            <span className={`text-[9px] font-black px-2 py-0.5  uppercase ${t.isActive ? 'bg-page text-accent border border-accent' : 'bg-page text-muted border border-rule'}`}>
                              {t.isActive ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td className="px-5 py-3">
                            <div className="flex gap-2">
                              <button onClick={() => openEditType(t)} className="px-3 py-1.5 text-[9px] font-black text-accent bg-page border border-accent hover:bg-page uppercase tracking-widest transition-all">Edit</button>
                              <button onClick={() => handleDeactivate(t)} className={`px-3 py-1.5 text-[9px] font-black  uppercase tracking-widest transition-all border ${t.isActive ? 'text-ink bg-page border-ink hover:bg-page' : 'text-accent bg-page border-accent hover:bg-page'}`}>
                                {t.isActive ? 'Deactivate' : 'Activate'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── CALENDAR ── */}
          {activeTab === 'calendar' && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="eyebrow-tight">Your Team</p>
                  <p className="text-sm font-black text-ink mt-0.5">{loadingSubordinates ? '…' : `${subordinates.length} direct report${subordinates.length !== 1 ? 's' : ''}`}</p>
                </div>
                {subordinates.length > 0 && (
                  <div className="flex -space-x-2">
                    {subordinates.slice(0, 6).map(s => (
                      <div key={s.id} className="w-8 h-8 bg-shadow border-2 border-paper flex items-center justify-center text-[9px] font-black text-accent">
                        {s.fullName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                    ))}
                    {subordinates.length > 6 && <div className="w-8 h-8 bg-rule border-2 border-paper flex items-center justify-center text-[9px] font-black text-muted">+{subordinates.length - 6}</div>}
                  </div>
                )}
              </div>
              {loadingSubordinates ? (
                <div className="h-40 bg-page animate-pulse" />
              ) : (
                <TeamCalendar subordinates={subordinates} />
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── LEAVE TYPE MODAL ── */}
      {typeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-shadow backdrop-">
          <div className="w-full max-w-lg bg-paper flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-8 py-6 border-b border-rule">
              <div>
                <h2 className="text-lg font-black text-ink tracking-tighter">{editingType ? 'Edit Leave Type' : 'New Leave Type'}</h2>
                <p className="eyebrow-tight mt-0.5">{editingType ? `Editing ${editingType.code}` : 'Create a new leave policy'}</p>
              </div>
              <button onClick={() => setTypeModal(false)} className="w-9 h-9 flex items-center justify-center text-muted hover:text-ink hover:bg-page transition-all text-lg">✕</button>
            </div>
            <div className="p-8 flex flex-col gap-5 overflow-y-auto max-h-[70vh]">
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <label className="text-[10px] font-black text-muted uppercase tracking-widest">Code *</label>
                  <input value={typeForm.code} onChange={e => tf('code', e.target.value)} disabled={!!editingType}
                    placeholder="e.g. AL, SL, ML"
                    className="w-full px-4 py-3 bg-page border border-rule text-sm font-bold text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent uppercase disabled:opacity-50" />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-[10px] font-black text-muted uppercase tracking-widest">Name *</label>
                  <input value={typeForm.name} onChange={e => tf('name', e.target.value)}
                    placeholder="e.g. Annual Leave"
                    className="w-full px-4 py-3 bg-page border border-rule text-sm font-bold text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent" />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-[10px] font-black text-muted uppercase tracking-widest">Annual Entitlement (days)</label>
                  <input type="number" min={0} max={365} value={typeForm.annualEntitlement} onChange={e => tf('annualEntitlement', parseFloat(e.target.value) || 0)}
                    className="w-full px-4 py-3 bg-page border border-rule text-sm font-bold text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent" />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-[10px] font-black text-muted uppercase tracking-widest">Max Carry Forward (days)</label>
                  <input type="number" min={0} max={365} value={typeForm.maxCarryForward} onChange={e => tf('maxCarryForward', parseFloat(e.target.value) || 0)}
                    className="w-full px-4 py-3 bg-page border border-rule text-sm font-bold text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent" />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-[10px] font-black text-muted uppercase tracking-widest">Min Notice Days</label>
                  <input type="number" min={0} max={90} value={typeForm.minNoticeDays} onChange={e => tf('minNoticeDays', parseInt(e.target.value) || 0)}
                    className="w-full px-4 py-3 bg-page border border-rule text-sm font-bold text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {([
                  { key: 'isPaid', label: 'Paid Leave' },
                  { key: 'isStatutory', label: 'Statutory Leave' },
                  { key: 'isGovtPaid', label: 'Govt-Paid' },
                  { key: 'requiresDocument', label: 'Requires Document' },
                ] as const).map(({ key, label }) => (
                  <label key={key} className="flex items-center gap-3 px-4 py-3 bg-page border border-rule cursor-pointer hover:border-accent transition-all">
                    <input type="checkbox" checked={typeForm[key] as boolean} onChange={e => tf(key, e.target.checked)}
                      className="w-4 h-4 accent-accent" />
                    <span className="text-[11px] font-black text-ink uppercase tracking-widest">{label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex gap-3 px-8 py-5 border-t border-rule bg-page">
              <button onClick={() => setTypeModal(false)} className="flex-1 py-3 text-[10px] font-black text-muted border border-rule hover:bg-page uppercase tracking-widest transition-all">Cancel</button>
              <button onClick={handleSaveType} disabled={savingType} className="flex-1 py-3 text-[10px] font-black text-paper bg-accent hover:bg-accent disabled:opacity-50 uppercase tracking-widest transition-all">
                {savingType ? 'Saving…' : editingType ? 'Save Changes' : 'Create Leave Type'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── DETAIL MODAL ── */}
      {detailId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-shadow backdrop-" onClick={() => setDetailId(null)}>
          <div className="w-full max-w-3xl bg-paper flex flex-col max-h-[90vh] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-8 py-6 border-b border-rule">
              <div>
                <h2 className="text-lg font-black text-ink tracking-tighter">Leave Application</h2>
                <p className="eyebrow-tight mt-0.5">
                  {loadingDetail ? 'Loading…' : detail ? `${detail.leaveType?.name ?? '—'} · ${detail.totalDays} day${detail.totalDays !== 1 ? 's' : ''}` : ''}
                </p>
              </div>
              <button onClick={() => setDetailId(null)} className="w-9 h-9 flex items-center justify-center text-muted hover:text-ink hover:bg-page transition-all text-lg">✕</button>
            </div>

            <div className="p-8 flex flex-col gap-6 overflow-y-auto">
              {loadingDetail ? (
                <div className="h-40 bg-page animate-pulse" />
              ) : !detail ? (
                <p className="text-sm font-black text-muted text-center py-12">Unable to load application</p>
              ) : (
                <>
                  {/* Employee */}
                  <div className="flex items-center gap-4 p-5 bg-page border border-rule">
                    <div className="w-14 h-14 bg-shadow flex items-center justify-center text-sm font-black text-paper shrink-0">
                      {(detail.employee?.fullName ?? '?').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-base font-black text-ink truncate">{detail.employee?.fullName ?? detail.employeeId}</p>
                      <p className="text-[10px] font-bold text-muted mt-0.5 uppercase tracking-widest">
                        {detail.employee?.designation ?? '—'} · {detail.employee?.department ?? '—'}
                      </p>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        {detail.employee?.employeeCode && (
                          <span className="text-[9px] font-black bg-page text-accent border border-accent px-2 py-0.5 uppercase tracking-widest">EMP {detail.employee.employeeCode}</span>
                        )}
                        {detail.employee?.workEmail && (
                          <a href={`mailto:${detail.employee.workEmail}`} className="text-[9px] font-bold text-accent hover:underline">{detail.employee.workEmail}</a>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Leave summary */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="p-4 bg-paper border border-rule">
                      <p className="label-form">Leave Type</p>
                      <p className="text-sm font-black text-ink mt-1">{detail.leaveType?.name ?? '—'}</p>
                      {detail.leaveType && (
                        <p className="text-[9px] font-bold text-muted mt-0.5">{detail.leaveType.isPaid ? 'Paid' : 'Unpaid'}</p>
                      )}
                    </div>
                    <div className="p-4 bg-paper border border-rule">
                      <p className="label-form">Start</p>
                      <p className="text-sm font-black text-ink mt-1">{fmtDate(detail.startDate.slice(0, 10))}</p>
                    </div>
                    <div className="p-4 bg-paper border border-rule">
                      <p className="label-form">End</p>
                      <p className="text-sm font-black text-ink mt-1">{fmtDate(detail.endDate.slice(0, 10))}</p>
                    </div>
                    <div className="p-4 bg-page border border-accent">
                      <p className="text-[9px] font-black text-accent uppercase tracking-widest">Total</p>
                      <p className="text-sm font-black text-accent mt-1">{detail.totalDays} day{detail.totalDays !== 1 ? 's' : ''}{detail.isHalfDay ? ` (${detail.halfDaySlot ?? 'half'})` : ''}</p>
                    </div>
                  </div>

                  {/* Reason */}
                  <div className="p-4 bg-page border border-rule">
                    <p className="label-form mb-2">Reason</p>
                    <p className="text-sm font-bold text-ink leading-relaxed whitespace-pre-wrap">
                      {detail.reason?.trim() ? detail.reason : <span className="text-muted italic">No reason provided</span>}
                    </p>
                  </div>

                  {/* Attachment */}
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <p className="label-form">Supporting Document</p>
                      {detail.attachment && (
                        <button onClick={downloadAttachment} className="text-[9px] font-black text-accent hover:text-accent uppercase tracking-widest">
                          Download ↓
                        </button>
                      )}
                    </div>
                    {!detail.attachment ? (
                      <div className="p-6 bg-page border border-dashed border-rule text-center">
                        <p className="text-[10px] font-bold text-muted uppercase tracking-widest">No attachment provided</p>
                      </div>
                    ) : detail.attachment.mimeType.startsWith('image/') ? (
                      <div className="border border-rule overflow-hidden bg-page">
                        {attachmentObjectUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={attachmentObjectUrl} alt={detail.attachment.fileName} className="w-full max-h-[400px] object-contain" />
                        ) : (
                          <div className="h-40 flex items-center justify-center eyebrow-tight animate-pulse">Loading image…</div>
                        )}
                        <p className="text-[9px] font-bold text-muted text-center py-2 border-t border-rule">{detail.attachment.fileName}</p>
                      </div>
                    ) : detail.attachment.mimeType === 'application/pdf' ? (
                      <div className="flex items-center justify-between gap-4 p-4 bg-page border border-ink">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="text-2xl">📄</span>
                          <div className="min-w-0">
                            <p className="text-[11px] font-black text-ink truncate">{detail.attachment.fileName}</p>
                            <p className="text-[9px] font-bold text-ink uppercase tracking-widest">PDF Document</p>
                          </div>
                        </div>
                        <button onClick={downloadAttachment} className="px-4 py-2 bg-ink text-paper text-[9px] font-black uppercase tracking-widest hover:bg-ink transition-all">Open</button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-4 p-4 bg-page border border-rule">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="text-2xl">📎</span>
                          <div className="min-w-0">
                            <p className="text-[11px] font-black text-ink truncate">{detail.attachment.fileName}</p>
                            <p className="text-[9px] font-bold text-muted uppercase tracking-widest">{detail.attachment.mimeType}</p>
                          </div>
                        </div>
                        <button onClick={downloadAttachment} className="px-4 py-2 bg-shadow text-paper text-[9px] font-black uppercase tracking-widest hover:bg-shadow transition-all">Download</button>
                      </div>
                    )}
                  </div>

                  {/* Approval chain (if multi-step) */}
                  {detail.approvalSteps && detail.approvalSteps.length > 0 && (
                    <div className="flex flex-col gap-2">
                      <p className="label-form">Approval Trail</p>
                      {detail.approvalSteps.map(s => (
                        <div key={s.step} className="flex items-center gap-3 p-3 bg-page border border-accent">
                          <span className="text-[9px] font-black bg-accent text-paper px-2 py-0.5">Step {s.step}</span>
                          <span className="text-[10px] font-bold text-accent">{new Date(s.approvedAt).toLocaleString('en-SG')}</span>
                          <span className="text-[9px] font-bold text-muted ml-auto">{s.approvedByEmpId.slice(0, 8)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Action footer (only when status is PENDING) */}
            {detail?.status === 'PENDING' && (
              <div className="flex gap-3 px-8 py-5 border-t border-rule bg-page">
                <button
                  onClick={() => handleReject(detail.id)}
                  disabled={decisionBusy}
                  className="flex-1 py-3 text-[10px] font-black text-ink bg-page border border-ink hover:bg-page uppercase tracking-widest transition-all disabled:opacity-50"
                >
                  Reject
                </button>
                <button
                  onClick={() => handleApprove(detail.id)}
                  disabled={decisionBusy}
                  className="flex-1 py-3 text-[10px] font-black text-paper bg-accent hover:bg-accent uppercase tracking-widest transition-all disabled:opacity-50"
                >
                  {decisionBusy ? 'Working…' : 'Approve'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
