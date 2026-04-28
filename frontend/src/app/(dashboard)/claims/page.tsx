'use client';

import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';

export default function ClaimsPage() {
  const { user } = useAuth();
  const normalizedEmail = (user?.email || '').toLowerCase().trim();
  const isAdmin = 
    user?.role === 'SUPER_ADMIN' || 
    user?.role === 'ADMIN' || 
    user?.role === 'HR_ADMIN' || 
    user?.role === 'FINANCE_ADMIN' || 
    normalizedEmail === 'admin@ezyhrm.sg';

  const [activeView, setActiveView] = useState<'audit' | 'personal'>(isAdmin ? 'audit' : 'personal');

  const staffClaims = [
    { id: 'CLM-991', staff: 'Sarah Chen', date: '2026-04-18', category: 'Travel', amount: 1250.00, status: 'Pending', merchant: 'Singapore Airlines' },
    { id: 'CLM-992', staff: 'Marcus Tan', date: '2026-04-19', category: 'Meal', amount: 45.20, status: 'Urgent', merchant: 'Song Fa Bak Kut Teh' },
    { id: 'CLM-993', staff: 'Linda Low', date: '2026-04-20', category: 'Transport', amount: 32.10, status: 'Pending', merchant: 'Grab SG' },
  ];

  const personalClaims = [
    { id: 'CLM-001', date: '2026-04-01', category: 'Transport', amount: 45.50, gst: 3.64, status: 'Approved', merchant: 'Grab Holdings' },
  ];

  // --- MANAGEMENT FINANCIAL AUDIT VIEW ---
  if (isAdmin && activeView === 'audit') {
    return (
      <div className="flex flex-col gap-6 max-w-[1600px] mx-auto pb-12">
        <div className="flex justify-between items-center bg-white p-8 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1.5 h-full bg-indigo-600"></div>
          <div>
            <h2 className="text-2xl font-black text-slate-900 tracking-tight uppercase">Finance & Claims Audit</h2>
            <p className="text-[10px] font-black text-slate-400 mt-1 uppercase tracking-[0.2em]">High-Density Reimbursement Oversight & Policy Compliance</p>
          </div>
          <button className="px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest text-indigo-600 bg-indigo-50 border border-indigo-100 hover:bg-indigo-100 transition-all">
            Download Batch Audit Log
          </button>
        </div>

        {/* Global Financial Flow */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Total Liquidity Outflow (MTD)</p>
            <p className="text-4xl font-black text-slate-900 mt-3 tabular-nums">$4,850.50</p>
            <div className="mt-5 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
              <p className="text-[9px] font-black text-amber-600 uppercase tracking-widest leading-none">12 Signals Pending Authorization</p>
            </div>
          </div>
          <div className="bg-slate-900 p-8 rounded-2xl border border-slate-800 shadow-xl">
            <p className="text-[9px] font-black text-indigo-400 uppercase tracking-widest">Efficiency Benchmark</p>
            <p className="text-4xl font-black text-white mt-3 tabular-nums">48h</p>
            <p className="text-[9px] font-black text-slate-500 mt-4 uppercase tracking-widest italic">Avg. Processing Latency Target: 24h</p>
          </div>
          <div className="bg-indigo-50/50 p-8 rounded-2xl border border-indigo-100 shadow-sm">
            <p className="text-[9px] font-black text-indigo-700 uppercase tracking-widest">Policy Compliance Vector</p>
            <p className="text-4xl font-black text-indigo-700 mt-3 tabular-nums">98.2%</p>
            <p className="text-[9px] font-black text-indigo-400 mt-4 uppercase tracking-widest italic">Anomalies Detected: 02 (Travel Category)</p>
          </div>
        </div>

        {/* Audit Queue Board */}
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden min-h-[500px]">
          <div className="px-8 py-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
            <h3 className="font-black text-slate-800 uppercase tracking-[0.2em] text-[11px]">Reimbursement Authorization Queue</h3>
            <div className="flex gap-4">
               <div className="h-2 w-2 bg-indigo-600 rounded-full animate-ping"></div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/10 text-slate-400 text-[10px] uppercase font-black tracking-[0.2em] border-b border-slate-100">
                  <th className="px-8 py-5">Initiator Identity</th>
                  <th className="px-5 py-5">Classification</th>
                  <th className="px-5 py-5">Temporal Sync</th>
                  <th className="px-5 py-5">Entity / Merchant</th>
                  <th className="px-5 py-5">Quantum (SGD)</th>
                  <th className="px-5 py-5">Status Signal</th>
                  <th className="px-8 py-5 text-right">Verification Protocol</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {staffClaims.map((claim) => (
                  <tr key={claim.id} className="group hover:bg-slate-50/80 transition-all">
                    <td className="px-8 py-6">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-[11px] font-black text-white shadow-lg">
                          {claim.staff.substring(0,2).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-black text-slate-900 leading-tight uppercase tracking-tight">{claim.staff}</p>
                          <p className="text-[9px] font-black text-slate-400 uppercase mt-1.5 tracking-widest">{claim.id}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-6">
                      <span className="text-[9px] font-black uppercase px-2.5 py-1 rounded bg-indigo-50 text-indigo-600 border border-indigo-100 tracking-widest">{claim.category}</span>
                    </td>
                    <td className="px-5 py-6 text-[10px] font-black text-slate-500 tabular-nums uppercase">{claim.date}</td>
                    <td className="px-5 py-6 text-xs font-black text-slate-800 uppercase tracking-tight">{claim.merchant}</td>
                    <td className="px-5 py-6 text-sm font-black text-slate-900 tabular-nums tracking-tighter">${claim.amount.toFixed(2)}</td>
                    <td className="px-5 py-6">
                      <span className={`text-[9px] font-black uppercase px-2.5 py-1 rounded tracking-widest border ${
                        claim.status === 'Urgent' ? 'bg-red-50 text-red-600 border-red-100 animate-pulse' : 'bg-amber-50 text-amber-600 border-amber-100'
                      }`}>
                        {claim.status}
                      </span>
                    </td>
                    <td className="px-8 py-6 text-right">
                      <div className="flex justify-end gap-3">
                        <button className="text-[10px] font-black text-indigo-600 hover:text-indigo-800 uppercase tracking-widest bg-indigo-50 px-3 py-1.5 rounded-lg border border-indigo-100 transition-all">Doc:Receipt</button>
                        <button className="text-[10px] font-black text-slate-400 hover:text-slate-900 uppercase tracking-widest px-3 py-1.5 border border-slate-100 rounded-lg hover:bg-white transition-all">Authorize</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    );
  }

  // --- STANDARD EMPLOYEE PORTAL VIEW ---
  return (
    <div className="flex flex-col gap-6 max-w-[1600px] mx-auto pb-12">
      <div className="flex justify-between items-center bg-white p-8 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden">
        <div className="absolute top-0 left-0 w-1.5 h-full bg-indigo-600"></div>
        <div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight uppercase">Personal Reimbursement Nexus</h2>
          <p className="text-[10px] font-black text-slate-400 mt-1 uppercase tracking-[0.2em]">Automated Expense Submission & GST Accounting Workflow</p>
        </div>
        <button 
          className="px-6 py-2.5 rounded-xl text-[10px] font-black text-white bg-indigo-600 hover:bg-indigo-700 shadow-xl shadow-indigo-500/20 uppercase tracking-widest transition-all"
        >
          + Submit Expense Signal
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Total Claimed (MTD)</p>
          <div className="flex items-baseline gap-2 mt-3">
            <p className="text-4xl font-black text-slate-900 tabular-nums tracking-tighter">$140.50</p>
            <span className="text-[9px] font-black text-indigo-600 uppercase">Released</span>
          </div>
          <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest mt-4">Next Payment Cycle: 25th May</p>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Recoverable GST (Input Tax)</p>
          <p className="text-4xl font-black text-slate-900 mt-3 tabular-nums">$11.24</p>
          <p className="text-[8px] font-bold text-emerald-600 uppercase tracking-widest mt-4">Automated IRAS Capture Active</p>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Pending Reconciliation</p>
          <p className="text-4xl font-black text-amber-500 mt-3 tabular-nums">01</p>
          <p className="text-[8px] font-bold text-amber-600 uppercase tracking-widest mt-4">Awaiting Financial Verification</p>
        </div>
      </div>

      <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex-1 min-h-[400px]">
        <div className="px-8 py-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <h3 className="text-[11px] font-black text-slate-800 uppercase tracking-[0.2em]">Personal Settlement History</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50/10 text-slate-400 text-[10px] uppercase font-black tracking-[0.2em] border-b border-slate-100">
                <th className="px-8 py-5">Signal ID</th>
                <th className="px-6 py-5">Entity / Merchant</th>
                <th className="px-6 py-5 text-right">Quantum (SGD)</th>
                <th className="px-6 py-5 text-right">GST Capture</th>
                <th className="px-8 py-5">System Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 text-sm font-bold">
              {personalClaims.map((claim) => (
                <tr key={claim.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-8 py-6 text-slate-400 font-black uppercase text-[10px] tracking-widest">{claim.id}</td>
                  <td className="px-6 py-6 text-slate-900 uppercase tracking-tight">{claim.merchant}</td>
                  <td className="px-6 py-6 text-right font-black text-slate-900 tabular-nums tracking-tighter">${claim.amount.toFixed(2)}</td>
                  <td className="px-6 py-6 text-right font-black text-indigo-600 tabular-nums tracking-tighter">${claim.gst?.toFixed(2)}</td>
                  <td className="px-8 py-6">
                    <span className="px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 font-black border border-emerald-100 text-[9px] uppercase tracking-widest shadow-sm">Audit: {claim.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
