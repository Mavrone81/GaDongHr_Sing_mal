'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { apiFetch } from '@/lib/api';

// ── Types ──────────────────────────────────────────────────────────────────────
interface LeaveBalance {
  leaveTypeId: string;
  entitledDays: number;
  usedDays: number;
  pendingDays: number;
  carryForward: number;
  leaveType?: { name: string; color?: string };
}

interface AttendanceRecord {
  id: string;
  date: string;
  clockIn: string | null;
  clockOut: string | null;
  status: string;
  hoursWorked: number | null;
}

interface LeaveApplication {
  id: string;
  status: string;
  startDate: string;
  endDate: string;
  totalDays: number;
  leaveType?: { name: string };
}

// ── Greeting ───────────────────────────────────────────────────────────────────
function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function todayLabel() {
  return new Date().toLocaleDateString('en-SG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

// ── Leave Balances Card ────────────────────────────────────────────────────────
function LeaveCard({ employeeId }: { employeeId: string }) {
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch(`/leave/balances/${employeeId}`)
      .then(data => setBalances(Array.isArray(data) ? data.slice(0, 4) : []))
      .catch(() => setBalances([]))
      .finally(() => setLoading(false));
  }, [employeeId]);

  const accentColors: Record<number, { bg: string; text: string; bar: string }> = {
    0: { bg: 'bg-indigo-50', text: 'text-indigo-700', bar: 'bg-indigo-500' },
    1: { bg: 'bg-emerald-50', text: 'text-emerald-700', bar: 'bg-emerald-500' },
    2: { bg: 'bg-amber-50', text: 'text-amber-700', bar: 'bg-amber-500' },
    3: { bg: 'bg-rose-50', text: 'text-rose-700', bar: 'bg-rose-500' },
  };

  return (
    <div className="bg-white rounded-[2rem] shadow-sm border border-slate-100 p-8 h-full flex flex-col">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-sm font-black text-slate-900">Leave Balances</h3>
          <p className="text-[10px] font-bold text-slate-400 mt-0.5">{new Date().getFullYear()} entitlements</p>
        </div>
        <Link href="/leave" className="text-[9px] font-black text-indigo-600 uppercase tracking-widest hover:text-indigo-800 transition-colors">
          Apply →
        </Link>
      </div>

      {loading ? (
        <div className="flex flex-col gap-4 flex-1">
          {[1, 2, 3].map(i => <div key={i} className="h-16 bg-slate-50 rounded-2xl animate-pulse" />)}
        </div>
      ) : balances.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">No leave entitlements set up</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3 flex-1">
          {balances.map((b, i) => {
            const available = Math.max(0, b.entitledDays + b.carryForward - b.usedDays - b.pendingDays);
            const total = b.entitledDays + b.carryForward;
            const usedPct = total > 0 ? Math.min(100, ((b.usedDays + b.pendingDays) / total) * 100) : 0;
            const c = accentColors[i % 4];
            return (
              <div key={b.leaveTypeId} className={`${c.bg} rounded-2xl px-5 py-4 flex items-center gap-4`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-black text-slate-700 truncate">{b.leaveType?.name ?? 'Leave'}</span>
                    <span className={`text-xs font-black ${c.text}`}>{available} left</span>
                  </div>
                  <div className="w-full h-1.5 bg-white/60 rounded-full overflow-hidden">
                    <div className={`h-full ${c.bar} rounded-full transition-all`} style={{ width: `${usedPct}%` }} />
                  </div>
                  <p className="text-[9px] font-bold text-slate-400 mt-1.5">{b.usedDays} used · {total} total</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Today's Attendance Card ────────────────────────────────────────────────────
function AttendanceCard({ employeeId }: { employeeId: string }) {
  const [record, setRecord] = useState<AttendanceRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [clocking, setClocking] = useState(false);
  const [error, setError] = useState('');

  const today = new Date().toISOString().slice(0, 10);

  const loadToday = useCallback(async () => {
    try {
      const data: AttendanceRecord[] = await apiFetch(`/attendance/${employeeId}?startDate=${today}&endDate=${today}`);
      setRecord(Array.isArray(data) && data.length > 0 ? data[0] : null);
    } catch {
      setRecord(null);
    } finally {
      setLoading(false);
    }
  }, [employeeId, today]);

  useEffect(() => { loadToday(); }, [loadToday]);

  const clockIn = async () => {
    setClocking(true); setError('');
    try {
      await apiFetch('/attendance/clock-in', { method: 'POST', body: JSON.stringify({}) });
      await loadToday();
    } catch (e: any) { setError(e.message); }
    finally { setClocking(false); }
  };

  const clockOut = async () => {
    setClocking(true); setError('');
    try {
      await apiFetch('/attendance/clock-out', { method: 'POST', body: JSON.stringify({}) });
      await loadToday();
    } catch (e: any) { setError(e.message); }
    finally { setClocking(false); }
  };

  const fmtTime = (iso: string | null) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' });
  };

  const statusColors: Record<string, string> = {
    PRESENT: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    LATE: 'bg-amber-50 text-amber-700 border-amber-200',
    ABSENT: 'bg-red-50 text-red-700 border-red-200',
    HALF_DAY: 'bg-blue-50 text-blue-700 border-blue-200',
  };

  return (
    <div className="bg-white rounded-[2rem] shadow-sm border border-slate-100 p-8 flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-black text-slate-900">Today&apos;s Attendance</h3>
          <p className="text-[10px] font-bold text-slate-400 mt-0.5">{todayLabel()}</p>
        </div>
        {record?.status && (
          <span className={`text-[9px] font-black uppercase tracking-widest border px-2.5 py-1 rounded-full ${statusColors[record.status] ?? 'bg-slate-50 text-slate-500 border-slate-200'}`}>
            {record.status.replace('_', ' ')}
          </span>
        )}
      </div>

      {loading ? (
        <div className="h-20 bg-slate-50 rounded-2xl animate-pulse" />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Clock In', val: fmtTime(record?.clockIn ?? null) },
              { label: 'Clock Out', val: fmtTime(record?.clockOut ?? null) },
              { label: 'Hours', val: record?.hoursWorked ? `${record.hoursWorked.toFixed(1)}h` : '—' },
            ].map(item => (
              <div key={item.label} className="bg-slate-50 rounded-2xl p-4 text-center">
                <p className="label-form mb-1">{item.label}</p>
                <p className="text-lg font-black text-slate-900">{item.val}</p>
              </div>
            ))}
          </div>

          {error && <p className="text-[10px] font-black text-red-500">{error}</p>}

          {!record?.clockIn ? (
            <button onClick={clockIn} disabled={clocking}
              className="w-full py-4 bg-indigo-600 text-white text-[11px] font-black uppercase tracking-[0.25em] rounded-2xl hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-500/20 active:scale-95 disabled:opacity-70">
              {clocking ? 'Clocking in…' : 'Clock In'}
            </button>
          ) : !record?.clockOut ? (
            <button onClick={clockOut} disabled={clocking}
              className="w-full py-4 bg-slate-900 text-white text-[11px] font-black uppercase tracking-[0.25em] rounded-2xl hover:bg-slate-700 transition-all shadow-lg shadow-slate-500/20 active:scale-95 disabled:opacity-70">
              {clocking ? 'Clocking out…' : 'Clock Out'}
            </button>
          ) : (
            <div className="flex items-center justify-center gap-2 py-4 bg-emerald-50 border border-emerald-200 rounded-2xl">
              <span className="w-2 h-2 bg-emerald-500 rounded-full" />
              <span className="text-[10px] font-black text-emerald-700 uppercase tracking-widest">Day complete</span>
            </div>
          )}
        </>
      )}

      <Link href="/attendance" className="text-center label-form hover:text-indigo-600 transition-colors">
        View history →
      </Link>
    </div>
  );
}

// ── My Leave Requests Card ────────────────────────────────────────────────────
function LeaveRequestsCard({ employeeId }: { employeeId: string }) {
  const [leaves, setLeaves] = useState<LeaveApplication[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch(`/leave/applications?employeeId=${employeeId}&limit=5`)
      .then(data => setLeaves(Array.isArray(data) ? data : (data?.applications ?? [])))
      .catch(() => setLeaves([]))
      .finally(() => setLoading(false));
  }, [employeeId]);

  const statusStyle: Record<string, { bg: string; text: string; dot: string }> = {
    PENDING:  { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-400' },
    APPROVED: { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
    REJECTED: { bg: 'bg-red-50', text: 'text-red-600', dot: 'bg-red-400' },
    CANCELLED:{ bg: 'bg-slate-50', text: 'text-slate-400', dot: 'bg-slate-300' },
  };

  return (
    <div className="bg-white rounded-[2rem] shadow-sm border border-slate-100 p-8 h-full flex flex-col">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-sm font-black text-slate-900">My Leave Requests</h3>
          <p className="text-[10px] font-bold text-slate-400 mt-0.5">Recent applications</p>
        </div>
        <Link href="/leave" className="text-[9px] font-black text-indigo-600 uppercase tracking-widest hover:text-indigo-800 transition-colors">
          View all →
        </Link>
      </div>

      {loading ? (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map(i => <div key={i} className="h-12 bg-slate-50 rounded-xl animate-pulse" />)}
        </div>
      ) : leaves.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 py-8">
          <div className="w-12 h-12 bg-slate-50 rounded-2xl flex items-center justify-center text-xl">🏖️</div>
          <p className="eyebrow-tight text-center">No leave requests yet</p>
          <Link href="/leave" className="text-[9px] font-black text-indigo-600 uppercase tracking-widest hover:underline">
            Apply for leave →
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-2 flex-1">
          {leaves.map(l => {
            const s = statusStyle[l.status] ?? statusStyle.PENDING;
            const start = new Date(l.startDate).toLocaleDateString('en-SG', { day: '2-digit', month: 'short' });
            const end = new Date(l.endDate).toLocaleDateString('en-SG', { day: '2-digit', month: 'short' });
            return (
              <div key={l.id} className="flex items-center gap-3 px-4 py-3 rounded-xl border border-slate-100 hover:bg-slate-50 transition-all">
                <span className={`w-2 h-2 rounded-full shrink-0 ${s.dot}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-black text-slate-800 truncate">{l.leaveType?.name ?? 'Leave'}</p>
                  <p className="text-[9px] font-bold text-slate-400">{start} – {end} · {l.totalDays}d</p>
                </div>
                <span className={`text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${s.bg} ${s.text}`}>
                  {l.status}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Quick Links Card ───────────────────────────────────────────────────────────
function QuickLinksCard({ employeeId }: { employeeId: string }) {
  const links = [
    { label: 'Apply Leave', href: '/leave', icon: '📅', color: 'bg-indigo-50 hover:bg-indigo-100 border-indigo-100' },
    { label: 'Submit Claim', href: '/claims', icon: '💳', color: 'bg-emerald-50 hover:bg-emerald-100 border-emerald-100' },
    { label: 'My Profile', href: `/employees/${employeeId}`, icon: '👤', color: 'bg-slate-50 hover:bg-slate-100 border-slate-100' },
    { label: 'Payslips', href: '/payroll', icon: '💰', color: 'bg-amber-50 hover:bg-amber-100 border-amber-100' },
    { label: 'Attendance', href: '/attendance', icon: '🕐', color: 'bg-blue-50 hover:bg-blue-100 border-blue-100' },
    { label: 'Training', href: '/training', icon: '📚', color: 'bg-purple-50 hover:bg-purple-100 border-purple-100' },
  ];

  return (
    <div className="bg-white rounded-[2rem] shadow-sm border border-slate-100 p-8">
      <h3 className="text-sm font-black text-slate-900 mb-6">Quick Actions</h3>
      <div className="grid grid-cols-3 gap-3">
        {links.map(l => (
          <Link key={l.href} href={l.href}
            className={`flex flex-col items-center gap-2 py-4 px-2 rounded-2xl border transition-all text-center ${l.color}`}>
            <span className="text-2xl">{l.icon}</span>
            <span className="text-[9px] font-black text-slate-700 uppercase tracking-widest leading-tight">{l.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ── Upcoming / Celebrations ────────────────────────────────────────────────────
function UpcomingCard() {
  const items = [
    { icon: '🎂', label: 'Your birthday is coming up', sub: 'Share the joy with your team', color: 'text-rose-500' },
    { icon: '🌟', label: 'Work anniversary milestone', sub: 'Celebrate your journey here', color: 'text-amber-500' },
  ];

  return (
    <div className="bg-white rounded-[2rem] shadow-sm border border-slate-100 p-8">
      <h3 className="text-sm font-black text-slate-900 mb-6">Milestones & Celebrations</h3>
      <div className="flex flex-col gap-4">
        {items.map((item, i) => (
          <div key={i} className="flex items-start gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100">
            <span className={`text-2xl ${item.color}`}>{item.icon}</span>
            <div>
              <p className="text-[11px] font-black text-slate-800">{item.label}</p>
              <p className="text-[9px] font-bold text-slate-400 mt-0.5">{item.sub}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Dashboard ─────────────────────────────────────────────────────────────
export default function EmployeeDashboard() {
  const { user } = useAuth();
  const firstName = user?.name?.split(' ')[0] ?? 'there';
  const employeeId = user?.employeeId;

  if (!employeeId) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <div className="w-16 h-16 bg-amber-50 border border-amber-200 rounded-2xl flex items-center justify-center text-2xl">⚠️</div>
        <p className="text-sm font-black text-slate-500">Your account isn&apos;t linked to an employee profile yet.</p>
        <p className="text-[10px] font-bold text-slate-400 text-center max-w-xs">Contact your HR administrator to complete your profile setup.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 pb-12 animate-in fade-in slide-in-from-bottom-4 duration-700">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tighter">
            {greeting()}, {firstName} 👋
          </h1>
          <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-widest">{todayLabel()}</p>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

        {/* Left column (2/3) */}
        <div className="lg:col-span-2 flex flex-col gap-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <LeaveCard employeeId={employeeId} />
            <LeaveRequestsCard employeeId={employeeId} />
          </div>
          <QuickLinksCard employeeId={employeeId} />
          <UpcomingCard />
        </div>

        {/* Right column (1/3) */}
        <div className="flex flex-col gap-8">
          <AttendanceCard employeeId={employeeId} />
        </div>

      </div>
    </div>
  );
}
