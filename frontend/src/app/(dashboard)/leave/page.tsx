"use client";

import { useState } from 'react';

export default function LeaveManagementPage() {
  const [activeTab, setActiveTab] = useState<'balances' | 'history' | 'calendar'>('balances');

  return (
    <div className="flex flex-col gap-6 max-w-[1600px] mx-auto">
      
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Leave Management</h1>
          <p className="text-sm text-gray-500 mt-1">
            Track statutory leave entitlements, submit applications, and monitor team availability.
          </p>
        </div>
        <div className="flex gap-3">
          <button className="px-4 py-2 border border-brand-200 text-brand-700 font-medium text-sm rounded bg-brand-50 hover:bg-brand-100 transition-colors shadow-sm">
             Download Report
          </button>
          <button className="px-4 py-2 bg-brand-600 text-white font-medium text-sm rounded hover:bg-brand-500 transition-colors shadow-sm">
            + Apply for Leave
          </button>
        </div>
      </div>

      {/* KPI Widgets */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Annual Leave */}
        <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1 h-full bg-blue-500"></div>
          <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide">Annual Leave</h3>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-gray-900">14.5</span>
            <span className="text-sm text-gray-500 font-medium">/ 21 Days</span>
          </div>
          <p className="text-xs text-gray-400 mt-2">Includes 3.5 days carry-forward</p>
        </div>

        {/* Sick Leave */}
        <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1 h-full bg-red-400"></div>
          <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide">Sick Leave</h3>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-gray-900">12</span>
            <span className="text-sm text-gray-500 font-medium">/ 14 Days</span>
          </div>
          <p className="text-xs text-green-600 font-medium mt-2">No MC deductions pending</p>
        </div>

        {/* Childcare Leave */}
        <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1 h-full bg-purple-500"></div>
          <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide">Childcare Leave</h3>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-gray-900">6</span>
            <span className="text-sm text-gray-500 font-medium">/ 6 Days</span>
          </div>
          <p className="text-xs text-gray-400 mt-2">Government-Paid (GPCL)</p>
        </div>

        {/* Pending Approval */}
        <div className="bg-white p-5 rounded-lg border border-orange-200 bg-orange-50/30 shadow-sm relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1 h-full bg-orange-400"></div>
          <h3 className="text-sm font-medium text-orange-800 uppercase tracking-wide">Pending Approval</h3>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-orange-600">2</span>
            <span className="text-sm text-orange-500 font-medium">Applications</span>
          </div>
          <p className="text-xs text-orange-400 mt-2">Awaiting Manager Review</p>
        </div>
      </div>

      {/* Main Content Tabs */}
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm mt-2">
        <div className="border-b border-gray-200 px-2 lg:px-6 flex gap-6 text-sm font-medium">
          <button 
            onClick={() => setActiveTab('balances')}
            className={`py-4 border-b-2 transition-colors ${activeTab === 'balances' ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            My Entitlements
          </button>
          <button 
            onClick={() => setActiveTab('history')}
            className={`py-4 border-b-2 transition-colors ${activeTab === 'history' ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            Application History
          </button>
          <button 
            onClick={() => setActiveTab('calendar')}
            className={`py-4 border-b-2 transition-colors ${activeTab === 'calendar' ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            Team Calendar
          </button>
        </div>

        <div className="p-6">
          {activeTab === 'balances' && (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[800px]">
                <thead>
                  <tr className="border-b border-gray-200 text-xs uppercase tracking-wider text-gray-500">
                    <th className="pb-3 font-semibold">Leave Type</th>
                    <th className="pb-3 font-semibold text-right">Statutory Tier</th>
                    <th className="pb-3 font-semibold text-right">Carried Forward</th>
                    <th className="pb-3 font-semibold text-right">Taken</th>
                    <th className="pb-3 font-semibold text-right text-brand-700">Available Balance</th>
                  </tr>
                </thead>
                <tbody className="text-sm text-gray-700 divide-y divide-gray-100">
                  <tr className="hover:bg-gray-50 transition-colors">
                    <td className="py-4 font-medium text-gray-900">Annual Leave</td>
                    <td className="py-4 text-right">21 Days</td>
                    <td className="py-4 text-right">3.5 Days</td>
                    <td className="py-4 text-right text-red-600 font-medium">10 Days</td>
                    <td className="py-4 text-right font-bold text-gray-900 text-lg">14.5 Days</td>
                  </tr>
                  <tr className="hover:bg-gray-50 transition-colors">
                    <td className="py-4 font-medium text-gray-900">Sick Leave (Non-Hospitalisation)</td>
                    <td className="py-4 text-right">14 Days</td>
                    <td className="py-4 text-right">-</td>
                    <td className="py-4 text-right">2 Days</td>
                    <td className="py-4 text-right font-bold text-gray-900 text-lg">12 Days</td>
                  </tr>
                  <tr className="hover:bg-gray-50 transition-colors">
                    <td className="py-4 font-medium text-gray-900">Hospitalisation Leave</td>
                    <td className="py-4 text-right">60 Days</td>
                    <td className="py-4 text-right">-</td>
                    <td className="py-4 text-right">0 Days</td>
                    <td className="py-4 text-right font-bold text-gray-900 text-lg">60 Days</td>
                  </tr>
                  <tr className="hover:bg-gray-50 transition-colors">
                    <td className="py-4 font-medium text-gray-900">Childcare Leave (GPCL)</td>
                    <td className="py-4 text-right">6 Days</td>
                    <td className="py-4 text-right">-</td>
                    <td className="py-4 text-right">0 Days</td>
                    <td className="py-4 text-right font-bold text-gray-900 text-lg">6 Days</td>
                  </tr>
                  <tr className="hover:bg-gray-50 transition-colors">
                    <td className="py-4 font-medium text-gray-900">Paternity Leave (GPPL)</td>
                    <td className="py-4 text-right">14 Days</td>
                    <td className="py-4 text-right">-</td>
                    <td className="py-4 text-right">0 Days</td>
                    <td className="py-4 text-right font-bold text-gray-900 text-lg">14 Days</td>
                  </tr>
                </tbody>
              </table>
              <div className="mt-6 flex justify-end">
                <p className="text-xs font-semibold text-brand-600 cursor-pointer hover:underline">View all 22 Statutory Classifications →</p>
              </div>
            </div>
          )}

          {activeTab === 'history' && (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[800px]">
                <thead>
                  <tr className="border-b border-gray-200 text-xs uppercase tracking-wider text-gray-500">
                    <th className="pb-3 font-semibold">Date Range</th>
                    <th className="pb-3 font-semibold">Leave Category</th>
                    <th className="pb-3 font-semibold">Duration</th>
                    <th className="pb-3 font-semibold">Status</th>
                    <th className="pb-3 font-semibold text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="text-sm text-gray-700 divide-y divide-gray-100">
                  <tr className="hover:bg-gray-50 transition-colors">
                    <td className="py-4 font-medium text-gray-900">01 Dec 2025 - 05 Dec 2025</td>
                    <td className="py-4"><span className="bg-blue-100 text-blue-800 text-xs px-2 py-0.5 rounded border border-blue-200">Annual Leave</span></td>
                    <td className="py-4">5 Days</td>
                    <td className="py-4"><span className="bg-orange-100 text-orange-800 text-xs font-semibold px-2.5 py-0.5 rounded-full flex items-center w-max gap-1"><span className="w-1.5 h-1.5 rounded-full bg-orange-500"></span>Pending</span></td>
                    <td className="py-4 text-right"><button className="text-red-600 font-medium hover:underline text-xs">Recall</button></td>
                  </tr>
                  <tr className="hover:bg-gray-50 transition-colors">
                    <td className="py-4 font-medium text-gray-900">14 Sep 2025 - 15 Sep 2025</td>
                    <td className="py-4"><span className="bg-red-100 text-red-800 text-xs px-2 py-0.5 rounded border border-red-200">Sick Leave</span></td>
                    <td className="py-4">2 Days</td>
                    <td className="py-4"><span className="bg-green-100 text-green-800 text-xs font-semibold px-2.5 py-0.5 rounded-full flex items-center w-max gap-1"><span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>Approved</span></td>
                    <td className="py-4 text-right"><span className="text-gray-400 text-xs underline cursor-pointer">View MC Document</span></td>
                  </tr>
                  <tr className="hover:bg-gray-50 transition-colors">
                    <td className="py-4 font-medium text-gray-900">10 Mar 2025 - 14 Mar 2025</td>
                    <td className="py-4"><span className="bg-blue-100 text-blue-800 text-xs px-2 py-0.5 rounded border border-blue-200">Annual Leave</span></td>
                    <td className="py-4">5 Days</td>
                    <td className="py-4"><span className="bg-green-100 text-green-800 text-xs font-semibold px-2.5 py-0.5 rounded-full flex items-center w-max gap-1"><span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>Approved</span></td>
                    <td className="py-4 text-right"><span className="text-gray-300 text-xs">No Action</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {activeTab === 'calendar' && (
             <div className="h-64 flex flex-col items-center justify-center border-2 border-dashed border-gray-200 rounded-lg bg-gray-50 text-gray-500">
               <svg className="w-12 h-12 mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
               <p className="font-medium">Team Roster Sync View</p>
               <p className="text-sm mt-1">Calendar UI module will interface with attendance-service chron-jobs.</p>
             </div>
          )}

        </div>
      </div>
    </div>
  );
}
