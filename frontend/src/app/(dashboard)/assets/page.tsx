'use client';

import { useState } from 'react';

const assets = [
  { id: 'AST-001', name: 'MacBook Pro 14" M3', category: 'Laptop', assignedTo: 'Johnathan Lim', dept: 'Engineering', assignedDate: '2024-03-15', status: 'Assigned', value: 3200 },
  { id: 'AST-002', name: 'iPhone 15 Pro', category: 'Mobile', assignedTo: 'Sarah Tan', dept: 'Marketing', assignedDate: '2024-06-01', status: 'Assigned', value: 1500 },
  { id: 'AST-003', name: 'Dell UltraSharp 27"', category: 'Monitor', assignedTo: 'David Chen', dept: 'Finance', assignedDate: '2023-11-10', status: 'Assigned', value: 800 },
  { id: 'AST-004', name: 'Lenovo ThinkPad X1', category: 'Laptop', assignedTo: null, dept: null, assignedDate: null, status: 'Available', value: 2400 },
  { id: 'AST-005', name: 'AirPods Pro', category: 'Accessories', assignedTo: 'Amanda Leong', dept: 'HR', assignedDate: '2025-01-20', status: 'Assigned', value: 350 },
  { id: 'AST-006', name: 'Cisco IP Phone', category: 'Telecom', assignedTo: null, dept: null, assignedDate: null, status: 'Under Repair', value: 220 },
  { id: 'AST-007', name: 'Standing Desk', category: 'Furniture', assignedTo: 'Marcus Ng', dept: 'Sales', assignedDate: '2025-03-01', status: 'Assigned', value: 950 },
];

const statusStyle: Record<string, string> = {
  Assigned:     'bg-indigo-50 text-indigo-600 border-indigo-100',
  Available:    'bg-emerald-50 text-emerald-600 border-emerald-100',
  'Under Repair': 'bg-amber-50 text-amber-600 border-amber-100',
  Retired:      'bg-slate-50 text-slate-400 border-slate-100',
};

export default function AssetsPage() {
  const [filter, setFilter] = useState('All');
  const cats = ['All', 'Laptop', 'Mobile', 'Monitor', 'Accessories', 'Telecom', 'Furniture'];

  const filtered = filter === 'All' ? assets : assets.filter(a => a.category === filter);
  const totalValue = assets.reduce((s, a) => s + a.value, 0);
  const assigned = assets.filter(a => a.status === 'Assigned').length;

  return (
    <div className="flex flex-col gap-8 max-w-[1400px] mx-auto pb-20 animate-in fade-in duration-700">

      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 bg-white p-10 rounded-[2.5rem] border border-slate-100 shadow-2xl shadow-indigo-500/5 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-teal-500/5 rounded-full blur-3xl" />
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-2 h-2 bg-teal-500 rounded-full" />
            <span className="text-[10px] font-black text-teal-600 uppercase tracking-[0.4em]">Asset & Logistics Layer</span>
          </div>
          <h1 className="text-4xl font-black text-slate-900 tracking-tighter">Asset <span className="text-teal-600">Registry</span></h1>
          <p className="text-sm font-bold text-slate-400 mt-2 uppercase tracking-widest max-w-xl">
            Corporate asset register, employee assignments, logistics requests, inventory management, and offboarding return checklists.
          </p>
        </div>
        <div className="flex gap-4 relative z-10">
          <button className="px-8 py-4 bg-slate-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 shadow-xl transition-all active:scale-95">
            + Logistics Request
          </button>
          <button className="px-8 py-4 bg-teal-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-teal-700 shadow-xl shadow-teal-500/20 transition-all active:scale-95">
            + Register Asset
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { label: 'Total Assets',     value: String(assets.length),  color: 'text-slate-900' },
          { label: 'Assigned',         value: String(assigned),        color: 'text-indigo-600' },
          { label: 'Available',        value: String(assets.filter(a => a.status === 'Available').length), color: 'text-emerald-600' },
          { label: 'Total Value (SGD)',value: `$${totalValue.toLocaleString()}`, color: 'text-teal-600' },
        ].map((k) => (
          <div key={k.label} className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-2xl shadow-indigo-500/5">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-4">{k.label}</p>
            <h3 className={`text-3xl font-black tracking-tighter ${k.color}`}>{k.value}</h3>
          </div>
        ))}
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 flex-wrap">
        {cats.map((c) => (
          <button
            key={c}
            onClick={() => setFilter(c)}
            className={`px-5 py-2.5 rounded-2xl text-[9px] font-black uppercase tracking-widest transition-all ${
              filter === c
                ? 'bg-slate-950 text-white shadow-lg'
                : 'bg-white border border-slate-200 text-slate-500 hover:border-teal-400 hover:text-teal-600'
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {/* Asset Table */}
      <section className="bg-white rounded-[2.5rem] border border-slate-100 shadow-2xl shadow-indigo-500/5 overflow-hidden">
        <div className="p-8 border-b border-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-2 h-8 bg-teal-500 rounded-full" />
            <h3 className="text-lg font-black text-slate-900 uppercase tracking-widest">Asset Register</h3>
            <span className="text-[9px] font-black px-3 py-1 bg-slate-100 text-slate-500 rounded-full uppercase">{filtered.length} items</span>
          </div>
          <button className="px-6 py-3 bg-white border border-slate-200 text-[10px] font-black text-slate-500 uppercase tracking-widest rounded-xl hover:bg-slate-50 transition-all">
            Export CSV
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-50">
              <tr>
                <th className="px-8 py-6">Asset</th>
                <th className="px-8 py-6">Category</th>
                <th className="px-8 py-6">Assigned To</th>
                <th className="px-8 py-6">Date Assigned</th>
                <th className="px-8 py-6 text-right">Value (SGD)</th>
                <th className="px-8 py-6">Status</th>
                <th className="px-8 py-6 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map((a) => (
                <tr key={a.id} className="group hover:bg-slate-50/50 transition-all">
                  <td className="px-8 py-5">
                    <div className="flex flex-col">
                      <span className="text-xs font-black text-slate-900 uppercase tracking-tight group-hover:text-teal-600 transition-colors">{a.name}</span>
                      <span className="text-[9px] font-bold text-slate-400 uppercase mt-0.5">{a.id}</span>
                    </div>
                  </td>
                  <td className="px-8 py-5">
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{a.category}</span>
                  </td>
                  <td className="px-8 py-5">
                    {a.assignedTo ? (
                      <div>
                        <p className="text-[10px] font-black text-slate-700 uppercase">{a.assignedTo}</p>
                        <p className="text-[9px] font-bold text-slate-400 uppercase">{a.dept}</p>
                      </div>
                    ) : (
                      <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest">—</span>
                    )}
                  </td>
                  <td className="px-8 py-5">
                    <span className="text-[10px] font-black text-slate-400 uppercase">{a.assignedDate || '—'}</span>
                  </td>
                  <td className="px-8 py-5 text-right">
                    <span className="text-sm font-black text-slate-900 tracking-tight">${a.value.toLocaleString()}</span>
                  </td>
                  <td className="px-8 py-5">
                    <span className={`text-[9px] font-black px-3 py-1.5 rounded-full border uppercase tracking-widest ${statusStyle[a.status]}`}>
                      {a.status}
                    </span>
                  </td>
                  <td className="px-8 py-5 text-right">
                    <div className="flex justify-end gap-2">
                      <button className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-[9px] font-black text-slate-500 uppercase hover:border-teal-500 hover:text-teal-600 transition-all">
                        {a.status === 'Available' ? 'Assign' : 'Manage'}
                      </button>
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
