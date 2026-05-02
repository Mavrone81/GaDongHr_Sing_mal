'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';

const ALLOWED_ROLES = ['SUPER_ADMIN', 'HR_ADMIN', 'HR_MANAGER', 'PAYROLL_OFFICER'];

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  const c = document.cookie.split('; ').find(r => r.startsWith('vorkhive_token='));
  return c ? c.split('=').slice(1).join('=') : null;
}
function apiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? `http://${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:4000/api`;
}
async function apiFetch(path: string) {
  const token = getToken();
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${apiBase()}${path}`, { headers: h });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

interface AttRecord {
  id: string;
  employeeId: string;
  date: string;
  clockIn: string | null;
  clockOut: string | null;
  hoursWorked: number | null;
  otHours: number;
  status: string;
}

interface EmployeeInfo {
  id: string;
  fullName: string;
  department: string;
  designation: string;
  employeeCode: string;
}

interface RosterRow {
  employeeId: string;
  name: string;
  dept: string;
  designation: string;
  clockIn: string | null;
  clockOut: string | null;
  hoursWorked: number | null;
  otHours: number;
  status: string;
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function getRowStatus(r: AttRecord): 'On Time' | 'Late' | 'Clocked Out' | 'Absent' {
  if (!r.clockIn) return 'Absent';
  const clockIn = new Date(r.clockIn);
  const cutoff = new Date(clockIn);
  cutoff.setHours(9, 15, 0, 0);
  if (r.clockOut) return 'Clocked Out';
  if (clockIn > cutoff) return 'Late';
  return 'On Time';
}

function getInitials(name: string) {
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
}

export default function AttendanceRegistryPage() {
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
    router.replace('/attendance');
    return null;
  }

  return <AdminAttendanceView />;
}

function AdminAttendanceView() {
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [liveTime, setLiveTime] = useState(new Date());
  const [search, setSearch] = useState('');

  useEffect(() => {
    const t = setInterval(() => setLiveTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const loadData = useCallback(async (date: string) => {
    setLoading(true);
    try {
      const [empData, attData] = await Promise.allSettled([
        apiFetch('/employees?limit=500&isActive=true'),
        apiFetch(`/attendance/admin/records?date=${date}`),
      ]);

      const employees: EmployeeInfo[] = empData.status === 'fulfilled'
        ? (empData.value.employees ?? [])
        : [];
      const records: AttRecord[] = attData.status === 'fulfilled'
        ? (attData.value.records ?? [])
        : [];

      const empMap = new Map(employees.map(e => [e.id, e]));
      const recMap = new Map(records.map(r => [r.employeeId, r]));

      const rows: RosterRow[] = employees.map(emp => {
        const rec = recMap.get(emp.id);
        return {
          employeeId: emp.id,
          name: emp.fullName,
          dept: emp.department,
          designation: emp.designation,
          clockIn: rec?.clockIn ?? null,
          clockOut: rec?.clockOut ?? null,
          hoursWorked: rec?.hoursWorked ?? null,
          otHours: rec?.otHours ?? 0,
          status: rec ? getRowStatus(rec) : 'Absent',
        };
      });

      rows.sort((a, b) => {
        const order = ['On Time', 'Late', 'Clocked Out', 'Absent'];
        return order.indexOf(a.status) - order.indexOf(b.status);
      });

      setRoster(rows);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(selectedDate); }, [selectedDate, loadData]);

  const filtered = roster.filter(r => {
    const q = search.toLowerCase();
    return !q || r.name.toLowerCase().includes(q) || r.dept?.toLowerCase().includes(q);
  });

  const clockedIn   = roster.filter(r => r.clockIn && !r.clockOut).length;
  const late        = roster.filter(r => r.status === 'Late').length;
  const clockedOut  = roster.filter(r => r.status === 'Clocked Out').length;
  const absent      = roster.filter(r => r.status === 'Absent').length;

  const statusData = [
    { label: 'Clocked In', count: clockedIn,  color: 'text-emerald-600', dot: 'bg-emerald-500' },
    { label: 'Clocked Out', count: clockedOut, color: 'text-blue-600',   dot: 'bg-blue-500'    },
    { label: 'Late',        count: late,        color: 'text-amber-600',   dot: 'bg-amber-500'   },
    { label: 'Absent',      count: absent,      color: 'text-red-600',     dot: 'bg-red-500'     },
  ];

  const timeStr = liveTime.toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });

  return (
    <div className="flex flex-col gap-8 max-w-[1600px] mx-auto pb-12 animate-in fade-in duration-700">

      <div className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-xl shadow-indigo-500/5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
            <span className="text-[10px] font-black text-emerald-600 uppercase tracking-[0.4em]">Live Monitoring</span>
          </div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tighter">Attendance <span className="text-indigo-600">Registry</span></h1>
          <p className="text-sm font-bold text-slate-400 mt-1 uppercase tracking-widest">{timeStr} · {roster.length} personnel tracked</p>
        </div>
        <div className="flex flex-wrap gap-3 items-center">
          <input
            type="date"
            value={selectedDate}
            max={new Date().toISOString().slice(0, 10)}
            onChange={e => setSelectedDate(e.target.value)}
            className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-900 outline-none focus:border-indigo-500 transition-all"
          />
          <button
            onClick={() => loadData(selectedDate)}
            className="px-5 py-2.5 bg-white border border-slate-200 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-500 hover:bg-slate-50 transition-all"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
        {statusData.map(s => (
          <div key={s.label} className="bg-white p-7 rounded-[1.5rem] border border-slate-100 shadow-lg shadow-indigo-500/5">
            <div className="flex items-center gap-2 mb-4">
              <div className={`w-2 h-2 rounded-full ${s.dot}`} />
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{s.label}</p>
            </div>
            <p className={`text-4xl font-black tracking-tighter ${s.color}`}>{loading ? '—' : s.count}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-[2rem] border border-slate-100 shadow-xl shadow-indigo-500/5 overflow-hidden">
        <div className="px-8 py-6 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="flex items-center gap-4">
            <div className="w-2 h-8 bg-indigo-600 rounded-full" />
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">Daily Roster</h3>
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{filtered.length} records</span>
          </div>
          <div className="relative">
            <input
              type="text"
              placeholder="Filter by name or department…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full sm:w-64 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-900 placeholder:text-slate-300 outline-none focus:border-indigo-500 transition-all"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="text-[10px] text-slate-400 font-black uppercase tracking-[0.2em] border-b border-slate-100 bg-slate-50/30">
              <tr>
                <th className="px-8 py-5">Employee</th>
                <th className="px-8 py-5">Department</th>
                <th className="px-8 py-5">Clock In</th>
                <th className="px-8 py-5">Clock Out</th>
                <th className="px-8 py-5">Hours</th>
                <th className="px-8 py-5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td colSpan={6} className="px-8 py-5"><div className="h-8 bg-slate-100 rounded-xl w-full" /></td>
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-8 py-16 text-center">
                    <p className="text-sm font-black text-slate-300 uppercase tracking-widest">No records found</p>
                  </td>
                </tr>
              ) : filtered.map(row => (
                <tr key={row.employeeId} className="hover:bg-slate-50/50 transition-all">
                  <td className="px-8 py-5">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-slate-900 rounded-xl flex items-center justify-center text-[10px] font-black text-indigo-400 shrink-0">
                        {getInitials(row.name)}
                      </div>
                      <div>
                        <p className="text-sm font-black text-slate-900 uppercase tracking-tight">{row.name}</p>
                        <p className="text-[9px] font-bold text-slate-400 uppercase mt-0.5">{row.designation || '—'}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-8 py-5 text-[11px] font-bold text-slate-500 uppercase tracking-widest">{row.dept || '—'}</td>
                  <td className="px-8 py-5 text-xs font-black text-slate-900 tabular-nums">{fmtTime(row.clockIn)}</td>
                  <td className="px-8 py-5 text-xs font-black text-slate-500 tabular-nums">{fmtTime(row.clockOut)}</td>
                  <td className="px-8 py-5 text-xs font-black text-slate-600 tabular-nums">
                    {row.hoursWorked != null ? `${row.hoursWorked.toFixed(1)}h` : '—'}
                    {row.otHours > 0 && <span className="ml-1.5 text-[9px] font-black text-amber-600 uppercase">+{row.otHours.toFixed(1)}OT</span>}
                  </td>
                  <td className="px-8 py-5">
                    <span className={`text-[9px] font-black uppercase px-3 py-1 rounded-lg border tracking-widest ${
                      row.status === 'On Time'    ? 'bg-emerald-50 text-emerald-600 border-emerald-100' :
                      row.status === 'Clocked Out' ? 'bg-blue-50 text-blue-600 border-blue-100' :
                      row.status === 'Late'        ? 'bg-amber-50 text-amber-600 border-amber-100' :
                                                     'bg-red-50 text-red-600 border-red-100'
                    }`}>
                      {row.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
