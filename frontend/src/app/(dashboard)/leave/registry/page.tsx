'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';

const ALLOWED_ROLES = ['SUPER_ADMIN', 'HR_ADMIN', 'HR_MANAGER', 'PAYROLL_OFFICER'];

function fmtDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
}

interface PendingLeave {
  id: string; employeeId: string; employeeName: string; dept: string;
  leaveTypeName: string; from: string; to: string; days: number; reason: string;
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
      <div className={`px-8 py-4 rounded-2xl shadow-2xl flex items-center gap-4 ${type === 'success' ? 'bg-slate-900 border border-slate-700' : 'bg-red-900 border border-red-700'}`}>
        <div className={`w-2 h-2 rounded-full ${type === 'success' ? 'bg-emerald-500' : 'bg-red-400'}`} />
        <span className="text-[10px] font-black text-white uppercase tracking-widest">{msg}</span>
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
        <div className="w-10 h-10 border-4 border-indigo-600/20 border-t-indigo-600 rounded-full animate-spin" />
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

function AdminLeaveView() {
  const [activeTab, setActiveTab] = useState<'approvals' | 'types' | 'calendar'>('approvals');
  const [pending, setPending] = useState<PendingLeave[]>([]);
  const [loadingApprovals, setLoadingApprovals] = useState(true);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  // Leave Types state
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [loadingTypes, setLoadingTypes] = useState(false);
  const [typeModal, setTypeModal] = useState(false);
  const [editingType, setEditingType] = useState<LeaveType | null>(null);
  const [typeForm, setTypeForm] = useState<Omit<LeaveType, 'id' | 'isActive'>>(BLANK_TYPE);
  const [savingType, setSavingType] = useState(false);

  useEffect(() => {
    apiFetch('/leave/applications?status=PENDING&limit=100')
      .then(data => {
        const apps = data.applications ?? [];
        setPending(apps.map((a: any) => ({
          id: a.id, employeeId: a.employeeId,
          employeeName: a.employee?.fullName ?? a.employeeId,
          dept: a.employee?.department ?? '—',
          leaveTypeName: a.leaveType?.name ?? a.leaveTypeId,
          from: a.startDate.slice(0, 10), to: a.endDate.slice(0, 10),
          days: a.totalDays, reason: a.reason ?? '',
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

  const showToast = (msg: string, type: 'success' | 'error') => setToast({ msg, type });

  const handleApprove = async (id: string) => {
    try {
      await apiFetch(`/leave/applications/${id}/approve`, { method: 'PUT' });
      setPending(prev => prev.filter(p => p.id !== id));
      showToast('Leave approved', 'success');
    } catch (e: any) { showToast(e.message, 'error'); }
  };

  const handleReject = async (id: string) => {
    try {
      await apiFetch(`/leave/applications/${id}/reject`, { method: 'PUT', body: JSON.stringify({ reason: 'Rejected by HR' }) });
      setPending(prev => prev.filter(p => p.id !== id));
      showToast('Leave rejected', 'success');
    } catch (e: any) { showToast(e.message, 'error'); }
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

      <div className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-xl shadow-indigo-500/5 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tighter">Leave <span className="text-indigo-600">Management</span></h1>
          <p className="text-[10px] font-black text-slate-400 mt-1 uppercase tracking-widest">Organizational leave portal · Statutory compliance</p>
        </div>
        {activeTab === 'types' && (
          <button onClick={openNewType} className="px-6 py-2.5 rounded-xl text-[10px] font-black text-white bg-indigo-600 hover:bg-indigo-700 transition-all uppercase tracking-widest">
            + New Leave Type
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="bg-white p-7 rounded-[1.5rem] border border-slate-100 shadow-lg shadow-indigo-500/5">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Pending Approval</p>
          {loadingApprovals ? <div className="h-10 w-16 bg-slate-100 rounded-xl animate-pulse" /> : <p className="text-4xl font-black text-amber-500">{pending.length}</p>}
          <p className="text-[9px] font-black text-amber-600 mt-4 uppercase tracking-widest flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse" />
            Awaiting decision
          </p>
        </div>
        <div className="bg-slate-900 p-7 rounded-[1.5rem] border border-slate-800 shadow-xl">
          <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-3">Leave Types Active</p>
          <p className="text-4xl font-black text-white">{leaveTypes.filter(t => t.isActive).length || '—'}</p>
          <p className="text-[9px] font-black text-slate-500 mt-4 uppercase tracking-widest italic">Configured types</p>
        </div>
        <div className="bg-emerald-50/60 p-7 rounded-[1.5rem] border border-emerald-100">
          <p className="text-[10px] font-black text-emerald-700 uppercase tracking-widest mb-3 text-center">Total Submissions</p>
          <p className="text-4xl font-black text-emerald-800 text-center">{loadingApprovals ? '—' : pending.length}</p>
        </div>
      </div>

      <div className="bg-white border border-slate-100 rounded-[2rem] shadow-xl shadow-indigo-500/5 overflow-hidden">
        <div className="border-b border-slate-100 px-8 flex gap-8 bg-slate-50/50">
          {([
            { key: 'approvals', label: `Authorization Queue (${loadingApprovals ? '…' : pending.length})` },
            { key: 'types', label: 'Leave Types' },
            { key: 'calendar', label: 'Team Calendar' },
          ] as const).map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`py-5 text-[11px] font-black uppercase tracking-widest border-b-2 transition-all ${activeTab === tab.key ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
              {tab.label}
            </button>
          ))}
        </div>

        <div className="p-8">
          {/* ── APPROVALS ── */}
          {activeTab === 'approvals' && (
            <div className="flex flex-col gap-3">
              {loadingApprovals ? (
                [1,2,3].map(i => <div key={i} className="h-20 bg-slate-50 rounded-2xl animate-pulse" />)
              ) : pending.length === 0 ? (
                <div className="py-16 text-center">
                  <p className="text-sm font-black text-slate-300 uppercase tracking-widest">No pending leave applications</p>
                </div>
              ) : pending.map(req => (
                <div key={req.id} className="flex items-center gap-5 p-5 rounded-2xl border bg-slate-50/50 border-slate-100 hover:border-indigo-100 transition-all">
                  <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center text-[11px] font-black text-white shrink-0">
                    {req.employeeName.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-slate-900 uppercase tracking-tight text-sm">{req.employeeName}</p>
                    <p className="text-[10px] font-bold text-slate-500 mt-0.5 uppercase tracking-widest">{req.dept} · {req.leaveTypeName} · {req.days} day{req.days > 1 ? 's' : ''}</p>
                    <p className="text-[10px] font-bold text-slate-400 mt-0.5">{fmtDate(req.from)} → {fmtDate(req.to)}</p>
                    {req.reason && <p className="text-[9px] font-bold text-slate-400 mt-0.5 truncate">"{req.reason}"</p>}
                  </div>
                  <div className="flex gap-3 shrink-0">
                    <button onClick={() => handleReject(req.id)} className="px-5 py-2 bg-red-50 text-red-600 border border-red-100 text-[9px] font-black uppercase tracking-widest rounded-lg hover:bg-red-100 transition-all">Reject</button>
                    <button onClick={() => handleApprove(req.id)} className="px-5 py-2 bg-indigo-600 text-white text-[9px] font-black uppercase tracking-widest rounded-lg hover:bg-indigo-700 shadow-lg shadow-indigo-500/15 transition-all">Approve</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── LEAVE TYPES ── */}
          {activeTab === 'types' && (
            <div className="flex flex-col gap-4">
              {loadingTypes ? (
                [1,2,3,4].map(i => <div key={i} className="h-16 bg-slate-50 rounded-2xl animate-pulse" />)
              ) : leaveTypes.length === 0 ? (
                <div className="py-16 text-center">
                  <p className="text-sm font-black text-slate-300 uppercase tracking-widest">No leave types configured</p>
                  <button onClick={openNewType} className="mt-4 px-6 py-2.5 bg-indigo-600 text-white text-[10px] font-black rounded-xl uppercase tracking-widest hover:bg-indigo-700 transition-all">Create First Leave Type</button>
                </div>
              ) : (
                <div className="overflow-hidden border border-slate-200 rounded-2xl">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-[9px] font-black text-slate-400 uppercase tracking-widest">
                        <th className="px-5 py-3">Code</th>
                        <th className="px-5 py-3">Name</th>
                        <th className="px-5 py-3">Entitlement</th>
                        <th className="px-5 py-3">Carry Fwd</th>
                        <th className="px-5 py-3">Paid</th>
                        <th className="px-5 py-3">Statutory</th>
                        <th className="px-5 py-3">Doc Req.</th>
                        <th className="px-5 py-3">Status</th>
                        <th className="px-5 py-3"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs font-bold text-slate-700">
                      {leaveTypes.map(t => (
                        <tr key={t.id} className={`hover:bg-slate-50 transition-all ${!t.isActive ? 'opacity-50' : ''}`}>
                          <td className="px-5 py-3"><span className="font-mono text-[10px] bg-indigo-50 text-indigo-700 border border-indigo-100 px-2 py-0.5 rounded uppercase">{t.code}</span></td>
                          <td className="px-5 py-3 font-black text-slate-800">{t.name}</td>
                          <td className="px-5 py-3">
                            {(!t.isPaid || t.annualEntitlement === 0)
                              ? <span className="text-[9px] font-black px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-100 uppercase">No Limit</span>
                              : `${t.annualEntitlement} days`
                            }
                          </td>
                          <td className="px-5 py-3">{t.maxCarryForward > 0 ? `${t.maxCarryForward} days` : '—'}</td>
                          <td className="px-5 py-3">
                            <span className={`text-[9px] font-black px-2 py-0.5 rounded uppercase ${t.isPaid ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-slate-100 text-slate-500 border border-slate-200'}`}>
                              {t.isPaid ? 'Paid' : 'Unpaid'}
                            </span>
                          </td>
                          <td className="px-5 py-3">
                            {t.isStatutory ? <span className="text-[9px] font-black px-2 py-0.5 rounded uppercase bg-amber-50 text-amber-700 border border-amber-100">Statutory</span> : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="px-5 py-3">
                            {t.requiresDocument ? <span className="text-[9px] font-black px-2 py-0.5 rounded uppercase bg-sky-50 text-sky-700 border border-sky-100">Yes</span> : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="px-5 py-3">
                            <span className={`text-[9px] font-black px-2 py-0.5 rounded uppercase ${t.isActive ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-slate-100 text-slate-400 border border-slate-200'}`}>
                              {t.isActive ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td className="px-5 py-3">
                            <div className="flex gap-2">
                              <button onClick={() => openEditType(t)} className="px-3 py-1.5 text-[9px] font-black text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-lg hover:bg-indigo-100 uppercase tracking-widest transition-all">Edit</button>
                              <button onClick={() => handleDeactivate(t)} className={`px-3 py-1.5 text-[9px] font-black rounded-lg uppercase tracking-widest transition-all border ${t.isActive ? 'text-red-600 bg-red-50 border-red-100 hover:bg-red-100' : 'text-emerald-600 bg-emerald-50 border-emerald-100 hover:bg-emerald-100'}`}>
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
            <div className="h-80 flex flex-col items-center justify-center bg-slate-50 rounded-2xl border border-dashed border-slate-200">
              <div className="w-14 h-14 bg-slate-900 rounded-2xl flex items-center justify-center text-xl mb-4 shadow-xl border border-slate-800">📅</div>
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">Team Availability Calendar</h3>
              <p className="text-[10px] font-bold mt-2 text-slate-400 uppercase tracking-widest text-center max-w-xs">Integrating leave data for team overlap visualization</p>
            </div>
          )}
        </div>
      </div>

      {/* ── LEAVE TYPE MODAL ── */}
      {typeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-white rounded-[2rem] shadow-2xl flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-8 py-6 border-b border-slate-100">
              <div>
                <h2 className="text-lg font-black text-slate-900 tracking-tighter">{editingType ? 'Edit Leave Type' : 'New Leave Type'}</h2>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-0.5">{editingType ? `Editing ${editingType.code}` : 'Create a new leave policy'}</p>
              </div>
              <button onClick={() => setTypeModal(false)} className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all text-lg">✕</button>
            </div>
            <div className="p-8 flex flex-col gap-5 overflow-y-auto max-h-[70vh]">
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Code *</label>
                  <input value={typeForm.code} onChange={e => tf('code', e.target.value)} disabled={!!editingType}
                    placeholder="e.g. AL, SL, ML"
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 uppercase disabled:opacity-50" />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Name *</label>
                  <input value={typeForm.name} onChange={e => tf('name', e.target.value)}
                    placeholder="e.g. Annual Leave"
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10" />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Annual Entitlement (days)</label>
                  <input type="number" min={0} max={365} value={typeForm.annualEntitlement} onChange={e => tf('annualEntitlement', parseFloat(e.target.value) || 0)}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10" />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Max Carry Forward (days)</label>
                  <input type="number" min={0} max={365} value={typeForm.maxCarryForward} onChange={e => tf('maxCarryForward', parseFloat(e.target.value) || 0)}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10" />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Min Notice Days</label>
                  <input type="number" min={0} max={90} value={typeForm.minNoticeDays} onChange={e => tf('minNoticeDays', parseInt(e.target.value) || 0)}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {([
                  { key: 'isPaid', label: 'Paid Leave' },
                  { key: 'isStatutory', label: 'Statutory Leave' },
                  { key: 'isGovtPaid', label: 'Govt-Paid' },
                  { key: 'requiresDocument', label: 'Requires Document' },
                ] as const).map(({ key, label }) => (
                  <label key={key} className="flex items-center gap-3 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl cursor-pointer hover:border-indigo-300 transition-all">
                    <input type="checkbox" checked={typeForm[key] as boolean} onChange={e => tf(key, e.target.checked)}
                      className="w-4 h-4 accent-indigo-600" />
                    <span className="text-[11px] font-black text-slate-700 uppercase tracking-widest">{label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex gap-3 px-8 py-5 border-t border-slate-100 bg-slate-50/50">
              <button onClick={() => setTypeModal(false)} className="flex-1 py-3 text-[10px] font-black text-slate-500 border border-slate-200 rounded-xl hover:bg-slate-100 uppercase tracking-widest transition-all">Cancel</button>
              <button onClick={handleSaveType} disabled={savingType} className="flex-1 py-3 text-[10px] font-black text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-xl uppercase tracking-widest transition-all">
                {savingType ? 'Saving…' : editingType ? 'Save Changes' : 'Create Leave Type'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
