'use client';

import React from 'react';

export default function TimesheetCard() {
  const tableData: any[] = [];

  return (
    <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200 p-10 transition-all hover:shadow-md h-full flex flex-col group relative overflow-hidden">
      <div className="absolute top-0 right-0 p-4 bg-slate-900 rounded-bl-2xl flex items-center gap-2">
         <span className="text-[9px] font-black text-white uppercase tracking-widest leading-none">Week 16</span>
      </div>
      <h3 className="text-[11px] font-black text-slate-900 uppercase tracking-[0.2em] mb-12">Operational Personnel Timesheet</h3>
      <div className="overflow-x-auto flex-1">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="text-[9px] font-black text-slate-400 uppercase tracking-[0.25em] border-b border-slate-100">
              <th className="pb-6 pr-6">Operational Day</th>
              <th className="pb-6 pr-6">Temporal Sync</th>
              <th className="pb-6 pr-6 text-center">In Bound</th>
              <th className="pb-6 pr-6 text-center">Out Bound</th>
              <th className="pb-6 text-right">Audit Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {tableData.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-24 text-center">
                   <div className="flex flex-col items-center gap-5">
                      <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center text-slate-300 text-2xl font-bold italic border border-slate-100 group-hover:bg-white transition-all transform group-hover:rotate-12">!</div>
                      <div className="flex flex-col gap-2">
                        <p className="text-[11px] font-black text-slate-950 uppercase tracking-[0.2em] leading-relaxed">
                          No active attendance records detected
                        </p>
                        <p className="text-[9px] font-black text-indigo-500 uppercase tracking-widest whitespace-nowrap">Awaiting biometric signal from terminal alpha</p>
                      </div>
                   </div>
                </td>
              </tr>
            ) : (
              tableData.map((row, i) => (
                <tr key={i} className="hover:bg-slate-50/50 transition-all">
                  {/* Mapping data */}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
