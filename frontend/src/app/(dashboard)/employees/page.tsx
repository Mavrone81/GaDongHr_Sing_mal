'use client';

import Link from 'next/link';
import { useState } from 'react';

export default function EmployeeDirectoryPage() {
  const [searchQuery, setSearchQuery] = useState('');

  const employees = [
    { id: 'EMP-001', name: 'John Doe', role: 'Software Engineer III', department: 'Engineering', type: 'Full-Time', status: 'Active', color: 'green' },
    { id: 'EMP-002', name: 'Jane Smith', role: 'Operations Manager', department: 'Operations', type: 'Full-Time', status: 'Active', color: 'green' },
    { id: 'EMP-003', name: 'Alice Chen', role: 'HR Business Partner', department: 'HR & Finance', type: 'Part-Time', status: 'On Leave', color: 'amber' },
    { id: 'EMP-004', name: 'David Lee', role: 'Sales Executive', department: 'Sales & Marketing', type: 'Contractor', status: 'Active', color: 'green' },
    { id: 'EMP-005', name: 'Sarah Wong', role: 'Product Designer', department: 'Engineering', type: 'Full-Time', status: 'Probation', color: 'blue' },
    { id: 'EMP-006', name: 'Michael Tan', role: 'QA Lead', department: 'Engineering', type: 'Full-Time', status: 'Terminated', color: 'red' },
  ];

  return (
    <div className="flex flex-col gap-6 max-w-[1600px] mx-auto pb-12">
      
      {/* Directory Header */}
      <div className="flex items-center justify-between bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Employee Directory</h2>
          <p className="text-sm text-gray-500 mt-1">Manage personnel records, onboarding compliance, and structural assignments.</p>
        </div>
        <div className="flex gap-3">
          <div className="relative">
            <input 
              type="text" 
              placeholder="Search employees by name, role, ID..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="rounded-md border border-gray-300 pl-9 pr-4 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none w-72"
            />
            <span className="absolute left-3 top-2.5 text-gray-400">🔍</span>
          </div>
          <button className="px-4 py-2 rounded-md text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 shadow-sm">
            Filter
          </button>
          <button className="px-4 py-2 rounded-md text-sm font-medium text-white bg-brand-600 hover:bg-brand-500 shadow-sm">
            + Onboard Employee
          </button>
        </div>
      </div>

      {/* Directory Table */}
      <section className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-gray-500 uppercase bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-4 font-semibold">Employee</th>
                <th className="px-6 py-4 font-semibold">Department</th>
                <th className="px-6 py-4 font-semibold">Type</th>
                <th className="px-6 py-4 font-semibold">Status</th>
                <th className="px-6 py-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {employees
                .filter(emp => 
                  emp.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                  emp.role.toLowerCase().includes(searchQuery.toLowerCase()) ||
                  emp.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
                  emp.department.toLowerCase().includes(searchQuery.toLowerCase())
                )
                .map((emp) => (
                <tr key={emp.id} className="hover:bg-gray-50/80 transition-colors group">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-full bg-brand-100 border border-brand-200 flex items-center justify-center text-xs font-bold text-brand-700">
                        {emp.name.split(' ').map(n => n[0]).join('')}
                      </div>
                      <div>
                        <div className="font-semibold text-gray-900">{emp.name}</div>
                        <div className="text-xs text-gray-500">{emp.role} • {emp.id}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-gray-600">{emp.department}</td>
                  <td className="px-6 py-4 text-gray-600">{emp.type}</td>
                  <td className="px-6 py-4">
                    <span className={`bg-${emp.color}-100 text-${emp.color}-800 text-xs font-semibold px-2.5 py-0.5 rounded-full border border-${emp.color}-200`}>
                      {emp.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <Link 
                      href={`/employees/${emp.id}`}
                      className="text-brand-600 hover:text-brand-800 font-medium text-xs border border-brand-200 px-3 py-1.5 rounded bg-white hover:bg-brand-50 transition-colors shadow-sm"
                    >
                      View Profile
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="p-4 border-t border-gray-200 flex items-center justify-between mx-2">
          <span className="text-sm text-gray-500">
            Showing <span className="font-semibold text-gray-900">
              {employees.filter(emp => emp.name.toLowerCase().includes(searchQuery.toLowerCase()) || emp.role.toLowerCase().includes(searchQuery.toLowerCase()) || emp.id.toLowerCase().includes(searchQuery.toLowerCase()) || emp.department.toLowerCase().includes(searchQuery.toLowerCase())).length}
            </span> matching employees
          </span>
          <div className="flex gap-1">
            <button className="px-3 py-1 border border-gray-300 rounded text-sm text-gray-500 disabled:opacity-50">Previous</button>
            <button className="px-3 py-1 border border-gray-300 rounded text-sm text-gray-700 bg-white hover:bg-gray-50">Next</button>
          </div>
        </div>
      </section>

    </div>
  );
}
