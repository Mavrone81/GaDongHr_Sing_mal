'use client';

import React, { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui';
import { PageLoading, PersonAvatar } from '@/components/employee/RecordParts';

const READINESS_LABEL: Record<string, string> = {
  READY_NOW: 'Ready now',
  ONE_YEAR:  'Ready in 1 year',
  TWO_YEARS: 'Ready in 2 years',
};
const READINESS_TONE: Record<string, 'ok' | 'accent' | 'neutral'> = {
  READY_NOW: 'ok',
  ONE_YEAR:  'accent',
  TWO_YEARS: 'neutral',
};

function empName(e?: { firstName: string; lastName: string } | null) {
  return e ? `${e.firstName} ${e.lastName}` : '—';
}

export default function MyTeamSuccessionPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/performance/succession/my-team').then(setData).finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex flex-col gap-5 max-w-4xl">
      <PageHeader
        title="Team succession"
        subtitle="Which of your direct reports are nominated as successors for key positions"
      />

      {loading ? (
        <PageLoading />
      ) : !data || data.teamMembers.length === 0 ? (
        <Card padding="p-0">
          <EmptyState
            icon="users"
            title="No nominations in your team"
            description="None of your direct reports are currently nominated as successors."
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {data.teamMembers.map((member: any) => (
            <Card key={member.employeeId}>
              <div className="mb-3 flex items-center gap-3">
                <PersonAvatar name={empName(member._employee)} size={36} />
                <div className="min-w-0">
                  <p className="text-[15px] font-bold text-ink">{empName(member._employee)}</p>
                  <p className="text-xs text-muted tabular-nums">{member.employeeId}</p>
                </div>
              </div>
              <div className="flex flex-col">
                {member.nominations.map((nom: any) => (
                  <div key={nom.nomineeId} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-rule py-2.5">
                    <p className="min-w-0 flex-1 text-sm font-semibold text-ink">{nom.jobTitle}</p>
                    {nom.department && <p className="text-[13px] text-muted">{nom.department}</p>}
                    <Badge tone={READINESS_TONE[nom.readiness] ?? 'neutral'}>{READINESS_LABEL[nom.readiness] ?? nom.readiness}</Badge>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
