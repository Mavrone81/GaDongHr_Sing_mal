"use client";

import Link from 'next/link';
import { useState } from 'react';

export default function EmployeeProfilePage({ params }: { params: { id: string } }) {
  const [isEditing, setIsEditing] = useState(false);

  return (
    <div className="flex flex-col gap-6 max-w-[1600px] mx-auto pb-12">
      
      {/* Profile Header Breadcrumbs */}
      <div className="flex items-center justify-between bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
        <div className="flex items-center gap-3">
          <Link href="/employees" className="text-sm font-medium text-gray-500 hover:text-brand-600 flex items-center gap-1 bg-gray-50 border border-gray-200 px-2 py-1 rounded transition-colors">
            ← Back to Directory
          </Link>
          <span className="text-gray-300">/</span>
          <h2 className="text-lg font-bold text-gray-900 tracking-tight">Profile Details</h2>
        </div>
        <div className="flex gap-3">
          {!isEditing ? (
            <button onClick={() => setIsEditing(true)} className="px-4 py-1.5 rounded border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 shadow-sm transition-colors">Edit Record</button>
          ) : (
             <div className="flex gap-3">
              <button onClick={() => setIsEditing(false)} className="px-4 py-1.5 rounded border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 shadow-sm transition-colors">Cancel</button>
              <button onClick={() => setIsEditing(false)} className="px-4 py-1.5 rounded text-sm font-medium text-white bg-brand-600 hover:bg-brand-500 shadow-sm transition-colors">Save Changes</button>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        
        {/* Left Column (2 spans wide) */}
        <div className="xl:col-span-2 flex flex-col gap-6">
          
          {/* Active Profile Header Mockup */}
          <section className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm flex items-start gap-6 relative">
            <div className="absolute top-6 right-6 flex gap-3">
              <select className="appearance-none bg-green-50 text-green-800 text-xs font-semibold px-3 py-1 rounded-full border border-green-200 hover:bg-green-100 cursor-pointer outline-none shadow-sm transition-colors">
                <option value="active">Active</option>
                <option value="probation">Probation</option>
                <option value="on_leave">On Leave</option>
                <option value="deactivated" className="text-red-700 font-bold">Deactivated</option>
                <option value="terminated" className="text-red-700 font-bold">Terminated</option>
              </select>
              
              <select className="appearance-none bg-blue-50 text-blue-800 text-xs font-semibold px-3 py-1 rounded-full border border-blue-200 hover:bg-blue-100 cursor-pointer outline-none shadow-sm transition-colors">
                <option value="full_time">Full-Time</option>
                <option value="part_time">Part-Time</option>
                <option value="contractor">Contract Staff</option>
                <option value="intern">Intern</option>
              </select>
            </div>
            <div className="h-24 w-24 rounded-full bg-gray-100 border-2 border-gray-200 shadow-inner flex items-center justify-center flex-shrink-0">
               <span className="text-2xl font-bold text-gray-400">JD</span>
            </div>
            <div>
              <h3 className="text-xl font-bold text-gray-900">John Doe</h3>
              <p className="text-sm text-gray-500 mt-0.5">Software Engineer III • Engineering Department</p>
              
              <div className="flex items-center gap-6 mt-4">
                <div className="text-sm">
                  <span className="text-gray-500 block text-xs">Work Email</span>
                  <span className="font-medium text-gray-900">john.doe@ezyhrm.sg</span>
                </div>
                <div className="text-sm">
                  <span className="text-gray-500 block text-xs">Mobile</span>
                  <span className="font-medium text-gray-900">+65 9123 4567</span>
                </div>
                <div className="text-sm">
                  <span className="text-gray-500 block text-xs">Joining Date</span>
                  <span className="font-medium text-gray-900">01 Jun 2022</span>
                </div>
              </div>
            </div>
          </section>

          {/* Personal Details */}
          <section className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
            <h3 className="mb-4 text-sm font-semibold text-gray-800 uppercase tracking-wider border-b border-gray-100 pb-2">Personal Identity Requirements</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-500 uppercase">First Name</label>
                <input type="text" className={`w-full rounded-md border px-3 py-1.5 text-sm outline-none transition-colors ${isEditing ? 'border-brand-300 bg-white focus:ring-2 focus:ring-brand-500 cursor-text' : 'border-gray-200 bg-gray-50'}`} defaultValue="John" readOnly={!isEditing} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-500 uppercase">Last Name</label>
                <input type="text" className={`w-full rounded-md border px-3 py-1.5 text-sm outline-none transition-colors ${isEditing ? 'border-brand-300 bg-white focus:ring-2 focus:ring-brand-500 cursor-text' : 'border-gray-200 bg-gray-50'}`} defaultValue="Doe" readOnly={!isEditing} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-500 uppercase">Nationality</label>
                <input type="text" className={`w-full rounded-md border px-3 py-1.5 text-sm outline-none transition-colors ${isEditing ? 'border-brand-300 bg-white focus:ring-2 focus:ring-brand-500 cursor-text' : 'border-gray-200 bg-gray-50'}`} defaultValue="Singaporean" readOnly={!isEditing} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-500 uppercase">NRIC / FIN</label>
                <div className="relative">
                  <input type="password" className={`w-full rounded-md border px-3 py-1.5 text-sm outline-none transition-colors pr-8 ${isEditing ? 'border-brand-300 bg-white focus:ring-2 focus:ring-brand-500 cursor-text' : 'border-gray-200 bg-gray-50'}`} defaultValue="S1234567A" readOnly={!isEditing} />
                  <button className="absolute right-2 top-1.5 text-gray-400">👁️</button>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-500 uppercase">Date of Birth</label>
                <input type="date" className={`w-full rounded-md border px-3 py-1.5 text-sm outline-none transition-colors ${isEditing ? 'border-brand-300 bg-white focus:ring-2 focus:ring-brand-500 cursor-text' : 'border-gray-200 bg-gray-50'}`} defaultValue="1990-01-01" readOnly={!isEditing} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-500 uppercase">Marital Status</label>
                <select className={`w-full rounded-md border px-3 py-1.5 text-sm outline-none transition-colors ${isEditing ? 'border-brand-300 bg-white focus:ring-2 focus:ring-brand-500 cursor-pointer appearance-auto' : 'border-gray-200 bg-gray-50 appearance-none pointer-events-none'}`} defaultValue="Single">
                  <option value="Single">Single</option>
                  <option value="Married">Married</option>
                  <option value="Divorced">Divorced</option>
                  <option value="Widowed">Widowed</option>
                </select>
              </div>
            </div>
          </section>

          {/* Org Structure */}
          <section className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
            <h3 className="mb-4 text-sm font-semibold text-gray-800 uppercase tracking-wider border-b border-gray-100 pb-2">Organizational Placement</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-500 uppercase">Direct Manager</label>
                <input type="text" className="w-full rounded-md border border-brand-200 px-3 py-1.5 text-sm outline-none bg-brand-50" defaultValue="Jane Smith (CTO)" readOnly />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-500 uppercase">Cost Center</label>
                <input type="text" className="w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm outline-none bg-gray-50" defaultValue="CC-TECH-001" readOnly />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-500 uppercase">Work Location</label>
                <input type="text" className="w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm outline-none bg-gray-50" defaultValue="Singapore HQ" readOnly />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-500 uppercase">Standard Hours</label>
                <input type="text" className="w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm outline-none bg-gray-50" defaultValue="40 Hours / Week" readOnly />
              </div>
            </div>
          </section>

        </div>

        {/* Right Column (1 span wide) */}
        <div className="flex flex-col gap-6">
          
          {/* Document Checks */}
          <section className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
            <h3 className="mb-4 text-sm font-semibold text-gray-800 uppercase tracking-wider border-b border-gray-100 pb-2">Onboarding Checklist</h3>
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-3 text-sm text-gray-700 cursor-pointer hover:bg-gray-50 p-1.5 rounded-md transition-colors">
                <input type="checkbox" defaultChecked className="w-4 h-4 text-brand-600 rounded border-gray-300 focus:ring-brand-500" />
                Employment Contract Signed
              </label>
              <label className="flex items-center gap-3 text-sm text-gray-700 cursor-pointer hover:bg-gray-50 p-1.5 rounded-md transition-colors">
                <input type="checkbox" defaultChecked className="w-4 h-4 text-brand-600 rounded border-gray-300 focus:ring-brand-500" />
                Bank Details Provided
              </label>
              <label className="flex items-center gap-3 text-sm text-gray-700 cursor-pointer hover:bg-gray-50 p-1.5 rounded-md transition-colors">
                <input type="checkbox" className="w-4 h-4 text-brand-600 rounded border-gray-300 focus:ring-brand-500" />
                NRIC Copy Uploaded
              </label>
              <label className="flex items-center gap-3 text-sm text-gray-700 cursor-pointer hover:bg-gray-50 p-1.5 rounded-md transition-colors">
                <input type="checkbox" className="w-4 h-4 text-brand-600 rounded border-gray-300 focus:ring-brand-500" />
                Equipment Handover Signed
              </label>
            </div>
            <div className="mt-4 pt-3 border-t border-gray-100">
              <div className="w-full bg-gray-100 rounded-full h-2">
                <div className="bg-brand-500 h-2 rounded-full" style={{ width: '50%' }}></div>
              </div>
              <p className="text-xs text-right text-brand-600 font-medium mt-1">2 / 4 Items (50%)</p>
            </div>
          </section>

          {/* Statutory Constraints */}
           <section className="bg-brand-50 rounded-lg border border-brand-200 shadow-sm p-5">
            <h3 className="mb-4 text-sm font-semibold text-brand-800 uppercase tracking-wider border-b border-brand-200 pb-2">Statutory Attributes</h3>
            <div className="flex flex-col gap-3">
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-600">CPF Contribution</span>
                <span className="font-medium text-gray-900 bg-white px-2 py-0.5 border border-brand-200 rounded">Enabled</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-600">SDL Payable</span>
                <span className="font-medium text-gray-900">Standard Base</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-600">Tax Setup</span>
                <span className="font-medium text-gray-900">IR8A Auto-Include</span>
              </div>
            </div>
            <button className="mt-4 w-full py-1.5 text-sm font-medium text-brand-700 bg-white border border-brand-200 rounded hover:bg-brand-100 transition-colors">
              Manage Constraints
            </button>
          </section>

        </div>
      </div>
    </div>
  );
}
