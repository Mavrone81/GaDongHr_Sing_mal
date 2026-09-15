'use client';

import { useEffect, useState } from 'react';
import { Badge, DataTable, EmptyState, PageHeader, type Column } from '@/components/ui';
import { usePlatformApi, type ModuleDef } from '../../_lib/api';

// The module catalogue is read-only here; per-company switches live on each company page.
export default function ModulesPage() {
  const api = usePlatformApi();
  const [modules, setModules] = useState<ModuleDef[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api('/modules').then((d) => setModules(d.modules || [])).catch(() => {}).finally(() => setLoaded(true));
  }, [api]);

  const columns: Column<ModuleDef>[] = [
    { key: 'code', label: 'Code', width: '200px', render: (m) => <span className="font-mono text-[13px] text-muted">{m.code}</span> },
    { key: 'name', label: 'Module', width: 'minmax(200px, 1fr)', render: (m) => <span className="font-semibold text-ink">{m.name}</span> },
    { key: 'kind', label: 'Type', width: '120px', render: (m) => (m.isCore ? <Badge tone="accent">Core</Badge> : <Badge tone="neutral">Optional</Badge>) },
  ];
  const core = modules.filter((m) => m.isCore).length;

  return (
    <>
      <PageHeader title="Modules" subtitle={loaded ? `${modules.length} in the catalogue · ${core} core, always on · ${modules.length - core} optional, switched per company` : 'Loading…'} />
      <DataTable
        aria-label="Modules"
        columns={columns}
        rows={modules}
        rowKey={(m) => m.code}
        mobileCard={(m) => (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0"><div className="font-semibold text-ink">{m.name}</div><div className="font-mono text-xs text-muted">{m.code}</div></div>
            {m.isCore ? <Badge tone="accent">Core</Badge> : <Badge tone="neutral">Optional</Badge>}
          </div>
        )}
        rowHeight={48}
        footer={<span>Switch optional modules on a company's page.</span>}
        empty={loaded ? <EmptyState icon="grid" title="No modules returned" description="The module catalogue endpoint returned nothing." /> : 'Loading…'}
      />
    </>
  );
}
