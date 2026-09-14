'use client';

import { Badge, Card, CardHeader, Icon } from '@/components/ui';
import { SectionHeader } from '../_components/SectionHeader';

export default function OverridesPage() {
  return (
    <>
      <SectionHeader
        title="System overrides"
        description="Emergency controls that bypass normal payroll safeguards."
        actions={<Badge tone="danger">Super Admin only</Badge>}
      />
      <Card>
        <CardHeader title="Emergency controls" caption="Use only to recover from a stuck or erroneous run." />
        <div className="flex items-start gap-3 rounded-control border border-rule bg-page px-4 py-3">
          <Icon name="alert" size={18} className="mt-0.5 text-danger" />
          <p className="text-sm text-ink">
            Emergency controls for overriding forced payroll blocks, resetting clearance checkpoints, or rolling back erroneous GIRO executions.
          </p>
        </div>
      </Card>
    </>
  );
}
