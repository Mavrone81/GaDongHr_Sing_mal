'use client';

import React from 'react';

export default function LeavesCard() {
  const leaves = [
    { type: 'Annual', available: '13.5', total: '21', icon: '📅', color: 'bg-indigo-50/50', iconColor: 'text-indigo-600', border: 'border-indigo-100' },
    { type: 'Medical', available: '2.0', total: '14', icon: '🏥', color: 'bg-slate-50/50', iconColor: 'text-slate-500', border: 'border-slate-100' },
  ];

  return (
    <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200 p-8 h-full transition-all hover:shadow-md group">
      <h3 className="text-[11px] font-black text-slate-900 uppercase tracking-[0.2em] mb-10 flex items-center gap-3">
        Functional Signal: Leave Activity
      </h3>
      <div className="flex gap-6">
        {leaves.map((l) => (
          <div key={l.type} className={`${l.color} flex-1 rounded-2xl p-6 border ${l.border} transition-all hover:scale-[1.02]`}>
            <div className="flex justify-between items-start mb-4">
              <span className="text-[10px] font-black text-indigo-900 uppercase tracking-widest leading-none">{l.type} Sector</span>
              <span className="text-xl grayscale group-hover:grayscale-0 transition-all">{l.icon}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-4xl font-black text-slate-900 leading-none tracking-tighter">{l.available}</span>
              <span className="text-[9px] font-black text-slate-400 mt-4 uppercase tracking-[0.2em]">Net Units Available</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
