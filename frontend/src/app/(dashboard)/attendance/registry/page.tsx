'use client';

import React, { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';

const ALLOWED_ROLES = ['SUPER_ADMIN', 'HR_ADMIN', 'HR_MANAGER', 'PAYROLL_OFFICER'];

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
  const [now] = useState(new Date());
  const timeStr = now.toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', hour12: true });

  const statusData = [
    { label: 'Clocked In', count: 142, color: 'text-emerald-600', dot: 'bg-emerald-500' },
    { label: 'On Leave',   count: 12,  color: 'text-blue-600',    dot: 'bg-blue-500'    },
    { label: 'Late',       count: 5,   color: 'text-amber-600',   dot: 'bg-amber-500'   },
    { label: 'Absent',     count: 2,   color: 'text-red-600',     dot: 'bg-red-500'     },
  ];

  const liveRoster = [
    { name: 'Sarah Chen',  dept: 'Engineering',     clockIn: '08:52 AM', status: 'On Time', wfh: false },
    { name: 'Marcus Tan',  dept: 'Operations',      clockIn: '09:18 AM', status: 'Late',    wfh: false },
    { name: 'Linda Low',   dept: 'Human Resources', clockIn: '08:59 AM', status: 'On Time', wfh: true  },
    { name: 'James Koh',   dept: 'Finance',         clockIn: '09:01 AM', status: 'On Time', wfh: false },
    { name: 'Priya Nair',  dept: 'Marketing',       clockIn: '—',        status: 'Absent',  wfh: false },
  ];

  return (
    <div className="flex flex-col gap-8 max-w-[1600px] mx-auto pb-12 animate-in fade-in duration-700">

      <div className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-xl shadow-indigo-500/5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
            <span className="text-[10px] font-black text-emerald-600 uppercase tracking-[0.4em]">Live Monitoring</span>
          </div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tighter">Attendance <span className="text-indigo-600">Registry</span></h1>
          <p className="text-sm font-bold text-slate-400 mt-1 uppercase tracking-widest">As of {timeStr} · All departments</p>
        </div>
        <div className="flex gap-3">
          <button className="px-5 py-2.5 bg-white border border-slate-200 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-500 hover:bg-slate-50 transition-all">
            Configure Rules
          </button>
          <button className="px-5 py-2.5 bg-indigo-600 rounded-xl text-[10px] font-black uppercase tracking-widest text-white hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-500/20">
            Export Logs
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
            <p className={`text-4xl font-black tracking-tighter ${s.color}`}>{s.count}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-[2rem] border border-slate-100 shadow-xl shadow-indigo-500/5 overflow-hidden">
        <div className="px-8 py-6 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <div className="w-2 h-8 bg-indigo-600 rounded-full" />
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">Live Roster</h3>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
            <span className="text-[9px] font-black text-emerald-600 uppercase tracking-widest">Real-time</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="text-[10px] text-slate-400 font-black uppercase tracking-[0.2em] border-b border-slate-100 bg-slate-50/30">
              <tr>
                <th className="px-8 py-5">Employee</th>
                <th className="px-8 py-5">Department</th>
                <th className="px-8 py-5">Clock In</th>
                <th className="px-8 py-5">Mode</th>
                <th className="px-8 py-5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {liveRoster.map((emp, i) => (
                <tr key={i} className="hover:bg-slate-50/50 transition-all">
                  <td className="px-8 py-5">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-slate-900 rounded-xl flex items-center justify-center text-[10px] font-black text-white shrink-0">
                        {emp.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                      </div>
                      <span className="text-sm font-black text-slate-900 uppercase tracking-tight">{emp.name}</span>
                    </div>
                  </td>
                  <td className="px-8 py-5 text-[11px] font-bold text-slate-500 uppercase tracking-widest">{emp.dept}</td>
                  <td className="px-8 py-5 text-xs font-black text-slate-900 tabular-nums">{emp.clockIn}</td>
                  <td className="px-8 py-5">
                    <span className={`text-[9px] font-black uppercase px-3 py-1 rounded-lg border tracking-widest ${
                      emp.wfh ? 'bg-purple-50 text-purple-600 border-purple-100' : 'bg-slate-50 text-slate-500 border-slate-200'
                    }`}>
                      {emp.wfh ? 'WFH' : 'Office'}
                    </span>
                  </td>
                  <td className="px-8 py-5">
                    <span className={`text-[9px] font-black uppercase px-3 py-1 rounded-lg border tracking-widest ${
                      emp.status === 'On Time' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' :
                      emp.status === 'Late'    ? 'bg-amber-50 text-amber-600 border-amber-100' :
                                                 'bg-red-50 text-red-600 border-red-100'
                    }`}>
                      {emp.status}
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
