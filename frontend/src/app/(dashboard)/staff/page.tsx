'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { Badge, Button, Card, EmptyState, Icon, PageHeader, SearchInput, Select } from '@/components/ui';
import { PersonAvatar } from '@/components/employee/RecordParts';

interface Employee {
  id: string;
  employeeCode: string;
  fullName: string;
  department: string;
  designation: string;
  employmentType: string;
  isActive: boolean;
  email?: string;
  workPhone?: string;
  workEmail?: string;
  profilePhotoUrl?: string | null;
}

export default function StaffDirectoryPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');

  useEffect(() => {
    apiFetch('/employees?limit=200&isActive=true')
      .then(data => setEmployees(data.employees ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const departments = useMemo(() => {
    const s = new Set(employees.map(e => e.department).filter(Boolean));
    return Array.from(s).sort();
  }, [employees]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return employees.filter(e => {
      const matchSearch = !q ||
        e.fullName.toLowerCase().includes(q) ||
        e.department?.toLowerCase().includes(q) ||
        e.designation?.toLowerCase().includes(q) ||
        e.employeeCode?.toLowerCase().includes(q);
      const matchDept = !deptFilter || e.department === deptFilter;
      return matchSearch && matchDept;
    });
  }, [employees, search, deptFilter]);

  const byDept = useMemo(() => {
    const m: Record<string, number> = {};
    employees.forEach(e => { if (e.department) m[e.department] = (m[e.department] ?? 0) + 1; });
    return m;
  }, [employees]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Staff directory"
        subtitle={loading ? 'Loading…' : `${filtered.length} of ${employees.length} active people`}
      />

      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchInput
          className="w-full sm:w-80"
          placeholder="Search name, role, department, ID…"
          aria-label="Search the directory"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <Select
          className="sm:w-56"
          aria-label="Department"
          value={deptFilter}
          onChange={e => setDeptFilter(e.target.value)}
        >
          <option value="">All departments</option>
          {departments.map(d => <option key={d} value={d}>{d} ({byDept[d] ?? 0})</option>)}
        </Select>
        {(search || deptFilter) && (
          <Button variant="ghost" icon="x" onClick={() => { setSearch(''); setDeptFilter(''); }}>Clear filters</Button>
        )}
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-hidden>
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i} className="animate-pulse gap-4">
              <div className="flex items-center gap-3">
                <div className="h-11 w-11 rounded-full bg-pill" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-3/4 rounded bg-pill" />
                  <div className="h-3 w-1/2 rounded bg-pill" />
                </div>
              </div>
              <div className="h-3 w-2/3 rounded bg-pill" />
            </Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card padding="p-0">
          <EmptyState
            icon="users"
            title={employees.length === 0 ? 'No one in the directory yet' : 'No one matches your filters'}
            description={employees.length === 0 ? 'Active employees appear here once they are added.' : 'Try a different name or department.'}
            action={employees.length > 0 ? <Button variant="secondary" onClick={() => { setSearch(''); setDeptFilter(''); }}>Clear filters</Button> : undefined}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map(emp => (
            <Card key={emp.id} className="relative gap-3 transition-colors hover:border-accent focus-within:border-accent">
              <div className="flex items-center gap-3 min-w-0">
                <PersonAvatar name={emp.fullName} photoUrl={emp.profilePhotoUrl} size={44} />
                <div className="min-w-0">
                  {/* The name link covers the card, so the whole card opens the profile. */}
                  <Link
                    href={`/employees/${emp.id}`}
                    className="block truncate text-[15px] font-bold text-ink hover:text-accent focus:outline-none after:absolute after:inset-0 after:rounded-card focus-visible:after:ring-2 focus-visible:after:ring-accent"
                  >
                    {emp.fullName}
                  </Link>
                  <p className="truncate text-[13px] text-muted">{emp.designation || 'No job title'}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {emp.department && <Badge tone="accent">{emp.department}</Badge>}
                <Badge tone="neutral">{emp.employmentType?.replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase()) ?? '—'}</Badge>
              </div>
              <div className="flex flex-col gap-1 border-t border-rule pt-3 text-[13px]">
                <span className="text-muted tabular-nums">{emp.employeeCode}</span>
                {emp.workEmail && (
                  <a
                    href={`mailto:${emp.workEmail}`}
                    className="relative z-10 flex w-fit max-w-full items-center gap-1.5 truncate text-accent hover:underline"
                  >
                    <Icon name="mail" size={14} />
                    <span className="truncate">{emp.workEmail}</span>
                  </a>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
