'use client';

import { useState } from 'react';

export default function ClaimsPage() {
  const [isNewClaimModalOpen, setIsNewClaimModalOpen] = useState(false);

  const claims = [
    { id: 'CLM-001', date: '2026-04-01', category: 'Transport', amount: 45.50, gst: 3.64, status: 'Approved', merchant: 'Grab Holdings' },
    { id: 'CLM-002', date: '2026-04-02', category: 'Meal', amount: 15.00, gst: 1.20, status: 'Pending', merchant: 'Foodpanda' },
    { id: 'CLM-003', date: '2026-04-03', category: 'Medical', amount: 80.00, gst: 0.00, status: 'Rejected', merchant: 'Raffles Medical' },
  ];

  return (
    <div className="flex flex-col gap-6 max-w-[1600px] mx-auto pb-12">
      <div className="flex justify-between items-center bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Claims Management</h2>
          <p className="text-sm text-gray-500 mt-1">Submit and track expense reimbursements with automated GST handling.</p>
        </div>
        <button 
          onClick={() => setIsNewClaimModalOpen(true)}
          className="px-4 py-2 rounded-md text-sm font-medium text-white bg-brand-600 hover:bg-brand-500 shadow-sm transition-all active:scale-95"
        >
          + Submit New Claim
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
          <p className="text-sm font-medium text-gray-500">Total Claims (MTD)</p>
          <p className="text-3xl font-bold text-gray-900 mt-2">$140.50</p>
          <p className="text-xs text-green-600 mt-2 flex items-center gap-1">
            <span>↑</span> 12% vs last month
          </p>
        </div>
        <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
          <p className="text-sm font-medium text-gray-500">Pending Approval</p>
          <p className="text-3xl font-bold text-amber-600 mt-2">1</p>
          <p className="text-xs text-gray-500 mt-2">Awaiting Finance Review</p>
        </div>
        <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
          <p className="text-sm font-medium text-gray-500">Approved (MTD)</p>
          <p className="text-3xl font-bold text-brand-600 mt-2">$45.50</p>
          <p className="text-xs text-gray-500 mt-2">Processed in Apr Payroll</p>
        </div>
      </div>

      <section className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
          <h3 className="font-bold text-gray-900">Recent Claim Applications</h3>
          <div className="flex gap-2">
            <select className="text-xs border rounded px-2 py-1 outline-none focus:ring-1 focus:ring-brand-500">
              <option>All Categories</option>
              <option>Transport</option>
              <option>Meal</option>
              <option>Medical</option>
            </select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wider">
                <th className="px-6 py-3 font-semibold">Claim ID</th>
                <th className="px-6 py-3 font-semibold">Date</th>
                <th className="px-6 py-3 font-semibold">Merchant / Details</th>
                <th className="px-6 py-3 font-semibold">Category</th>
                <th className="px-6 py-3 font-semibold">Amount (SGD)</th>
                <th className="px-6 py-3 font-semibold">GST</th>
                <th className="px-6 py-3 font-semibold">Status</th>
                <th className="px-6 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {claims.map((claim) => (
                <tr key={claim.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">{claim.id}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{claim.date}</td>
                  <td className="px-6 py-4 text-sm text-gray-900 font-medium">{claim.merchant}</td>
                  <td className="px-6 py-4">
                    <span className="text-xs px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 font-medium border border-blue-100">
                      {claim.category}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm font-bold text-gray-900">${claim.amount.toFixed(2)}</td>
                  <td className="px-6 py-4 text-sm text-gray-500">${claim.gst.toFixed(2)}</td>
                  <td className="px-6 py-4">
                    <span className={`text-xs px-2.5 py-0.5 rounded-full font-bold border ${
                      claim.status === 'Approved' ? 'bg-green-50 text-green-700 border-green-100' :
                      claim.status === 'Pending' ? 'bg-amber-50 text-amber-700 border-amber-100' :
                      'bg-red-50 text-red-700 border-red-100'
                    }`}>
                      {claim.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button className="text-brand-600 hover:text-brand-800 text-sm font-semibold transition-colors">View Receipt</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* New Claim Modal */}
      {isNewClaimModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-xl overflow-hidden border border-gray-200 mx-4">
            <div className="bg-gray-50 border-b border-gray-200 px-6 py-4 flex justify-between items-center">
              <h3 className="text-lg font-bold text-gray-900 tracking-tight">Submit Reimbursement Claim</h3>
              <button onClick={() => setIsNewClaimModalOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl font-bold">&times;</button>
            </div>
            
            <form className="p-6 flex flex-col gap-5">
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-semibold text-gray-700">Expense Date <span className="text-red-500">*</span></label>
                  <input type="date" className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none w-full" defaultValue={new Date().toISOString().split('T')[0]} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-semibold text-gray-700">Category <span className="text-red-500">*</span></label>
                  <select className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none w-full bg-white cursor-pointer">
                    <option value="transport">Transport (Grab/Taxi/Fuel)</option>
                    <option value="meal">Business Meal / Entertainment</option>
                    <option value="medical">Medical Outpatient</option>
                    <option value="travel">Overseas Travel</option>
                    <option value="others">Other Miscellaneous</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-gray-700">Merchant Name <span className="text-red-500">*</span></label>
                <input type="text" placeholder="e.g. Grab Holdings, NTUC FairPrice" className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none w-full" />
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="flex flex-col gap-1.5 group">
                  <label className="text-sm font-semibold text-gray-700">Base Amount (SGD) <span className="text-red-500">*</span></label>
                  <div className="relative">
                    <span className="absolute left-3 top-2 text-gray-400">$</span>
                    <input type="number" step="0.01" className="rounded-md border border-gray-300 pl-7 pr-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none w-full" placeholder="0.00" />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-semibold text-gray-700">GST Amount (9%)</label>
                  <div className="relative">
                    <span className="absolute left-3 top-2 text-gray-400">$</span>
                    <input type="number" readOnly className="rounded-md border border-gray-100 bg-gray-50 pl-7 pr-3 py-2 text-sm text-gray-500 outline-none w-full cursor-not-allowed" placeholder="0.00" />
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-gray-700">Attachment (Receipt) <span className="text-red-500">*</span></label>
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 flex flex-col items-center justify-center gap-2 hover:border-brand-400 hover:bg-brand-50/20 transition-all cursor-pointer">
                  <span className="text-2xl text-gray-400">📄</span>
                  <p className="text-xs font-medium text-gray-600">Click to upload or drag and drop</p>
                  <p className="text-[10px] text-gray-400 uppercase font-bold">PDF, JPG or PNG up to 5MB</p>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-gray-700">Purpose / Description</label>
                <textarea rows={2} className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none w-full resize-none" placeholder="Explain the business reason for this expense..."></textarea>
              </div>
            </form>
            
            <div className="bg-gray-50 border-t border-gray-200 px-6 py-4 flex justify-end gap-3">
              <button onClick={() => setIsNewClaimModalOpen(false)} className="px-4 py-2 border border-gray-300 text-gray-700 bg-white font-medium text-sm rounded hover:bg-gray-100 transition-colors shadow-sm">
                Cancel
              </button>
              <button onClick={() => {
                alert("Claim CLM-004 submitted for manager review.");
                setIsNewClaimModalOpen(false);
              }} className="px-5 py-2 bg-brand-600 text-white font-medium text-sm rounded hover:bg-brand-500 transition-colors shadow-sm">
                Submit Claim
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
