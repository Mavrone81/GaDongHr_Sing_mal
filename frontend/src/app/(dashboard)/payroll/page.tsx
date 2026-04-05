'use client';

import { useState } from 'react';

export default function PayrollDashboard() {
  const [isRunModalOpen, setIsRunModalOpen] = useState(false);

  return (
    <div className="flex flex-col gap-6 max-w-[1600px] mx-auto pb-12">
      <div className="flex justify-between items-center bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Payroll Processing</h2>
          <p className="text-sm text-gray-500 mt-1">Manage salary disbursements, CPF/SDL statutory tracking, and GIRO bank generations.</p>
        </div>
        <button 
          onClick={() => setIsRunModalOpen(true)}
          className="px-4 py-2 rounded-md text-sm font-medium text-white bg-brand-600 hover:bg-brand-500 shadow-sm"
        >
          + New Payroll Run
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Pending Disbursement (Current)</p>
          <h3 className="text-3xl font-bold text-gray-900 mt-2">$245,600.00</h3>
          <div className="mt-4 pt-4 border-t border-gray-100 flex justify-between items-center text-sm">
            <span className="text-gray-600">Net Pay: $201,400</span>
            <span className="text-gray-600">CPF: $44,200</span>
          </div>
        </div>
        <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">YTD Total Disbursed</p>
          <h3 className="text-3xl font-bold text-gray-900 mt-2">$1.2M</h3>
          <div className="mt-4 pt-4 border-t border-gray-100 flex justify-between items-center text-sm">
            <span className="text-green-600 font-medium">↑ 4.2%</span>
            <span className="text-gray-500">vs Previous Year</span>
          </div>
        </div>
        <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Action Items</p>
          <div className="flex flex-col gap-2 mt-3">
            <div className="flex justify-between items-center text-sm text-red-600 font-medium cursor-pointer hover:bg-red-50 p-1 rounded-sm">
              <span>⚠ Approve Mar 2026 Run</span>
              <span>→</span>
            </div>
            <div className="flex justify-between items-center text-sm text-brand-600 font-medium cursor-pointer hover:bg-brand-50 p-1 rounded-sm">
              <span>⬇ Download GIRO .txt (Feb)</span>
              <span>→</span>
            </div>
          </div>
        </div>
      </div>

      <section className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="border-b border-gray-200 p-5 flex justify-between items-center bg-gray-50/50">
          <h3 className="text-lg font-semibold text-gray-800">Historical Payroll Runs</h3>
          <div className="flex gap-2">
            <button className="px-3 py-1.5 border border-gray-300 bg-white rounded-md text-xs font-medium text-gray-700 hover:bg-gray-50">Filter</button>
            <button className="px-3 py-1.5 border border-gray-300 bg-white rounded-md text-xs font-medium text-gray-700 hover:bg-gray-50">Export PDF</button>
          </div>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-gray-500 uppercase bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-4 font-semibold">Period</th>
                <th className="px-6 py-4 font-semibold">Status</th>
                <th className="px-6 py-4 font-semibold">Employees</th>
                <th className="px-6 py-4 font-semibold text-right">Net Payout</th>
                <th className="px-6 py-4 font-semibold text-right">CPF / SDL</th>
                <th className="px-6 py-4 font-semibold text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              
              <tr className="hover:bg-gray-50 transition-colors">
                <td className="px-6 py-4 font-medium text-gray-900">March 2026</td>
                <td className="px-6 py-4">
                  <span className="bg-amber-100 text-amber-800 text-xs font-semibold px-2.5 py-0.5 rounded-full">Pending Approval</span>
                </td>
                <td className="px-6 py-4 text-gray-600">124</td>
                <td className="px-6 py-4 text-gray-900 font-medium text-right">$201,400.00</td>
                <td className="px-6 py-4 text-gray-600 text-right">$44,200.00</td>
                <td className="px-6 py-4 text-center">
                  <button className="text-brand-600 hover:text-brand-800 font-medium text-xs border border-brand-200 px-3 py-1 rounded-full hover:bg-brand-50 transition-colors">Review Run</button>
                </td>
              </tr>

              <tr className="hover:bg-gray-50 transition-colors">
                <td className="px-6 py-4 font-medium text-gray-900">February 2026</td>
                <td className="px-6 py-4">
                  <span className="bg-emerald-100 text-emerald-800 text-xs font-semibold px-2.5 py-0.5 rounded-full">Disbursed</span>
                </td>
                <td className="px-6 py-4 text-gray-600">121</td>
                <td className="px-6 py-4 text-gray-900 font-medium text-right">$198,250.00</td>
                <td className="px-6 py-4 text-gray-600 text-right">$43,500.00</td>
                <td className="px-6 py-4 text-center">
                  <button className="text-gray-500 hover:text-gray-800 font-medium text-xs px-3 py-1 bg-gray-100 rounded-full hover:bg-gray-200 transition-colors">View Payslips</button>
                </td>
              </tr>
              
              <tr className="hover:bg-gray-50 transition-colors">
                <td className="px-6 py-4 font-medium text-gray-900">January 2026</td>
                <td className="px-6 py-4">
                  <span className="bg-emerald-100 text-emerald-800 text-xs font-semibold px-2.5 py-0.5 rounded-full">Disbursed</span>
                </td>
                <td className="px-6 py-4 text-gray-600">120</td>
                <td className="px-6 py-4 text-gray-900 font-medium text-right">$195,100.00</td>
                <td className="px-6 py-4 text-gray-600 text-right">$42,900.00</td>
                <td className="px-6 py-4 text-center">
                  <button className="text-gray-500 hover:text-gray-800 font-medium text-xs px-3 py-1 bg-gray-100 rounded-full hover:bg-gray-200 transition-colors">View Payslips</button>
                </td>
              </tr>

            </tbody>
          </table>
        </div>
      </section>
      
      {/* Initiation Modal */}
      {isRunModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg overflow-hidden border border-gray-200">
            <div className="bg-gray-50 border-b border-gray-200 px-6 py-4 flex justify-between items-center">
              <h3 className="text-lg font-bold text-gray-900 tracking-tight">Initiate Payroll Run Engine</h3>
              <button onClick={() => setIsRunModalOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl font-bold">&times;</button>
            </div>
            
            <div className="p-6 flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-gray-700">Pay Period <span className="text-red-500">*</span></label>
                <input type="month" className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none w-full" defaultValue="2026-04" />
              </div>
              
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-gray-700">Processing Group</label>
                <select className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none w-full bg-white appearance-none cursor-pointer">
                  <option value="all">Global Workforce (All Active Employees)</option>
                  <option value="full_time">Full-Time Staff Only</option>
                  <option value="contractors">Contractors & Part-Time Only</option>
                  <option value="management">Executive Management Only</option>
                </select>
              </div>
              
              <div className="flex flex-col gap-2 mt-2">
                <label className="text-sm font-semibold text-gray-700 border-b border-gray-100 pb-1">Statutory Computation Flags</label>
                
                <label className="flex items-center gap-3 text-sm text-gray-700 cursor-pointer p-1">
                  <input type="checkbox" defaultChecked className="w-4 h-4 text-brand-600 rounded border-gray-300 focus:ring-brand-500" />
                  <div className="flex flex-col">
                    <span className="font-medium text-gray-900">Compute Central Provident Fund (CPF)</span>
                    <span className="text-xs text-gray-500">Evaluates Age Bands, Citizenship (SC/PR/FG) and Ordinary/Additional Wages</span>
                  </div>
                </label>
                
                <label className="flex items-center gap-3 text-sm text-gray-700 cursor-pointer p-1">
                  <input type="checkbox" defaultChecked className="w-4 h-4 text-brand-600 rounded border-gray-300 focus:ring-brand-500" />
                  <div className="flex flex-col">
                    <span className="font-medium text-gray-900">Compute Skills Development Levy (SDL)</span>
                    <span className="text-xs text-gray-500">0.25% of gross remuneration up to $11.25 cap</span>
                  </div>
                </label>
                
                <label className="flex items-center gap-3 text-sm text-gray-700 cursor-pointer p-1">
                  <input type="checkbox" defaultChecked className="w-4 h-4 text-brand-600 rounded border-gray-300 focus:ring-brand-500" />
                  <div className="flex flex-col">
                    <span className="font-medium text-gray-900">Compute Foreign Worker Levy (FWL)</span>
                    <span className="text-xs text-gray-500">Retrieves Ministry of Manpower (MOM) quota tiers by sector</span>
                  </div>
                </label>
              </div>
              
            </div>
            
            <div className="bg-gray-50 border-t border-gray-200 px-6 py-4 flex justify-end gap-3">
               <button onClick={() => setIsRunModalOpen(false)} className="px-4 py-2 border border-gray-300 text-gray-700 bg-white font-medium text-sm rounded hover:bg-gray-100 transition-colors shadow-sm">
                Cancel
              </button>
              <button onClick={() => {
                // Mocking execution logic
                alert("Initiating Server Compute: Syncing 59 Payment Components, resolving statutory limits, and evaluating PR/SC bands.");
                setIsRunModalOpen(false);
              }} className="px-5 py-2 bg-brand-600 text-white font-medium text-sm rounded hover:bg-brand-500 transition-colors shadow-sm flex items-center gap-2">
                <span>⚡</span> Execute Calculation Engine
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
