'use client';

import React from 'react';

export default function CelebrationsCard() {
  return (
    <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200 p-8 transition-all hover:shadow-md h-full group relative overflow-hidden">
      <div className="absolute top-0 left-0 w-1.5 h-full bg-indigo-600"></div>
      <h3 className="text-[11px] font-black text-slate-900 uppercase tracking-[0.2em] mb-10">Personnel Milestones</h3>
      <div className="flex flex-col items-center justify-center py-12">
        <span className="text-5xl mb-6 grayscale group-hover:grayscale-0 transition-all duration-700">🎉</span>
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">No Active Celebrations</p>
        <p className="text-[9px] text-slate-300 mt-2 uppercase tracking-tighter">System signal: Nominal</p>
      </div>
    </div>
  );
}
