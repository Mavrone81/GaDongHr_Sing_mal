'use client';

import React, { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

const READINESS_LABEL: Record<string, string> = {
  READY_NOW: 'Ready Now',
  ONE_YEAR:  '1 Year',
  TWO_YEARS: '2 Years',
};
const READINESS_COLOR: Record<string, string> = {
  READY_NOW: 'bg-emerald-900/40 text-emerald-300 border border-emerald-700',
  ONE_YEAR:  'bg-amber-900/40 text-amber-300 border border-amber-700',
  TWO_YEARS: 'bg-slate-700 text-slate-300 border border-slate-600',
};

function empName(e?: { firstName: string; lastName: string } | null) {
  return e ? `${e.firstName} ${e.lastName}` : '—';
}

export default function MyTeamSuccessionPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/api/performance/succession/my-team').then(setData).finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Team Succession</h1>
        <p className="text-sm text-slate-400 mt-1">View which team members are nominated as key-position successors</p>
      </div>

      {loading ? (
        <p className="text-slate-400 text-sm">Loading…</p>
      ) : !data || data.teamMembers.length === 0 ? (
        <div className="text-center py-16 text-slate-500">
          <p className="text-4xl mb-3">◈</p>
          <p className="text-sm">None of your direct reports are currently nominated as successors.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {data.teamMembers.map((member: any) => (
            <div key={member.employeeId} className="bg-slate-800 border border-slate-700 rounded-xl p-4">
              <div className="mb-3">
                <p className="text-sm font-semibold text-white">{empName(member._employee)}</p>
                <p className="text-xs text-slate-400">{member.employeeId}</p>
              </div>
              <div className="space-y-2">
                {member.nominations.map((nom: any) => (
                  <div key={nom.nomineeId} className="flex flex-wrap items-center gap-2 bg-slate-700/50 rounded-lg px-3 py-2">
                    <p className="text-sm text-slate-200 flex-1 min-w-0">{nom.jobTitle}</p>
                    {nom.department && <p className="text-xs text-slate-400">{nom.department}</p>}
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${READINESS_COLOR[nom.readiness]}`}>
                      {READINESS_LABEL[nom.readiness]}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
