'use client';

import React from 'react';

export default function AnnouncementCard() {
  const announcements = [
    {
      title: 'SYSTEM MEMO',
      content: 'Digital workforce hub activated.\n1. Sector auditing in progress.\n2. Biometric validation required for all logic units.\n3. Verify NRIC/Passport sync status.',
      type: 'Welcome',
      color: 'text-indigo-600',
      bgColor: 'bg-indigo-50/50',
      border: 'border-indigo-100'
    },
    {
      title: 'PDPA COMPLIANCE',
      content: 'Statutory verification cycle: PDPA frameworks integrated. Ensure data residency compliance at all terminals.',
      type: 'PDPA',
      color: 'text-slate-900',
      bgColor: 'bg-slate-50/50',
      border: 'border-slate-100'
    },
  ];

  return (
    <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200 p-8 transition-all hover:shadow-md h-full flex flex-col group relative overflow-hidden">
       <div className="absolute top-0 left-0 w-1.5 h-full bg-slate-900"></div>
       <h3 className="text-[11px] font-black text-slate-900 uppercase tracking-[0.2em] mb-10">Internal Communiqués</h3>
      <div className="space-y-6 flex-1">
        {announcements.map((ann, i) => (
          <div key={i} className={`p-6 rounded-2xl ${ann.bgColor} border ${ann.border} relative overflow-hidden group/item cursor-default hover:border-slate-300 transition-all`}>
            <h4 className={`text-[10px] font-black ${ann.color} mb-4 tracking-[0.15em] uppercase`}>{ann.title}</h4>
            <p className="text-[11px] text-slate-600 leading-relaxed font-bold whitespace-pre-line opacity-80 group-hover/item:opacity-100 transition-opacity">
              {ann.content}
            </p>
          </div>
        ))}
      </div>
      <div className="mt-10 pt-8 border-t border-slate-100 flex justify-center">
        <button className="text-[10px] font-black text-indigo-600 uppercase tracking-[0.3em] hover:text-indigo-800 transition-all active:scale-95">
          Archive History
        </button>
      </div>
    </div>
  );
}
