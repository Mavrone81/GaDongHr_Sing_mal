'use client';

import { useState } from 'react';

export default function RecruitmentPage() {
  const [activeTab, setActiveTab] = useState('active');

  const jobs = [
    { id: 'JOB-001', title: 'Senior Full Stack Engineer', department: 'Engineering', applicants: 12, status: 'Open', postedDate: '2026-03-25', mcfCompliance: true },
    { id: 'JOB-002', title: 'HR Manager', department: 'People Ops', applicants: 45, status: 'Open', postedDate: '2026-03-20', mcfCompliance: true },
    { id: 'JOB-003', title: 'Product Designer', department: 'Design', applicants: 8, status: 'Draft', postedDate: '-', mcfCompliance: false },
  ];

  return (
    <div className="flex flex-col gap-6 max-w-[1600px] mx-auto pb-12 text-gray-900">
      <div className="flex justify-between items-center bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 tracking-tight text-brand-600">Recruitment & ATS</h2>
          <p className="text-sm text-gray-500 mt-1">Manage job postings, applicant pipelines, and MyCareersFuture (MCF) compliance.</p>
        </div>
        <div className="flex gap-3">
          <button className="px-4 py-2 rounded-md text-sm font-medium border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 transition-colors shadow-sm">
            Import Candidates
          </button>
          <button className="px-4 py-2 rounded-md text-sm font-medium text-white bg-brand-600 hover:bg-brand-500 shadow-sm transition-all active:scale-95">
            + Create Job Opening
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Active Openings</p>
          <p className="text-2xl font-black text-gray-900 mt-1">2</p>
          <div className="h-1 w-full bg-gray-100 mt-3 rounded-full overflow-hidden">
            <div className="h-full bg-brand-500 w-1/2"></div>
          </div>
        </div>
        <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">New Applicants</p>
          <p className="text-2xl font-black text-brand-600 mt-1">65</p>
          <p className="text-xs text-brand-600 font-bold mt-2">12 since yesterday</p>
        </div>
        <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Interviews Today</p>
          <p className="text-2xl font-black text-gray-900 mt-1">4</p>
          <div className="flex -space-x-2 mt-3">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-7 w-7 rounded-full border-2 border-white bg-brand-100 flex items-center justify-center text-[10px] font-bold text-brand-700">U{i}</div>
            ))}
          </div>
        </div>
        <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">MCF Compliance</p>
          <p className="text-2xl font-black text-green-600 mt-1">100%</p>
          <p className="text-xs text-gray-500 mt-2">All active ads >14 days</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm flex-1 overflow-hidden flex flex-col min-h-[500px]">
        <div className="px-6 py-4 border-b border-gray-50 flex items-center gap-6">
          <button 
            onClick={() => setActiveTab('active')}
            className={`text-sm font-bold pb-4 -mb-4 border-b-2 transition-all ${activeTab === 'active' ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
          >
            Active Job Openings
          </button>
          <button 
            onClick={() => setActiveTab('applicants')}
            className={`text-sm font-bold pb-4 -mb-4 border-b-2 transition-all ${activeTab === 'applicants' ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
          >
            Applicant Pipeline
          </button>
          <button 
            onClick={() => setActiveTab('closed')}
            className={`text-sm font-bold pb-4 -mb-4 border-b-2 transition-all ${activeTab === 'closed' ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
          >
            Closed / Filled
          </button>
        </div>

        <div className="flex-1">
          {activeTab === 'active' && (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50/50 text-gray-500 text-[10px] font-black uppercase tracking-widest border-b border-gray-100">
                    <th className="px-6 py-4">Job Title & ID</th>
                    <th className="px-6 py-4">Department</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4 text-center">Applicants</th>
                    <th className="px-6 py-4">MCF Status</th>
                    <th className="px-6 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {jobs.map((job) => (
                    <tr key={job.id} className="group hover:bg-brand-50/20 transition-all cursor-pointer">
                      <td className="px-6 py-5">
                        <p className="text-sm font-black text-gray-900 group-hover:text-brand-700 transition-colors">{job.title}</p>
                        <p className="text-[10px] text-gray-400 mt-0.5">{job.id} • Posted {job.postedDate}</p>
                      </td>
                      <td className="px-6 py-5 text-sm font-medium text-gray-600">{job.department}</td>
                      <td className="px-6 py-5">
                        <span className={`text-[10px] px-2 py-0.5 rounded font-black uppercase border ${
                          job.status === 'Open' ? 'bg-green-50 text-green-700 border-green-100' : 'bg-gray-100 text-gray-500 border-gray-200'
                        }`}>
                          {job.status}
                        </span>
                      </td>
                      <td className="px-6 py-5">
                        <div className="flex flex-col items-center">
                          <span className="text-sm font-black text-gray-900">{job.applicants}</span>
                          <span className="text-[10px] text-brand-600 font-bold uppercase tracking-tighter">View Candidates</span>
                        </div>
                      </td>
                      <td className="px-6 py-5">
                        <div className="flex items-center gap-1.5">
                          <div className={`h-1.5 w-1.5 rounded-full ${job.mcfCompliance ? 'bg-green-500' : 'bg-gray-300'}`}></div>
                          <span className={`text-[10px] font-bold ${job.mcfCompliance ? 'text-green-700' : 'text-gray-400'}`}>
                            {job.mcfCompliance ? 'Compliant' : 'Draft'}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-5 text-right">
                        <button className="text-gray-400 hover:text-brand-600 transition-colors p-2 rounded-full hover:bg-brand-50">
                          <span className="text-xl leading-none">⋮</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {activeTab !== 'active' && (
            <div className="flex flex-col items-center justify-center p-20 gap-4 opacity-50">
              <span className="text-5xl">📁</span>
              <div className="text-center">
                <p className="text-lg font-bold text-gray-800">Pipeline Module Loading...</p>
                <p className="text-sm text-gray-500">Connecting to recruitment-service:8007 candidate sink.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
