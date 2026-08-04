'use client';

import React from 'react';

export default function LeavesCard() {
  const leaves = [
    { type: 'Annual', available: '13.5', total: '21', icon: '📅', color: 'bg-page', iconColor: 'text-accent', border: 'border-accent' },
    { type: 'Medical', available: '2.0', total: '14', icon: '🏥', color: 'bg-page', iconColor: 'text-muted', border: 'border-rule' },
  ];

  return (
    <div className="bg-paper border border-rule p-8 h-full transition-all hover: group">
      <h3 className="text-[11px] font-black text-ink uppercase tracking-[0.2em] mb-10 flex items-center gap-3">
        Functional Signal: Leave Activity
      </h3>
      <div className="flex gap-6">
        {leaves.map((l) => (
          <div key={l.type} className={`${l.color} flex-1  p-6 border ${l.border} transition-all hover:scale-[1.02]`}>
            <div className="flex justify-between items-start mb-4">
              <span className="text-[10px] font-black text-accent uppercase tracking-widest leading-none">{l.type} Sector</span>
              <span className="text-xl grayscale group-hover:grayscale-0 transition-all">{l.icon}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-4xl font-black text-ink leading-none tracking-tighter">{l.available}</span>
              <span className="text-[9px] font-black text-muted mt-4 uppercase tracking-[0.2em]">Net Units Available</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
