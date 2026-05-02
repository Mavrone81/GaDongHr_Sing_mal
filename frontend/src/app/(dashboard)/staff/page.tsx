'use client';

import { useState, useEffect, useMemo } from 'react';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  const c = document.cookie.split('; ').find(r => r.startsWith('vorkhive_token='));
  return c ? c.split('=').slice(1).join('=') : null;
}
function apiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? `http://${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:4000/api`;
}
async function apiFetch(path: string) {
  const token = getToken();
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${apiBase()}${path}`, { headers: h });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

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
}

function getInitials(name: string) {
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
}

const DEPT_COLORS: Record<string, string> = {
  Engineering: 'bg-indigo-50 text-indigo-700 border-indigo-100',
  Finance: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  Marketing: 'bg-rose-50 text-rose-700 border-rose-100',
  'Human Resources': 'bg-purple-50 text-purple-700 border-purple-100',
  Operations: 'bg-amber-50 text-amber-700 border-amber-100',
  Sales: 'bg-sky-50 text-sky-700 border-sky-100',
};
function deptColor(dept: string) {
  return DEPT_COLORS[dept] ?? 'bg-slate-50 text-slate-700 border-slate-100';
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
      <div className="bg-white p-10 rounded-[2.5rem] border border-slate-100 shadow-2xl shadow-indigo-500/5 relative overflow-hidden group">
        <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
          <div className="w-32 h-32 bg-indigo-600 rounded-full blur-3xl" />
        </div>
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 relative z-10">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-2 h-2 bg-indigo-600 rounded-full" />
              <span className="text-[10px] font-black text-indigo-600 uppercase tracking-[0.4em]">Internal Directory</span>
            </div>
            <h1 className="text-4xl font-black text-slate-900 tracking-tighter">Staff <span className="text-indigo-600">Directory</span></h1>
            <p className="text-sm font-bold text-slate-400 mt-2 uppercase tracking-widest">
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
                className="w-full sm:w-72 bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 text-xs font-bold text-slate-900 placeholder:text-slate-300 focus:border-indigo-600 focus:ring-4 focus:ring-indigo-600/5 outline-none transition-all"
              />
              <svg className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <select
              value={deptFilter}
              onChange={e => setDeptFilter(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 text-xs font-bold text-slate-900 focus:border-indigo-600 focus:ring-4 focus:ring-indigo-600/5 outline-none transition-all appearance-none"
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
            className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${!deptFilter ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-400 border-slate-200 hover:border-indigo-200 hover:text-indigo-600'}`}
          >
            All
          </button>
          {departments.map(d => (
            <button
              key={d}
              onClick={() => setDeptFilter(prev => prev === d ? '' : d)}
              className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${deptFilter === d ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-400 border-slate-200 hover:border-indigo-200 hover:text-indigo-600'}`}
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
            <div key={i} className="bg-white p-8 rounded-[2rem] border border-slate-100 animate-pulse">
              <div className="flex items-center gap-4 mb-5">
                <div className="w-14 h-14 rounded-2xl bg-slate-100" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-slate-100 rounded w-3/4" />
                  <div className="h-2 bg-slate-100 rounded w-1/2" />
                </div>
              </div>
              <div className="space-y-2 pt-4 border-t border-slate-50">
                <div className="h-2 bg-slate-100 rounded w-full" />
                <div className="h-2 bg-slate-100 rounded w-2/3" />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-[2rem] border border-slate-100 py-24 flex flex-col items-center gap-4">
          <div className="w-16 h-16 bg-slate-50 border-2 border-dashed border-slate-200 rounded-3xl flex items-center justify-center text-2xl">◎</div>
          <p className="text-sm font-black text-slate-400 uppercase tracking-widest">No personnel match your filters</p>
          <button onClick={() => { setSearch(''); setDeptFilter(''); }} className="text-[10px] font-black text-indigo-600 uppercase tracking-widest hover:underline">
            Clear filters
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {filtered.map(emp => (
            <div key={emp.id} className="bg-white p-7 rounded-[2rem] border border-slate-100 shadow-lg shadow-indigo-500/5 group hover:border-indigo-200 hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300">
              <div className="flex items-center gap-4 mb-5">
                <div className="w-14 h-14 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-center text-xs font-black text-indigo-400 group-hover:scale-110 transition-transform duration-500 relative overflow-hidden shrink-0">
                  <div className="absolute inset-0 bg-indigo-600/10 opacity-0 group-hover:opacity-100 transition-opacity" />
                  {getInitials(emp.fullName)}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-black text-slate-900 uppercase tracking-tight group-hover:text-indigo-600 transition-colors truncate">{emp.fullName}</p>
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-1 truncate">{emp.designation || '—'}</p>
                </div>
              </div>

              <div className="space-y-2.5 pt-4 border-t border-slate-50">
                <div className="flex justify-between items-center gap-2">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest shrink-0">Dept</span>
                  <span className={`text-[9px] font-black uppercase px-2.5 py-1 rounded-lg border ${deptColor(emp.department)}`}>{emp.department || '—'}</span>
                </div>
                <div className="flex justify-between items-center gap-2">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest shrink-0">Employee ID</span>
                  <span className="text-[9px] font-black text-slate-600 uppercase">{emp.employeeCode}</span>
                </div>
                <div className="flex justify-between items-center gap-2">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest shrink-0">Contract</span>
                  <span className="text-[9px] font-bold text-slate-500 uppercase">{emp.employmentType?.replace('_', ' ') ?? '—'}</span>
                </div>
                {emp.workEmail && (
                  <div className="flex justify-between items-center gap-2">
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest shrink-0">Email</span>
                    <a href={`mailto:${emp.workEmail}`} className="text-[9px] font-bold text-indigo-600 hover:underline truncate max-w-[130px]">{emp.workEmail}</a>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
