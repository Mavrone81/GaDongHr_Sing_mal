'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';

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

function getInitials(name: string) {
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
}

/**
 * Six departments, six distinguishable treatments, three tokens.
 *
 * This was six hues (indigo, emerald, rose, purple, amber, sky). Mapped onto
 * the Official Record palette four of them became the same value, so most
 * departments stopped being distinguishable. Varying FILL as well as token
 * restores six distinct chips without inventing colours the system lacks.
 * The department name is printed in the chip regardless.
 */
const DEPT_COLORS: Record<string, string> = {
  Engineering:       'bg-accent text-paper border-accent',
  Finance:           'bg-paper text-accent border-accent',
  Marketing:         'bg-ink text-paper border-ink',
  'Human Resources': 'bg-paper text-ink border-ink',
  Operations:        'bg-highlight text-ink border-highlight',
  Sales:             'bg-paper text-ink border-highlight',
};
function deptColor(dept: string) {
  return DEPT_COLORS[dept] ?? 'bg-page text-ink border-rule';
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

  return (
    <div className="flex flex-col gap-8 max-w-[1400px] mx-auto pb-20 animate-in fade-in duration-700">

      {/* Header */}
      <div className="bg-paper p-10 border border-rule relative overflow-hidden group">
        <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
          <div className="w-32 h-32 bg-accent" />
        </div>
        <div className="flex flex-col xl:flex-row xl:items-end xl:justify-between gap-6 relative z-10">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-2 h-2 bg-accent" />
              <span className="text-[10px] font-black text-accent uppercase tracking-[0.4em]">Internal Directory</span>
            </div>
            <h1 className="text-4xl font-black text-ink tracking-tighter">Staff <span className="text-accent">Directory</span></h1>
            <p className="text-sm font-bold text-muted mt-2 uppercase tracking-widest">
              {loading ? 'Loading…' : `${filtered.length} of ${employees.length} active personnel`}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative">
              <input
                type="text"
                placeholder="Search name, role, department…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full sm:w-72 bg-page border border-rule px-5 py-3.5 text-xs font-bold text-ink placeholder:text-muted focus:border-accent focus:ring-4 focus:ring-accent outline-none transition-all"
              />
              <svg className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <select
              value={deptFilter}
              onChange={e => setDeptFilter(e.target.value)}
              className="bg-page border border-rule px-5 py-3.5 text-xs font-bold text-ink focus:border-accent focus:ring-4 focus:ring-accent outline-none transition-all appearance-none"
            >
              <option value="">All Departments</option>
              {departments.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Department pills */}
      {departments.length > 0 && !loading && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setDeptFilter('')}
            className={`px-4 py-2  text-[10px] font-black uppercase tracking-widest border transition-all ${!deptFilter ? 'bg-shadow text-paper border-shadow' : 'bg-paper text-muted border-rule hover:border-accent hover:text-accent'}`}
          >
            All
          </button>
          {departments.map(d => (
            <button
              key={d}
              onClick={() => setDeptFilter(prev => prev === d ? '' : d)}
              className={`px-4 py-2  text-[10px] font-black uppercase tracking-widest border transition-all ${deptFilter === d ? 'bg-accent text-paper border-accent' : 'bg-paper text-muted border-rule hover:border-accent hover:text-accent'}`}
            >
              {d}
            </button>
          ))}
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-paper p-8 border border-rule animate-pulse">
              <div className="flex items-center gap-4 mb-5">
                <div className="w-14 h-14 bg-page" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-page w-3/4" />
                  <div className="h-2 bg-page w-1/2" />
                </div>
              </div>
              <div className="space-y-2 pt-4 border-t border-rule">
                <div className="h-2 bg-page w-full" />
                <div className="h-2 bg-page w-2/3" />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-paper border border-rule py-24 flex flex-col items-center gap-4">
          <div className="w-16 h-16 bg-page border-2 border-dashed border-rule flex items-center justify-center text-2xl">◎</div>
          <p className="text-sm font-black text-muted uppercase tracking-widest">No personnel match your filters</p>
          <button onClick={() => { setSearch(''); setDeptFilter(''); }} className="text-[10px] font-black text-accent uppercase tracking-widest hover:underline">
            Clear filters
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {filtered.map(emp => (
            <Link key={emp.id} href={`/employees/${emp.id}`} className="bg-paper p-7 border border-rule group hover:border-accent hover: hover:-translate-y-0.5 transition-all duration-300 cursor-pointer block">
              <div className="flex items-center gap-4 mb-5">
                <div className="w-14 h-14 bg-shadow border border-shadow flex items-center justify-center text-xs font-black text-accent group-hover:scale-110 transition-transform duration-500 relative overflow-hidden shrink-0">
                  {emp.profilePhotoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={emp.profilePhotoUrl} alt={emp.fullName} className="absolute inset-0 w-full h-full object-cover" />
                  ) : (
                    <>
                      <div className="absolute inset-0 bg-accent opacity-0 group-hover:opacity-100 transition-opacity" />
                      {getInitials(emp.fullName)}
                    </>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-black text-ink uppercase tracking-tight group-hover:text-accent transition-colors truncate">{emp.fullName}</p>
                  <p className="label-form mt-1 truncate">{emp.designation || '—'}</p>
                </div>
              </div>

              <div className="space-y-2.5 pt-4 border-t border-rule">
                <div className="flex justify-between items-center gap-2">
                  <span className="label-form shrink-0">Dept</span>
                  <span className={`text-[9px] font-black uppercase px-2.5 py-1  border ${deptColor(emp.department)}`}>{emp.department || '—'}</span>
                </div>
                <div className="flex justify-between items-center gap-2">
                  <span className="label-form shrink-0">Employee ID</span>
                  <span className="text-[9px] font-black text-ink uppercase">{emp.employeeCode}</span>
                </div>
                <div className="flex justify-between items-center gap-2">
                  <span className="label-form shrink-0">Contract</span>
                  <span className="text-[9px] font-bold text-muted uppercase">{emp.employmentType?.replace('_', ' ') ?? '—'}</span>
                </div>
                {emp.workEmail && (
                  <div className="flex justify-between items-center gap-2">
                    <span className="label-form shrink-0">Email</span>
                    <a
                      href={`mailto:${emp.workEmail}`}
                      onClick={e => e.stopPropagation()}
                      className="text-[9px] font-bold text-accent hover:underline truncate max-w-[130px]"
                    >
                      {emp.workEmail}
                    </a>
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
