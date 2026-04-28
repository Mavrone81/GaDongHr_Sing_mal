'use client';

import React from 'react';

export default function ClaimsCard() {
  const categories = [
    { title: 'Approved', amount: '0', icon: '✅', color: 'bg-emerald-50/50', iconColor: 'text-emerald-600', border: 'border-emerald-100' },
    { title: 'Pending', amount: '0', icon: '🕒', color: 'bg-amber-50/50', iconColor: 'text-amber-500', border: 'border-amber-100' },
  ];

  return (
    <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200 p-8 h-full transition-all hover:shadow-md group">
      <h3 className="text-[11px] font-black text-slate-900 uppercase tracking-[0.2em] mb-10 flex items-center gap-3">
        Financial Signal: Settlement
      </h3>
      <div className="flex gap-6">
        {categories.map((c) => (
          <div key={c.title} className={`${c.color} flex-1 rounded-2xl p-6 border ${c.border} transition-all hover:scale-[1.02]`}>
            <div className="flex justify-between items-start mb-4">
              <span className="text-[10px] font-black text-slate-700 uppercase tracking-widest leading-none">{c.title} Nexus</span>
              <span className="text-xl grayscale group-hover:grayscale-0 transition-all">{c.icon}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-4xl font-black text-slate-900 leading-none tracking-tighter">${c.amount}</span>
              <span className="text-[9px] font-black text-slate-400 mt-4 uppercase tracking-[0.2em]">MTD Settlement Value</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
