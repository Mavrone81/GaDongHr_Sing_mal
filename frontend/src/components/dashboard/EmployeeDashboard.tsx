'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { apiFetch } from '@/lib/api';
import { PageHeader, Card, CardHeader, Badge, Icon, EmptyState, Button, type BadgeTone, type IconName } from '@/components/ui';

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

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`bg-pill rounded-control animate-pulse ${className}`} aria-hidden="true" />;
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

  return (
    <Card className="h-full">
      <CardHeader title="Leave balances" caption={`${new Date().getFullYear()} entitlements`} action={<Link href="/leave" className="hover:underline">Apply</Link>} />
      {loading ? (
        <div className="flex flex-col gap-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-12" />)}</div>
      ) : balances.length === 0 ? (
        <EmptyState icon="calendar" title="No leave entitlements set up" description="Your HR administrator assigns entitlements from the leave settings." className="py-6" />
      ) : (
        <ul className="flex flex-col gap-3.5">
          {balances.map((b) => {
            const available = Math.max(0, b.entitledDays + b.carryForward - b.usedDays - b.pendingDays);
            const total = b.entitledDays + b.carryForward;
            const usedPct = total > 0 ? Math.min(100, ((b.usedDays + b.pendingDays) / total) * 100) : 0;
            return (
              <li key={b.leaveTypeId}>
                <div className="flex items-center justify-between mb-1.5 text-sm">
                  <span className="font-semibold text-ink truncate">{b.leaveType?.name ?? 'Leave'}</span>
                  <span className="text-accent font-bold tabular-nums">{available} left</span>
                </div>
                <div className="w-full h-1.5 bg-pill rounded-full overflow-hidden" role="progressbar" aria-valuenow={Math.round(usedPct)} aria-valuemin={0} aria-valuemax={100} aria-label={`${b.leaveType?.name ?? 'Leave'} used`}>
                  <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${usedPct}%` }} />
                </div>
                <p className="text-xs text-muted mt-1 tabular-nums">{b.usedDays} used{b.pendingDays > 0 ? ` · ${b.pendingDays} pending` : ''} · {total} total</p>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
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

  const STATUS_TONES: Record<string, BadgeTone> = {
    PRESENT: 'ok',
    LATE: 'warn',
    ABSENT: 'danger',
    HALF_DAY: 'accent',
  };

  return (
    <Card>
      <CardHeader
        title="Today"
        caption={todayLabel()}
        action={record?.status ? <Badge tone={STATUS_TONES[record.status] ?? 'neutral'}>{record.status.replace('_', ' ').toLowerCase().replace(/^\w/, (m) => m.toUpperCase())}</Badge> : undefined}
      />

      {loading ? (
        <Skeleton className="h-20" />
      ) : (
        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-3 gap-2">
            {[
              { label: 'Clock in', val: fmtTime(record?.clockIn ?? null) },
              { label: 'Clock out', val: fmtTime(record?.clockOut ?? null) },
              { label: 'Hours', val: record?.hoursWorked ? `${record.hoursWorked.toFixed(1)} h` : '—' },
            ].map(item => (
              <div key={item.label} className="bg-page rounded-control px-3 py-3 text-center">
                <dt className="text-xs text-muted mb-0.5">{item.label}</dt>
                <dd className="text-[17px] font-bold text-ink tabular-nums">{item.val}</dd>
              </div>
            ))}
          </dl>

          {error && <p className="text-[13px] text-danger" role="alert">{error}</p>}

          {!record?.clockIn ? (
            <Button onClick={clockIn} disabled={clocking} icon="clock" className="w-full">{clocking ? 'Clocking in…' : 'Clock in'}</Button>
          ) : !record?.clockOut ? (
            <Button variant="secondary" onClick={clockOut} disabled={clocking} icon="logout" className="w-full">{clocking ? 'Clocking out…' : 'Clock out'}</Button>
          ) : (
            <div className="flex items-center justify-center gap-2 h-10 rounded-control bg-ok-bg text-ok text-sm font-semibold">
              <Icon name="check" size={16} strokeWidth={2.5} />Day complete
            </div>
          )}

          <Link href="/attendance" className="text-center text-[13px] font-semibold text-accent hover:underline">View history</Link>
        </div>
      )}
    </Card>
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

  const STATUS_TONES: Record<string, BadgeTone> = {
    PENDING:  'warn',
    APPROVED: 'ok',
    REJECTED: 'danger',
    CANCELLED: 'neutral',
  };

  return (
    <Card className="h-full" padding="px-[22px] pt-5 pb-2">
      <CardHeader title="My leave requests" caption="Most recent" action={<Link href="/leave" className="hover:underline">View all</Link>} />
      {loading ? (
        <div className="flex flex-col gap-3 pb-4">{[1, 2, 3].map(i => <Skeleton key={i} className="h-11" />)}</div>
      ) : leaves.length === 0 ? (
        <EmptyState icon="calendar" title="No leave requests yet" action={<Link href="/leave" className="text-[13.5px] font-semibold text-accent hover:underline">Apply for leave</Link>} className="py-6" />
      ) : (
        <ul>
          {leaves.map(l => {
            const start = new Date(l.startDate).toLocaleDateString('en-SG', { day: '2-digit', month: 'short' });
            const end = new Date(l.endDate).toLocaleDateString('en-SG', { day: '2-digit', month: 'short' });
            return (
              <li key={l.id} className="flex items-center gap-3 py-[11px] border-t border-rule">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-ink truncate">{l.leaveType?.name ?? 'Leave'}</p>
                  <p className="text-[12.5px] text-muted tabular-nums">{start} – {end} · {l.totalDays} day{l.totalDays === 1 ? '' : 's'}</p>
                </div>
                <Badge tone={STATUS_TONES[l.status] ?? 'neutral'}>{l.status.charAt(0) + l.status.slice(1).toLowerCase()}</Badge>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// ── Quick Links Card ───────────────────────────────────────────────────────────
function QuickLinksCard({ employeeId }: { employeeId: string }) {
  const links: { label: string; href: string; icon: IconName }[] = [
    { label: 'Apply for leave', href: '/leave', icon: 'calendar' },
    { label: 'Submit a claim', href: '/claims', icon: 'receipt' },
    { label: 'My profile', href: `/employees/${employeeId}`, icon: 'user' },
    { label: 'Payslips', href: '/payroll/me', icon: 'wallet' },
    { label: 'Attendance', href: '/attendance', icon: 'clock' },
    { label: 'Training', href: '/training?view=me', icon: 'graduation' },
  ];

  return (
    <Card>
      <CardHeader title="Quick actions" />
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {links.map(l => (
          <Link key={l.href} href={l.href} className="flex items-center gap-2.5 h-11 px-3 rounded-control border border-rule text-sm font-semibold text-ink hover:bg-page">
            <Icon name={l.icon} size={17} className="text-accent" />{l.label}
          </Link>
        ))}
      </div>
    </Card>
  );
}

// ── Main Dashboard ─────────────────────────────────────────────────────────────
export default function EmployeeDashboard() {
  const { user } = useAuth();
  const firstName = user?.name?.split(' ')[0] ?? 'there';
  const employeeId = user?.employeeId;

  if (!employeeId) {
    return (
      <EmptyState
        icon="user"
        title="Your account isn't linked to an employee profile yet"
        description="Ask your HR administrator to link your login to your employee record; your leave, attendance and payslips appear here once that is done."
        className="py-20"
      />
    );
  }

  return (
    <div className="flex flex-col gap-5 pb-8">
      <PageHeader title={`${greeting()}, ${firstName}`} subtitle={todayLabel()} />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 flex flex-col gap-4 min-w-0">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <LeaveCard employeeId={employeeId} />
            <LeaveRequestsCard employeeId={employeeId} />
          </div>
          <QuickLinksCard employeeId={employeeId} />
        </div>
        <div className="flex flex-col gap-4 min-w-0">
          <AttendanceCard employeeId={employeeId} />
        </div>
      </div>
    </div>
  );
}
