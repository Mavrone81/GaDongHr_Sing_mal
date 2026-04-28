'use client';

import { useState } from 'react';

export default function RecruitmentPage() {
  const [activeTab, setActiveTab] = useState<'active' | 'pipeline' | 'closed'>('active');

  const jobs = [
    { id: 'JOB-001', title: 'Senior FE Architect', department: 'Engineering', applicants: 12, status: 'Open', postedDate: '2026-03-25', mcfStatus: 'Compliant', mcfDays: 26 },
    { id: 'JOB-002', title: 'Group HR Manager', department: 'People Ops', applicants: 45, status: 'Open', postedDate: '2026-03-20', mcfStatus: 'Compliant', mcfDays: 31 },
    { id: 'JOB-003', title: 'Product Strategist', department: 'Design', applicants: 8, status: 'Draft', postedDate: '-', mcfStatus: 'Pending', mcfDays: 0 },
  ];

  return (
    <div className="flex flex-col gap-6 max-w-[1600px] mx-auto pb-12">
      
      {/* Header Signal Block */}
      <div className="flex justify-between items-center bg-white p-8 rounded-2xl border border-slate-200 shadow-sm overflow-hidden relative">
        <div className="absolute top-0 left-0 w-1.5 h-full bg-indigo-600"></div>
        <div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight uppercase">Talent Acquisition & ATS</h2>
          <p className="text-[10px] font-black text-slate-400 mt-1 uppercase tracking-[0.2em]">Systems for Workforce Growth & MyCareersFuture (MCF) Compliance</p>
        </div>
        <div className="flex gap-4">
          <button className="px-6 py-2.5 rounded-xl text-[10px] font-black text-slate-600 bg-slate-50 border border-slate-200 hover:bg-slate-100 uppercase tracking-widest transition-all">
            Import Talent Batch
          </button>
          <button className="px-6 py-2.5 rounded-xl text-[10px] font-black text-white bg-indigo-600 hover:bg-indigo-700 shadow-xl shadow-indigo-500/20 uppercase tracking-widest transition-all">
            + Provision Job Opening
          </button>
        </div>
      </div>

      {/* KPI Intelligence Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Active Ad Signal</p>
          <div className="flex items-baseline gap-2 mt-2">
            <p className="text-3xl font-black text-slate-900">08</p>
            <span className="text-[9px] font-black text-emerald-600 uppercase">Live Ads</span>
          </div>
          <div className="h-1.5 w-full bg-slate-100 mt-4 rounded-full overflow-hidden">
            <div className="h-full bg-indigo-600 w-3/4"></div>
          </div>
        </div>
        <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800 shadow-xl">
          <p className="text-[9px] font-black text-indigo-400 uppercase tracking-widest">Total Applicant In-flow</p>
          <p className="text-3xl font-black text-white mt-2">642</p>
          <p className="text-[9px] text-indigo-400 font-bold mt-3 uppercase tracking-widest">+12 Signal Detect Last 24h</p>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Scheduled Interlocks</p>
          <p className="text-3xl font-black text-slate-900 mt-2">04</p>
          <div className="flex -space-x-2 mt-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-8 w-8 rounded-full border-2 border-white bg-slate-100 flex items-center justify-center text-[10px] font-black text-slate-900 uppercase">TI</div>
            ))}
            <div className="h-8 w-8 rounded-full border-2 border-white bg-indigo-600 flex items-center justify-center text-[10px] font-black text-white uppercase">+1</div>
          </div>
        </div>
        <div className="bg-indigo-50/50 p-6 rounded-2xl border border-indigo-100 shadow-sm">
          <p className="text-[9px] font-black text-indigo-700 uppercase tracking-widest">MCF Compliance Delta</p>
          <p className="text-3xl font-black text-indigo-700 mt-2">100%</p>
          <p className="text-[9px] text-indigo-400 font-bold mt-3 uppercase tracking-widest leading-none">All active ads satisfy<br/>14-day Fair Consideration Policy.</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden min-h-[600px] flex flex-col">
        {/* Tab Interface */}
        <div className="px-8 border-b border-slate-100 flex items-center gap-10 bg-slate-50/50">
          <button 
            onClick={() => setActiveTab('active')}
            className={`py-5 text-[11px] font-black uppercase tracking-[0.2em] border-b-2 transition-all ${activeTab === 'active' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
          >
            Job Command Board
          </button>
          <button 
            onClick={() => setActiveTab('pipeline')}
            className={`py-5 text-[11px] font-black uppercase tracking-[0.2em] border-b-2 transition-all ${activeTab === 'pipeline' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
          >
            Applicant Pipeline
          </button>
          <button 
            onClick={() => setActiveTab('closed')}
            className={`py-5 text-[11px] font-black uppercase tracking-[0.2em] border-b-2 transition-all ${activeTab === 'closed' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
          >
            Archived Signals
          </button>
        </div>

        <div className="flex-1">
          {activeTab === 'active' && (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-slate-50/10 text-slate-400 text-[10px] font-black uppercase tracking-[0.2em] border-b border-slate-100">
                    <th className="px-8 py-5">Designation ID</th>
                    <th className="px-6 py-5">Departmental Sector</th>
                    <th className="px-6 py-5">Operational Status</th>
                    <th className="px-6 py-5 text-center">Applicant Count</th>
                    <th className="px-6 py-5">MCF Compliance Status</th>
                    <th className="px-8 py-5 text-right">Protocol</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {jobs.map((job) => (
                    <tr key={job.id} className="group hover:bg-slate-50/80 transition-all cursor-pointer">
                      <td className="px-8 py-6">
                        <p className="text-sm font-black text-slate-900 group-hover:text-indigo-600 transition-colors uppercase tracking-tight">{job.title}</p>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1.5">{job.id} <span className="mx-2 opacity-30">|</span> Sync: {job.postedDate}</p>
                      </td>
                      <td className="px-6 py-6"><span className="text-[10px] font-black text-slate-500 uppercase tracking-widest border border-slate-200 px-3 py-1 rounded-lg">{job.department}</span></td>
                      <td className="px-6 py-6">
                        <span className={`text-[9px] px-2.5 py-1 rounded-full font-black uppercase border tracking-widest ${
                          job.status === 'Open' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-slate-100 text-slate-500 border-slate-200'
                        }`}>
                          {job.status === 'Open' ? 'MISSION ACTIVE' : 'DRAFT SIGNAL'}
                        </span>
                      </td>
                      <td className="px-6 py-6">
                        <div className="flex flex-col items-center">
                          <span className="text-base font-black text-slate-900">{job.applicants}</span>
                          <span className="text-[8px] text-indigo-600 font-black uppercase tracking-widest mt-1">Review Files</span>
                        </div>
                      </td>
                      <td className="px-6 py-6">
                        <div className="flex flex-col gap-1.5">
                           <div className="flex items-center gap-2">
                              <div className={`h-1.5 w-1.5 rounded-full ${job.mcfStatus === 'Compliant' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-slate-300'}`}></div>
                              <span className={`text-[10px] font-black uppercase tracking-widest ${job.mcfStatus === 'Compliant' ? 'text-emerald-700' : 'text-slate-400'}`}>
                                {job.mcfStatus}
                              </span>
                           </div>
                           <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">Posting Age: {job.mcfDays} Days</p>
                        </div>
                      </td>
                      <td className="px-8 py-6 text-right">
                        <button className="text-slate-300 hover:text-indigo-600 transition-colors bg-slate-50 hover:bg-white p-2 rounded-lg border border-transparent hover:border-slate-200 shadow-sm font-black text-lg">
                          ⋮
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {activeTab === 'pipeline' && (
            <div className="p-20 flex flex-col items-center justify-center animate-in fade-in duration-500">
               <div className="w-24 h-24 bg-slate-900 rounded-[2.5rem] flex items-center justify-center text-4xl mb-8 shadow-2xl shadow-indigo-500/10 border border-slate-800">
                  🧬
               </div>
               <h3 className="text-xl font-black text-slate-900 tracking-tight uppercase">Talent Sequencing Interface Ready</h3>
               <p className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em] mt-3 text-center max-w-sm leading-loose">Establishing secure connection to recruitment-service:8007 for candidate flow visualization...</p>
               <div className="mt-10 flex gap-4">
                  <div className="w-2 h-2 bg-indigo-600 rounded-full animate-bounce delay-0"></div>
                  <div className="w-2 h-2 bg-indigo-300 rounded-full animate-bounce delay-75"></div>
                  <div className="w-2 h-2 bg-indigo-100 rounded-full animate-bounce delay-150"></div>
               </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
