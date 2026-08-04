'use client';

import React from 'react';

export default function AttendanceCard() {
  return (
    <div className="bg-paper border border-rule p-10 transition-all hover: relative overflow-hidden group">
      <div className="absolute top-0 right-0 p-4 bg-page border-b border-l border-accent flex items-center gap-2">
         <span className="w-1.5 h-1.5 bg-rule "></span>
         <span className="label-form leading-none">Standby</span>
      </div>
      <h3 className="text-[11px] font-black text-ink uppercase tracking-[0.2em] mb-10">Attendance Signal</h3>
      <div className="flex flex-col gap-8 relative z-10">
        <p className="text-xs font-bold text-muted leading-relaxed">
          Operational protocol status: <span className="text-muted font-black uppercase tracking-tight italic">Standby</span>. No active clock-in captured for the current enterprise session.
        </p>
        <button className="w-full py-5 bg-accent text-paper text-[11px] font-black uppercase tracking-[0.3em] hover:bg-accent transition-all active:scale-95">
          Execute Clock-In
        </button>
      </div>
    </div>
  );
}
