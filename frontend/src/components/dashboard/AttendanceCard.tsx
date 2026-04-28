'use client';

import React from 'react';

export default function AttendanceCard() {
  return (
    <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200 p-10 transition-all hover:shadow-md relative overflow-hidden group">
      <div className="absolute top-0 right-0 p-4 bg-indigo-50/50 rounded-bl-2xl border-b border-l border-indigo-100 flex items-center gap-2">
         <span className="w-1.5 h-1.5 bg-slate-300 rounded-full"></span>
         <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none">Standby</span>
      </div>
      <h3 className="text-[11px] font-black text-slate-900 uppercase tracking-[0.2em] mb-10">Attendance Signal</h3>
      <div className="flex flex-col gap-8 relative z-10">
        <p className="text-xs font-bold text-slate-500 leading-relaxed">
          Operational protocol status: <span className="text-slate-400 font-black uppercase tracking-tight italic">Standby</span>. No active clock-in captured for the current enterprise session.
        </p>
        <button className="w-full py-5 bg-indigo-600 text-white text-[11px] font-black uppercase tracking-[0.3em] rounded-2xl hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-500/20 active:scale-95">
          Execute Clock-In
        </button>
      </div>
    </div>
  );
}
