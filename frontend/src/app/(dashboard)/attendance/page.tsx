'use client';

import React from 'react';
import { useAuth } from '@/context/AuthContext';

export default function AttendancePage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN' || user?.role === 'HR_ADMIN';

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
        <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center text-red-500 mb-4 font-black">!</div>
        <h2 className="text-xl font-black text-gray-900 uppercase tracking-widest">Unauthorized Access</h2>
        <p className="text-gray-500 mt-2 max-w-sm font-bold text-sm">Attendance auditing is restricted to administrative personnel and department managers.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 max-w-[1600px] mx-auto pb-12">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-black text-gray-900 tracking-tight">Organization Attendance Registry</h1>
          <p className="text-sm font-bold text-gray-400 mt-1 uppercase tracking-widest">Live Monitoring of Personnel Clock-In & Location Data</p>
        </div>
        <div className="flex gap-3">
          <button className="px-5 py-2 bg-white border border-gray-200 rounded-lg text-xs font-black uppercase tracking-widest text-gray-500 hover:bg-gray-50 shadow-sm transition-all">
            Configuration
          </button>
          <button className="px-5 py-2 bg-[#00A884] rounded-lg text-xs font-black uppercase tracking-widest text-white hover:bg-[#008F6D] shadow-sm transition-all">
            Export Logs
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-8">
        {/* Real-time Status Card */}
        <div className="xl:col-span-1 flex flex-col gap-4">
          <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
            <h3 className="text-[11px] font-black text-gray-400 uppercase tracking-widest mb-6">Current Status (09:42 AM)</h3>
            <div className="space-y-6">
              {[
                { label: 'Clocked In', count: 142, color: 'text-[#00A884]', bgColor: 'bg-[#E6F7F4]' },
                { label: 'On Leave', count: 12, color: 'text-blue-600', bgColor: 'bg-blue-50' },
                { label: 'Tardy', count: 5, color: 'text-orange-600', bgColor: 'bg-orange-50' },
                { label: 'Absent', count: 2, color: 'text-red-600', bgColor: 'bg-red-50' },
              ].map((stat) => (
                <div key={stat.label} className="flex justify-between items-center group">
                  <span className="text-xs font-bold text-gray-500">{stat.label}</span>
                  <div className={`px-3 py-1 ${stat.bgColor} ${stat.color} rounded-lg font-black text-sm tabular-nums`}>
                    {stat.count}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Live Attendance Stream */}
        <div className="xl:col-span-3">
          <section className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-8 py-5 border-b border-gray-50 flex justify-between items-center">
              <h3 className="font-black text-gray-800 uppercase tracking-tight">Personnel Entry/Exit Stream</h3>
              <div className="flex gap-2">
                <span className="flex items-center gap-2 bg-green-50 px-3 py-1 rounded-full border border-green-100">
                   <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-ping"></span>
                   <span className="text-[10px] font-black text-green-700 uppercase tracking-widest">Live Syncing</span>
                </span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#FBFBFC] text-gray-400 text-[10px] uppercase font-black tracking-widest border-b border-gray-100">
                    <th className="px-8 py-5">Staff Member</th>
                    <th className="px-5 py-5">Action</th>
                    <th className="px-5 py-5 text-center">Timestamp</th>
                    <th className="px-5 py-5">Method</th>
                    <th className="px-8 py-5 text-right">Location Data</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {[
                    { name: 'Sarah Chen', action: 'CLOCK-IN', time: '08:55:12', method: 'Mobile App', location: '128.52.1.9 (Headquarters)', status: 'On-Time' },
                    { name: 'John Doe', action: 'CLOCK-IN', time: '09:05:44', method: 'Web Terminal', location: '202.41.0.4 (Remote)', status: 'LATE' },
                    { name: 'Marcus Tan', action: 'CLOCK-OUT', time: '18:02:11', method: 'Biometric', location: 'Gate A (HQ)', status: 'Normal' },
                  ].map((log, i) => (
                    <tr key={i} className="group hover:bg-gray-50 transition-colors">
                      <td className="px-8 py-5">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-brand-50 border border-brand-100 flex items-center justify-center text-[10px] font-black text-brand-600 italic">
                            {log.name.substring(0,2).toUpperCase()}
                          </div>
                          <span className="text-sm font-black text-gray-900">{log.name}</span>
                        </div>
                      </td>
                      <td className="px-5 py-5">
                        <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded ${
                          log.action === 'CLOCK-IN' ? 'bg-[#E6F7F4] text-[#00A884]' : 'bg-gray-100 text-gray-500'
                        }`}>
                          {log.action}
                        </span>
                      </td>
                      <td className="px-5 py-5 text-center text-xs font-bold text-gray-500 tabular-nums">{log.time}</td>
                      <td className="px-5 py-5 text-xs font-medium text-gray-400 uppercase tracking-tight">{log.method}</td>
                      <td className="px-8 py-5 text-right">
                        <span className="text-[11px] font-bold text-blue-600 bg-blue-50/50 px-2 py-1 rounded cursor-pointer hover:bg-blue-100 transition-colors">
                          {log.location}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="p-6 bg-gray-50 border-t border-gray-100 text-center">
                <button className="text-[11px] font-black text-[#00A884] uppercase tracking-widest hover:underline">View 532 historical records →</button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
