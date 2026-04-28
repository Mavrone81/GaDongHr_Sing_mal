'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';

interface Employee {
  id: string;
  employeeCode: string;
  fullName: string;
  preferredName?: string;
  workEmail: string;
  workPhone?: string;
  department: string;
  designation: string;
  employmentType: string;
  startDate: string;
  isActive: boolean;
  nationality: string;
  nricEncrypted: string;
  dateOfBirth: string;
  maritalStatus: string;
  weeklyHours?: number;
  costCentre?: string;
  homeAddressEncrypted?: string;
  basicSalaryEncrypted?: string;
  bankName?: string;
  bankAccountEncrypted?: string;
}

export default function EmployeeDetail({ params }: { params: { id: string } }) {
  const { hasPermission } = useAuth();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [showNric, setShowNric] = useState(false);

  const [checklist, setChecklist] = useState([
    { id: 1, label: 'Employment Contract Signed', completed: true },
    { id: 2, label: 'Bank Details Provided', completed: true },
    { id: 3, label: 'NRIC / Work Pass Copy', completed: false },
    { id: 4, label: 'Equipment Handover', completed: false },
    { id: 5, label: 'Statutory Declaration', completed: false },
  ]);

  const [activeTab, setActiveTab] = useState<'info' | 'statutory' | 'documents'>('info');

  const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

  useEffect(() => {
    const fetchEmployee = async () => {
      try {
        const token = document.cookie.split('ezyhrm_token=')[1]?.split(';')[0];
        let res = await fetch(`${apiBaseUrl}/employees/${params.id}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) {
          res = await fetch(`${apiBaseUrl}/employees/code/${params.id}`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
        }

        if (res.ok) {
          setEmployee(await res.json());
        }
      } catch (err) {
        console.error('Failed to fetch employee:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchEmployee();
  }, [params.id, apiBaseUrl]);

  if (loading) return (
    <div className="p-20 text-center flex flex-col items-center gap-4">
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-600"></div>
      <p className="text-xs font-bold text-slate-400 uppercase tracking-widest animate-pulse">Syncing Employee Records...</p>
    </div>
  );
  if (!employee) return <div className="p-20 text-center text-red-600">Employee record not found in persistence layer.</div>;

  const initials = employee.fullName.split(' ').map(n => n[0]).join('').toUpperCase();
  const completionRate = Math.round((checklist.filter(c => c.completed).length / checklist.length) * 100);

  return (
    <div className="flex flex-col gap-6 max-w-[1600px] mx-auto pb-12">
      
      {/* Profile Header Breadcrumbs */}
      <div className="flex items-center justify-between bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-3">
          <Link href="/employees" className="text-[10px] font-black text-slate-500 hover:text-indigo-600 flex items-center gap-1 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded uppercase tracking-widest transition-all">
            ← Directory
          </Link>
          <span className="text-slate-300">/</span>
          <h2 className="text-sm font-black text-slate-800 uppercase tracking-widest">{employee.fullName} <span className="text-slate-400 font-bold ml-2">[{employee.employeeCode}]</span></h2>
        </div>
        <div className="flex gap-3">
          <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Profile Health:</span>
            <div className="w-24 h-1.5 bg-slate-200 rounded-full overflow-hidden">
               <div className="h-full bg-indigo-600" style={{ width: `${completionRate}%` }}></div>
            </div>
            <span className="text-[10px] font-black text-indigo-600">{completionRate}%</span>
          </div>
          {hasPermission('employee:manage') && (
            !isEditing ? (
              <button onClick={() => setIsEditing(true)} className="px-5 py-2 rounded-lg border border-slate-200 text-[10px] font-black text-slate-600 hover:bg-slate-50 shadow-sm transition-all uppercase tracking-widest">Edit Record</button>
            ) : (
               <div className="flex gap-3">
                <button onClick={() => setIsEditing(false)} className="px-5 py-2 rounded-lg border border-slate-200 text-[10px] font-black text-slate-600 hover:bg-slate-50 shadow-sm transition-all uppercase tracking-widest">Cancel</button>
                <button onClick={() => setIsEditing(false)} className="px-5 py-2 rounded-lg text-[10px] font-black text-white bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-500/20 transition-all uppercase tracking-widest">Save Changes</button>
              </div>
            )
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        
        {/* Left Column (3 spans wide) */}
        <div className="xl:col-span-3 flex flex-col gap-6">
          
          <section className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm flex items-start gap-8 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-indigo-600"></div>
            <div className="h-32 w-32 rounded-3xl bg-slate-900 border-4 border-slate-800 shadow-2xl shadow-indigo-500/10 flex items-center justify-center flex-shrink-0 relative overflow-hidden group">
               <div className="absolute inset-0 bg-indigo-600 opacity-0 group-hover:opacity-10 transition-opacity underline cursor-pointer"></div>
               <span className="text-4xl font-black text-white tracking-widest">{initials}</span>
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <h3 className="text-2xl font-black text-slate-900 tracking-tight">{employee.fullName}</h3>
                <span className={`px-3 py-1 rounded-full text-[9px] font-black border uppercase tracking-widest ${employee.isActive ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                  {employee.isActive ? 'Active Duty' : 'Inactive'}
                </span>
              </div>
              <p className="text-sm font-bold text-slate-400 mt-1 uppercase tracking-widest">{employee.designation} <span className="mx-2 opacity-30">|</span> {employee.department}</p>
              
              <div className="grid grid-cols-3 gap-8 mt-8 pb-2">
                <div className="text-sm">
                  <span className="text-slate-400 block text-[10px] font-black uppercase tracking-widest mb-1.5 grayscale opacity-70">Work Identity</span>
                  <span className="font-bold text-slate-900 break-all">{employee.workEmail}</span>
                </div>
                <div className="text-sm">
                  <span className="text-slate-400 block text-[10px] font-black uppercase tracking-widest mb-1.5 grayscale opacity-70">Mobile Reference</span>
                  <span className="font-bold text-slate-900">{employee.workPhone || 'Unlisted'}</span>
                </div>
                <div className="text-sm">
                  <span className="text-slate-400 block text-[10px] font-black uppercase tracking-widest mb-1.5 grayscale opacity-70">Enrolment Date</span>
                  <span className="font-bold text-slate-900 uppercase">{new Date(employee.startDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                </div>
              </div>
            </div>
          </section>

          {/* Tabbed Detail Section */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden min-h-[400px]">
             <div className="border-b border-slate-100 flex px-8 text-[11px] font-black uppercase tracking-[0.2em] bg-slate-50/50">
                <button 
                  onClick={() => setActiveTab('info')}
                  className={`py-5 border-b-2 transition-all mr-10 ${activeTab === 'info' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
                >
                  General Profile
                </button>
                <button 
                  onClick={() => setActiveTab('statutory')}
                  className={`py-5 border-b-2 transition-all mr-10 ${activeTab === 'statutory' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
                >
                  Statutory & Compliance
                </button>
                <button 
                  onClick={() => setActiveTab('documents')}
                  className={`py-5 border-b-2 transition-all ${activeTab === 'documents' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
                >
                  Document Archive
                </button>
             </div>

             <div className="p-8">
                {activeTab === 'info' && (
                  <div className="flex flex-col gap-10">
                    <section>
                      <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-6 flex items-center gap-3">
                        <div className="w-1.5 h-4 bg-indigo-600 rounded-full"></div>
                        National Identity Metadata
                      </h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        <div className="flex flex-col gap-2">
                          <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Legal Nationality</label>
                          <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 text-sm font-bold text-slate-900">{employee.nationality}</div>
                        </div>
                        <div className="flex flex-col gap-2">
                          <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">NRIC / FIN (Encrypted)</label>
                          <div className="bg-slate-900 border border-slate-800 rounded-lg px-4 py-2.5 text-sm font-bold text-indigo-400 relative flex items-center justify-between">
                            <span className="tracking-widest">{showNric ? employee.nricEncrypted : '•••• •••• •••'}</span>
                            <button onClick={() => setShowNric(!showNric)} className="text-indigo-400/50 hover:text-indigo-400">
                              {showNric ? 'Hide' : 'Reveal'}
                            </button>
                          </div>
                        </div>
                        <div className="flex flex-col gap-2">
                          <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Birth Registry Date</label>
                          <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 text-sm font-bold text-slate-900 uppercase tracking-tight">{new Date(employee.dateOfBirth).toLocaleDateString()}</div>
                        </div>
                        <div className="flex flex-col gap-2">
                          <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Marital Status</label>
                          <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 text-sm font-bold text-slate-900 uppercase">{employee.maritalStatus}</div>
                        </div>
                      </div>
                    </section>

                    <section>
                      <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-6 flex items-center gap-3">
                        <div className="w-1.5 h-4 bg-indigo-600 rounded-full"></div>
                        Organizational Structure
                      </h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        <div className="flex flex-col gap-2">
                          <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Financial Cost Center</label>
                          <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 text-sm font-bold text-slate-900 uppercase">{employee.costCentre || 'Global Base'}</div>
                        </div>
                        <div className="flex flex-col gap-2">
                          <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Contractual Model</label>
                          <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 text-sm font-bold text-slate-900 uppercase leading-none">{employee.employmentType.replace('_', ' ')}</div>
                        </div>
                        <div className="flex flex-col gap-2">
                          <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Statutory Weekly Hours</label>
                          <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 text-sm font-bold text-slate-900 uppercase">{employee.weeklyHours || 44} / Standard</div>
                        </div>
                      </div>
                    </section>
                  </div>
                )}

                {activeTab === 'statutory' && (
                  <div className="flex flex-col gap-8 animate-in fade-in slide-in-from-bottom-5 duration-300">
                    <section className="bg-slate-50 p-8 rounded-2xl border border-dashed border-slate-300">
                      <div className="flex items-center justify-between mb-8">
                        <div>
                           <h4 className="text-[11px] font-black text-slate-900 uppercase tracking-widest">CPF Contribution Configuration</h4>
                           <p className="text-[10px] text-slate-500 font-bold uppercase mt-1">Applying Central Provident Fund Board statutory rates</p>
                        </div>
                        <div className="flex items-center gap-2 px-3 py-1 bg-white border border-slate-200 rounded-full">
                           <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span>
                           <span className="text-[9px] font-black text-emerald-600 uppercase">Computed Active</span>
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                         <div className="space-y-4">
                            <label className="flex items-center gap-4 cursor-pointer p-4 bg-white rounded-xl border border-slate-200 hover:border-indigo-600 transition-all">
                              <input type="checkbox" defaultChecked className="w-5 h-5 text-indigo-600 rounded-md border-slate-300 focus:ring-indigo-500" />
                              <div className="flex flex-col">
                                 <span className="text-xs font-black text-slate-900 uppercase">Enable Ordinary Wages (OW) Calc</span>
                                 <span className="text-[9px] text-slate-400 font-bold uppercase mt-0.5">Subject to $6,000 ceiling</span>
                              </div>
                            </label>
                            <label className="flex items-center gap-4 cursor-pointer p-4 bg-white rounded-xl border border-slate-200 hover:border-indigo-600 transition-all">
                              <input type="checkbox" defaultChecked className="w-5 h-5 text-indigo-600 rounded-md border-slate-300 focus:ring-indigo-500" />
                              <div className="flex flex-col">
                                 <span className="text-xs font-black text-slate-900 uppercase tracking-tight">Enable Additional Wages (AW) Calc</span>
                                 <span className="text-[9px] text-slate-400 font-bold uppercase mt-0.5">Annual ceiling formula protection</span>
                              </div>
                            </label>
                         </div>
                         <div className="bg-white p-6 rounded-xl border border-slate-200">
                            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-4">Citizenship Compliance Category</label>
                            <div className="flex flex-col gap-3">
                               <button className="flex items-center justify-between px-4 py-2 bg-indigo-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest">
                                  <span>Singapore Citizen (SC) / SPR 3rd Year+</span>
                                  <span>Full rates apply</span>
                               </button>
                               <button className="flex items-center justify-between px-4 py-2 border border-slate-200 text-slate-400 rounded-lg text-[10px] font-black uppercase tracking-widest hover:border-indigo-600 hover:text-indigo-600 transition-all">
                                  <span>Singapore Permanent Resident (SPR) Yr 2</span>
                                  <span>Partial Rates</span>
                               </button>
                               <button className="flex items-center justify-between px-4 py-2 border border-slate-200 text-slate-400 rounded-lg text-[10px] font-black uppercase tracking-widest hover:border-indigo-600 hover:text-indigo-600 transition-all">
                                  <span>Foreigner / Other</span>
                                  <span>No CPF</span>
                               </button>
                            </div>
                         </div>
                      </div>
                    </section>

                    <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
                       <div className="bg-indigo-50/50 p-6 rounded-2xl border border-indigo-100">
                          <h4 className="text-[10px] font-black text-indigo-700 uppercase tracking-widest mb-4">SDL Management</h4>
                          <label className="flex items-center gap-3 cursor-pointer">
                             <input type="checkbox" defaultChecked className="w-5 h-5 text-indigo-600 rounded-md border-indigo-200 focus:ring-indigo-500" />
                             <span className="text-[11px] font-black text-slate-700 uppercase">Apply Skills Development Levy (0.25%)</span>
                          </label>
                          <p className="text-[9px] text-indigo-400 font-bold uppercase mt-3 leading-relaxed">Capped at SGD 11.25 per individual per month per organisation.</p>
                       </div>
                       <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800">
                           <h4 className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-4">Tax & IR8A AIS Integration</h4>
                           <div className="flex flex-col gap-4">
                              <p className="text-[10px] text-slate-400 font-bold uppercase leading-relaxed">Auto-include in annual Auto-Inclusion Scheme (AIS) reporting for IRAS.</p>
                              <div className="flex gap-2">
                                <span className="text-[9px] font-black px-2 py-0.5 bg-indigo-600 text-white rounded">IRIS-READY</span>
                                <span className="text-[9px] font-black px-2 py-0.5 bg-slate-800 text-slate-400 rounded">AIS-2026-V1</span>
                              </div>
                           </div>
                       </div>
                    </section>
                  </div>
                )}

                {activeTab === 'documents' && (
                  <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-5 duration-300">
                     <div className="flex justify-between items-center mb-4">
                        <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">System Attachment Archive</h4>
                        <button className="text-[10px] font-black uppercase text-indigo-600 bg-indigo-50 px-4 py-2 rounded-lg hover:bg-indigo-100 transition-all">+ Upload Secure Document</button>
                     </div>
                     
                     <div className="overflow-hidden border border-slate-200 rounded-2xl shadow-sm">
                        <table className="w-full text-left">
                           <thead>
                              <tr className="bg-slate-50 text-[9px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-200">
                                <th className="px-6 py-4">Document Designation</th>
                                <th className="px-6 py-4">Category</th>
                                <th className="px-6 py-4">Security Level</th>
                                <th className="px-6 py-4">Expiry Date</th>
                                <th className="px-6 py-4 text-right">Reference</th>
                              </tr>
                           </thead>
                           <tbody className="divide-y divide-slate-100 text-xs">
                              <tr className="hover:bg-slate-50/50 transition-all">
                                <td className="px-6 py-4">
                                  <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded bg-red-50 flex items-center justify-center text-red-500 font-black text-[9px]">PDF</div>
                                    <span className="font-bold text-slate-900">Employment_Contract_Signed_Final.pdf</span>
                                  </div>
                                </td>
                                <td className="px-6 py-4"><span className="text-[9px] font-black uppercase text-slate-500 border border-slate-200 px-2 py-0.5 rounded">Contract</span></td>
                                <td className="px-6 py-4"><span className="text-[9px] font-black uppercase text-red-600 bg-red-50 px-2 py-0.5 rounded">High (Enc)</span></td>
                                <td className="px-6 py-4 text-slate-400 font-bold uppercase">Permanent</td>
                                <td className="px-6 py-4 text-right">
                                  <button className="text-indigo-600 hover:underline font-black uppercase text-[9px]">Interface: View</button>
                                </td>
                              </tr>
                              <tr className="hover:bg-slate-50/50 transition-all">
                                <td className="px-6 py-4">
                                  <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded bg-blue-50 flex items-center justify-center text-blue-500 font-black text-[9px]">IMG</div>
                                    <span className="font-bold text-slate-900">NRIC_Front_Scan.jpg</span>
                                  </div>
                                </td>
                                <td className="px-6 py-4"><span className="text-[9px] font-black uppercase text-slate-500 border border-slate-200 px-2 py-0.5 rounded">Identification</span></td>
                                <td className="px-6 py-4"><span className="text-[9px] font-black uppercase text-red-600 bg-red-50 px-2 py-0.5 rounded">High (Enc)</span></td>
                                <td className="px-6 py-4 text-slate-400 font-bold uppercase">31 Dec 2030</td>
                                <td className="px-6 py-4 text-right">
                                  <button className="text-indigo-600 hover:underline font-black uppercase text-[9px]">Interface: View</button>
                                </td>
                              </tr>
                           </tbody>
                        </table>
                     </div>
                  </div>
                )}
             </div>
          </div>

        </div>

        {/* Right Column (1 span wide) */}
        <div className="flex flex-col gap-6">
          
          {/* Onboarding Health / Advanced Checklist */}
          <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 relative overflow-hidden">
            <div className="absolute top-0 right-0 p-1 bg-indigo-600/5 rounded-bl-xl text-indigo-600 font-black text-[9px] uppercase tracking-widest px-2 py-1 border-b border-l border-indigo-100">Lifecycle Engine</div>
            <h3 className="mb-6 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-100 pb-3">Onboarding Compliance</h3>
            
            <div className="flex flex-col gap-1.5">
              {checklist.map((item) => (
                <button 
                  key={item.id}
                  onClick={() => {
                    setChecklist(checklist.map(c => c.id === item.id ? { ...c, completed: !c.completed } : c));
                  }}
                  className={`flex items-center gap-4 p-3 rounded-xl border transition-all text-left ${
                    item.completed 
                      ? 'bg-indigo-50/50 border-indigo-100 text-slate-900' 
                      : 'border-slate-100 text-slate-400 hover:border-indigo-300'
                  }`}
                >
                  <div className={`w-5 h-5 rounded-md border flex items-center justify-center transition-all ${
                    item.completed ? 'bg-indigo-600 border-indigo-600 shadow-lg shadow-indigo-500/20' : 'bg-white border-slate-200'
                  }`}>
                    {item.completed && (
                      <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>
                    )}
                  </div>
                  <div className="flex flex-col">
                    <span className={`text-[10px] font-black uppercase tracking-tight ${item.completed ? 'opacity-100' : 'opacity-70'}`}>{item.label}</span>
                    <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">{item.completed ? 'Verified' : 'Pending Upload'}</span>
                  </div>
                </button>
              ))}
            </div>
          </section>

          {/* Sensitive Asset Lockdown (Quick Info) */}
          <section className="bg-slate-900 rounded-2xl border border-slate-800 shadow-xl p-6">
            <h3 className="mb-6 text-[10px] font-black text-indigo-400 uppercase tracking-[0.2em] border-b border-slate-800 pb-3">Financial Nexus</h3>
            
            {(hasPermission('payroll:view') || hasPermission('employee:sensitive')) ? (
              <div className="flex flex-col gap-6">
                <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700/50">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Base Compensation</span>
                    <span className="text-[8px] font-black text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded">Encrypted</span>
                  </div>
                  <p className="text-xl font-black text-white tracking-widest">
                    {showNric ? `$ ${employee.basicSalaryEncrypted || '****'}.00` : '$ •••• •••'}
                  </p>
                </div>
                <div className="space-y-4">
                  <div className="flex justify-between items-center text-[10px] font-bold uppercase border-b border-slate-800 pb-2">
                    <span className="text-slate-500">Bank Handler</span>
                    <span className="text-slate-300">{employee.bankName || 'OCBC SINGAPORE'}</span>
                  </div>
                  <div className="flex justify-between items-center text-[10px] font-bold uppercase border-b border-slate-800 pb-2">
                    <span className="text-slate-500">Global Account ID</span>
                    <span className="text-slate-300 tracking-widest">{showNric ? employee.bankAccountEncrypted : '•••• •••• ••'}</span>
                  </div>
                </div>
                <button className="w-full py-3 bg-indigo-600 text-white text-[10px] font-black uppercase tracking-[0.2em] rounded-xl shadow-lg shadow-indigo-500/10 hover:bg-indigo-700 transition-all">
                  Access Payroll Interface
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-6 text-center">
                 <div className="w-12 h-12 bg-slate-800 rounded-full flex items-center justify-center text-2xl mb-4 grayscale opacity-30 shadow-inner">🔒</div>
                 <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest leading-relaxed">Access Restricted:<br/>Insufficient clearance for<br/>sensitive financial nexus.</p>
              </div>
            )}
          </section>

        </div>
      </div>
    </div>
  );
}

