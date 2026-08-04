'use client';

import React, { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

const READINESS_LABEL: Record<string, string> = {
  READY_NOW: 'Ready Now',
  ONE_YEAR:  '1 Year',
  TWO_YEARS: '2 Years',
};
const READINESS_COLOR: Record<string, string> = {
  READY_NOW: 'bg-accent text-accent border border-accent',
  ONE_YEAR:  'bg-highlight text-highlight border border-highlight',
  TWO_YEARS: 'bg-muted text-muted border border-rule',
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
        <h1 className="text-2xl font-bold text-paper">Team Succession</h1>
        <p className="text-sm text-muted mt-1">View which team members are nominated as key-position successors</p>
      </div>

      {loading ? (
        <p className="text-muted text-sm">Loading…</p>
      ) : !data || data.teamMembers.length === 0 ? (
        <div className="text-center py-16 text-muted">
          <p className="text-4xl mb-3">◈</p>
          <p className="text-sm">None of your direct reports are currently nominated as successors.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {data.teamMembers.map((member: any) => (
            <div key={member.employeeId} className="bg-shadow border border-shadow p-4">
              <div className="mb-3">
                <p className="text-sm font-semibold text-paper">{empName(member._employee)}</p>
                <p className="text-xs text-muted">{member.employeeId}</p>
              </div>
              <div className="space-y-2">
                {member.nominations.map((nom: any) => (
                  <div key={nom.nomineeId} className="flex flex-wrap items-center gap-2 bg-muted px-3 py-2">
                    <p className="text-sm text-paper flex-1 min-w-0">{nom.jobTitle}</p>
                    {nom.department && <p className="text-xs text-muted">{nom.department}</p>}
                    <span className={`text-xs font-medium px-2 py-0.5  ${READINESS_COLOR[nom.readiness]}`}>
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
