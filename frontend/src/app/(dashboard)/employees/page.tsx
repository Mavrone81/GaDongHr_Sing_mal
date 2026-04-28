'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';

interface Employee {
  id: string;
  employeeCode: string;
  fullName: string;
  department: string;
  designation: string;
  employmentType: string;
  isActive: boolean;
  citizenshipStatus: string;
}

export default function EmployeeDirectoryPage() {
  const { hasPermission } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);

  const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

  useEffect(() => {
    const fetchEmployees = async () => {
      try {
        const token = document.cookie.split('ezyhrm_token=')[1]?.split(';')[0];
        const res = await fetch(`${apiBaseUrl}/employees?search=${searchQuery}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          setEmployees(data.employees || []);
          setTotal(data.total || 0);
        }
      } catch (err) {
        console.error('Failed to fetch employees:', err);
      } finally {
        setLoading(false);
      }
    };

    const debounce = setTimeout(fetchEmployees, 300);
    return () => clearTimeout(debounce);
  }, [searchQuery]);

  return (
    <div className="flex flex-col gap-10 max-w-[1600px] mx-auto pb-20 animate-in fade-in duration-700">
      
      {/* 1. Sovereign Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-8 bg-white p-10 rounded-[2.5rem] border border-slate-100 shadow-2xl shadow-indigo-500/5 relative overflow-hidden group">
        <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
           <div className="w-32 h-32 bg-indigo-600 rounded-full blur-3xl"></div>
        </div>
        
        <div className="flex flex-col gap-2 relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-2 h-2 bg-indigo-600 rounded-full"></div>
            <span className="text-[10px] font-black text-indigo-600 uppercase tracking-[0.4em]">Operational Resource Layer</span>
          </div>
          <h1 className="text-4xl font-black text-slate-900 tracking-tighter">Workforce <span className="text-indigo-600">Inventory</span></h1>
          <p className="text-sm font-bold text-slate-400 mt-2 uppercase tracking-widest leading-relaxed max-w-xl">
            Sovereign personnel management and statutory compliance monitoring for the enterprise.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 relative z-10">
          <div className="relative">
            <input 
              type="text" 
              placeholder="Filter by Name, ID, or Role..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full sm:w-80 bg-slate-50 border border-slate-200 rounded-2xl px-6 py-4 text-xs font-bold text-slate-900 placeholder:text-slate-300 focus:border-indigo-600 focus:ring-4 focus:ring-indigo-600/5 outline-none transition-all"
            />
            <div className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-300">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
            </div>
          </div>
          <button className="px-8 py-4 bg-slate-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] hover:bg-slate-800 transition-all shadow-xl shadow-slate-900/10 active:scale-95">
             Refine
          </button>
          <button 
            onClick={() => {}} // Integration point for onboarding modal
            className="px-8 py-4 bg-indigo-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] hover:bg-indigo-700 shadow-xl shadow-indigo-500/30 transition-all active:scale-95 flex items-center gap-3"
          >
             <span>+</span> Provision Identity
          </button>
        </div>
      </div>

      {/* 2. Personnel Matrix (Table) */}
      <section className="bg-white rounded-[2.5rem] border border-slate-100 shadow-2xl shadow-indigo-500/5 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-100">
                <th className="px-10 py-8">Identity Reference</th>
                <th className="px-10 py-8">Structural Unit</th>
                <th className="px-10 py-8">Contract Class</th>
                <th className="px-10 py-8">Status Registry</th>
                <th className="px-10 py-8 text-right">Governance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td colSpan={5} className="px-10 py-6"><div className="h-10 bg-slate-100 rounded-xl w-full"></div></td>
                  </tr>
                ))
              ) : employees.map((emp) => (
                <tr key={emp.id} className="group hover:bg-slate-50/50 transition-all duration-300">
                  <td className="px-10 py-6">
                    <div className="flex items-center gap-5">
                      <div className="h-14 w-14 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-center text-xs font-black text-indigo-400 shadow-xl group-hover:scale-110 transition-transform duration-500 relative overflow-hidden">
                        <div className="absolute inset-0 bg-indigo-600/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                        {emp.fullName.split(' ').map(n => n[0]).join('')}
                      </div>
                      <div className="flex flex-col">
                        <span className="text-sm font-black text-slate-900 group-hover:text-indigo-600 transition-colors uppercase tracking-tight">{emp.fullName}</span>
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1.5">{emp.employeeCode} • {emp.designation}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-10 py-6 uppercase">
                    <span className="text-[10px] font-black text-slate-600 tracking-widest bg-slate-100 px-3 py-1.5 rounded-lg">{emp.department}</span>
                  </td>
                  <td className="px-10 py-6">
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{emp.employmentType.replace('_', ' ')}</span>
                  </td>
                  <td className="px-10 py-6">
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${emp.isActive ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`}></div>
                      <span className={`text-[10px] font-black uppercase tracking-[0.2em] ${emp.isActive ? 'text-emerald-600' : 'text-slate-400'}`}>
                        {emp.isActive ? 'Active Duty' : 'Deactivated'}
                      </span>
                    </div>
                  </td>
                  <td className="px-10 py-6 text-right">
                    <Link 
                      href={`/employees/${emp.id}`}
                      className="inline-flex items-center gap-3 px-6 py-2.5 bg-white border border-slate-200 rounded-xl text-[9px] font-black text-slate-600 uppercase tracking-widest hover:border-indigo-600 hover:text-indigo-600 hover:bg-indigo-50 shadow-sm transition-all active:scale-95"
                    >
                      Audit Profile
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg>
                    </Link>
                  </td>
                </tr>
              ))}
              {employees.length === 0 && !loading && (
                <tr>
                  <td colSpan={5} className="px-10 py-20 text-center">
                    <div className="flex flex-col items-center gap-4 opacity-30 grayscale">
                       <span className="text-4xl">📁</span>
                       <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em]">No personnel records detected in sector</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Matrix Metadata Footer */}
        <div className="p-8 bg-slate-50/50 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-4">
             <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Global Aggregation</span>
             <div className="h-6 w-[1px] bg-slate-200"></div>
             <span className="text-[10px] font-black text-slate-900 uppercase">Total Workforce: <span className="text-indigo-600">{total} Entities</span></span>
          </div>
          
          <div className="flex items-center gap-2">
            <button className="w-10 h-10 flex items-center justify-center bg-white border border-slate-200 rounded-xl text-slate-400 hover:text-indigo-600 hover:border-indigo-600 transition-all disabled:opacity-30" disabled>
               <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M15 19l-7-7 7-7"></path></svg>
            </button>
            <div className="px-5 py-2 bg-slate-950 rounded-xl text-[10px] font-black text-indigo-400 uppercase tracking-widest">Sector 1</div>
            <button className="w-10 h-10 flex items-center justify-center bg-white border border-slate-200 rounded-xl text-slate-400 hover:text-indigo-600 hover:border-indigo-600 transition-all">
               <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M9 5l7 7-7 7"></path></svg>
            </button>
          </div>
        </div>
      </section>

    </div>
  );
}
