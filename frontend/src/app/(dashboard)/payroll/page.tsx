'use client';

import { useState, useMemo } from 'react';

export default function PayrollDashboard() {
  const [isRunModalOpen, setIsRunModalOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showSuccessToast, setShowSuccessToast] = useState(false);
  
  // States for refined interaction
  const [reviewRunData, setReviewRunData] = useState<any | null>(null);
  const [payslipPeriod, setPayslipPeriod] = useState<string | null>(null);
  const [actionToast, setActionToast] = useState<string | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const [runs, setRuns] = useState([
    { id: 'run-3', period: 'March 2026', status: 'Pending Approval', employees: 124, net: '$201,400.00', cpf: '$44,200.00', maker: 'John Admin' },
    { id: 'run-2', period: 'February 2026', status: 'Disbursed', employees: 121, net: '$198,250.00', cpf: '$43,500.00', maker: 'John Admin' },
    { id: 'run-1', period: 'January 2026', status: 'Disbursed', employees: 120, net: '$195,100.00', cpf: '$42,900.00', maker: 'John Admin' }
  ]);
  const [selectedPeriod, setSelectedPeriod] = useState('2026-04');
  const [processingGroup, setProcessingGroup] = useState('all');
  const [latestRunCount, setLatestRunCount] = useState(124);

  const mockEmployees = useMemo(() => {
    const top4 = [
      { name: 'Johnathan Lim', role: 'Engineering Lead', department: 'Engineering', company: 'EzyHRM Pte Ltd', base: 7800, allowance: 0, gross: 7800, empCpf: 1560, emprCpf: 1326, sdl: 11.25, net: 6240, citizenship: 'Singapore Citizen (SC)', ageRank: 'Under 55' },
      { name: 'Sarah Tan', role: 'Marketing Manager', department: 'Marketing', company: 'EzyHRM Pte Ltd', base: 5800, allowance: 262.50, gross: 6062.50, empCpf: 1212.50, emprCpf: 1030.63, sdl: 11.25, net: 4850.00, citizenship: 'Singapore Citizen (SC)', ageRank: 'Under 55' },
      { name: 'David Chen', role: 'Finance Director', department: 'Finance', company: 'EzyHRM Pte Ltd', base: 8500, allowance: 375, gross: 8875, empCpf: 1775, emprCpf: 1508.75, sdl: 11.25, net: 7100, citizenship: 'Singapore Citizen (SC)', ageRank: 'Under 55' },
      { name: 'Amanda Leong', role: 'HR Business Partner', department: 'Human Resources', company: 'EzyHRM Pte Ltd', base: 6500, allowance: 0, gross: 6500, empCpf: 1300, emprCpf: 1105, sdl: 11.25, net: 5200, citizenship: 'Singapore Citizen (SC)', ageRank: 'Under 55' }
    ];
    const departments = ['Engineering', 'Marketing', 'Finance', 'Human Resources', 'Sales', 'Operations'];
    const rest = Array.from({ length: 120 }).map((_, i) => ({
      name: `Employee ${i+5}`, role: 'Staff', department: departments[i % departments.length], company: 'EzyHRM Pte Ltd', base: 5000, allowance: 0, gross: 5000, empCpf: 1000, emprCpf: 850, sdl: 11.25, net: 4000, citizenship: 'Singapore Citizen (SC)', ageRank: 'Under 55'
    }));
    return [...top4, ...rest];
  }, []);

  const filteredEmployees = useMemo(() => {
    return mockEmployees.filter(emp => emp.name.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [mockEmployees, searchQuery]);

  const handleActionToast = (message: string) => {
    setActionToast(message);
    setTimeout(() => setActionToast(null), 3000);
  };

  const handleExecute = async () => {
    setIsProcessing(true);
    await new Promise(resolve => setTimeout(resolve, 2000));
    setIsProcessing(false);
    setIsRunModalOpen(false);
    
    let count = 124;
    let net = '$201,400.00';
    let cpf = '$44,200.00';
    if (processingGroup === 'full_time') { count = 85; net = '$150,000.00'; cpf = '$30,000.00'; }
    else if (processingGroup === 'contractors') { count = 32; net = '$15,400.00'; cpf = '$0.00'; }
    else if (processingGroup === 'management') { count = 7; net = '$36,000.00'; cpf = '$14,200.00'; }

    const [year, month] = selectedPeriod.split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1);
    const periodName = date.toLocaleString('default', { month: 'long' }) + ' ' + year;

    setRuns([{ id: 'run-' + Date.now().toString(), period: periodName, status: 'Pending Approval', employees: count, net, cpf, maker: 'John Admin' }, ...runs]);
    setLatestRunCount(count);
    
    setShowSuccessToast(true);
    setTimeout(() => setShowSuccessToast(false), 3000);
  };

  return (
    <div className="flex flex-col gap-10 max-w-[1600px] mx-auto pb-20 animate-in fade-in duration-700">
      
      {/* 1. Header (Strategic Finance) */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-8 bg-white p-10 rounded-[2.5rem] border border-slate-100 shadow-2xl shadow-indigo-500/5 relative overflow-hidden group">
        <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
           <div className="w-32 h-32 bg-indigo-600 rounded-full blur-3xl"></div>
        </div>
        
        <div className="flex flex-col gap-2 relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-2 h-2 bg-indigo-600 rounded-full"></div>
            <span className="text-[10px] font-black text-indigo-600 uppercase tracking-[0.4em]">Financial Settlement Layer</span>
          </div>
          <h1 className="text-4xl font-black text-slate-900 tracking-tighter">Payroll <span className="text-indigo-600">Nexus</span></h1>
          <p className="text-sm font-bold text-slate-400 mt-2 uppercase tracking-widest leading-relaxed max-w-xl">
            Sovereign salary disbursement, CPF/SDL statutory tracking, and automated GIRO bank generations.
          </p>
        </div>

        <div className="flex items-center gap-6 relative z-10">
           <div className="hidden lg:flex flex-col items-end justify-center px-6 border-r border-slate-100">
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Active Engine</span>
              <span className="text-[10px] font-black text-indigo-600 uppercase mt-1">SG-CPF-STABLE-2026</span>
           </div>
           <button 
             onClick={() => setIsRunModalOpen(true)}
             className="px-10 py-5 bg-indigo-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] hover:bg-indigo-700 shadow-2xl shadow-indigo-500/20 transition-all active:scale-95 flex items-center gap-3"
           >
              <span>⚡</span> Initiate Calculation Engine
           </button>
        </div>
      </div>

      {/* 2. Intelligence Stats (Statutory Metrics) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-2xl shadow-indigo-500/5 group hover:border-indigo-600/20 transition-all">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Pending Disbursement</p>
          <div className="flex items-end gap-3">
            <h3 className="text-4xl font-black text-slate-900 tracking-tighter">$245,600.00</h3>
            <span className="text-[10px] font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded uppercase mb-1.5">Live</span>
          </div>
          <div className="mt-8 flex items-center gap-4 pt-6 border-t border-slate-50">
            <div className="flex flex-col gap-1">
              <span className="text-[9px] font-black text-slate-400 uppercase">Net Pay</span>
              <span className="text-xs font-black text-slate-900">$201,400</span>
            </div>
            <div className="h-4 w-[1px] bg-slate-100"></div>
            <div className="flex flex-col gap-1">
              <span className="text-[9px] font-black text-slate-400 uppercase">Total CPF</span>
              <span className="text-xs font-black text-indigo-600">$44,200</span>
            </div>
          </div>
        </div>

        <div className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-2xl shadow-indigo-500/5 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/5 rounded-bl-full"></div>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Metric: YTD Disbursed</p>
          <h3 className="text-4xl font-black text-indigo-600 tracking-tighter">$1.2M</h3>
          <p className="text-[9px] font-black text-emerald-600 uppercase mt-8 flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span>
            Performance: ↑ 4.2% vs Prev Yr
          </p>
        </div>

        <div className="bg-slate-950 p-8 rounded-[2rem] border border-slate-800 shadow-2xl shadow-slate-900/10">
          <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-6">Statutory Protocol Queue</p>
          <div className="flex flex-col gap-3">
            <button className="flex items-center justify-between p-4 bg-slate-900 border border-slate-800 rounded-2xl hover:border-indigo-600 transition-all group">
               <span className="text-[10px] font-black text-slate-300 uppercase tracking-tight">CPF Submissions (Mar 2026)</span>
               <span className="text-[9px] font-black px-2 py-0.5 bg-amber-500 text-slate-950 rounded">Action Needed</span>
            </button>
            <button className="flex items-center justify-between p-4 bg-slate-900/50 border border-slate-800 rounded-2xl opacity-50 grayscale">
               <span className="text-[10px] font-black text-slate-500 uppercase tracking-tight italic">Bank GIRO (Draft Saved)</span>
               <span className="text-slate-700">→</span>
            </button>
          </div>
        </div>
      </div>

      {/* 3. Disbursement Ledger (History) */}
      <section className="bg-white rounded-[2.5rem] border border-slate-100 shadow-2xl shadow-indigo-500/5 overflow-hidden">
        <div className="p-8 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-4">
             <div className="w-2 h-8 bg-indigo-600 rounded-full"></div>
             <h3 className="text-lg font-black text-slate-900 uppercase tracking-widest">Historical Run Archive</h3>
          </div>
          <div className="flex gap-4">
            <button className="px-6 py-3 bg-white border border-slate-200 text-[10px] font-black text-slate-500 uppercase tracking-widest rounded-xl hover:bg-slate-50 transition-all">Refine Archive</button>
            <button className="px-6 py-3 bg-white border border-slate-200 text-[10px] font-black text-indigo-600 uppercase tracking-widest rounded-xl hover:bg-indigo-50 transition-all">Consolidated Export (CSV)</button>
          </div>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="text-[10px] text-slate-400 font-black uppercase tracking-[0.2em] border-b border-slate-100">
              <tr>
                <th className="px-8 py-8">Accounting Period</th>
                <th className="px-8 py-8">Status Registry</th>
                <th className="px-8 py-8">Population</th>
                <th className="px-8 py-8 text-right">Net Liquidity</th>
                <th className="px-8 py-8 text-right">Statutory (CPF)</th>
                <th className="px-8 py-8 text-center">Governance Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {runs.map((run, i) => (
                <tr key={run.id} className="group hover:bg-slate-50/50 transition-all duration-300">
                  <td className="px-8 py-6">
                     <span className="text-sm font-black text-slate-900 uppercase tracking-tighter group-hover:text-indigo-600 transition-colors">{run.period}</span>
                  </td>
                  <td className="px-8 py-6">
                    <span className={`text-[9px] font-black px-4 py-1.5 rounded-full uppercase tracking-widest border shadow-sm ${
                      run.status === 'Pending Approval' ? 'bg-amber-50 text-amber-600 border-amber-100' : 
                      run.status === 'Rejected' ? 'bg-red-50 text-red-600 border-red-100' : 
                      'bg-emerald-50 text-emerald-600 border-emerald-100'
                    }`}>
                      {run.status}
                    </span>
                  </td>
                  <td className="px-8 py-6">
                     <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{run.employees} Units</span>
                  </td>
                  <td className="px-8 py-6 text-right">
                     <span className="text-sm font-black text-slate-900 tracking-tighter">{run.net}</span>
                  </td>
                  <td className="px-8 py-6 text-right">
                     <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{run.cpf}</span>
                  </td>
                  <td className="px-8 py-6">
                    <div className="flex justify-center items-center">
                      {run.status === 'Pending Approval' ? (
                        <button 
                          onClick={() => setReviewRunData(run)} 
                          className="px-8 py-3 bg-indigo-600 text-white text-[9px] font-black uppercase tracking-widest rounded-xl hover:bg-indigo-700 shadow-xl shadow-indigo-500/10 transition-all active:scale-95"
                        >
                           Review Protocol
                        </button>
                      ) : run.status === 'Rejected' ? (
                        <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest italic opacity-50">Locked for Archive</span>
                      ) : (
                        <div className="flex items-center gap-3">
                          <button onClick={() => handleActionToast(`Encoding Bank Interface File...`)} className="px-4 py-2 bg-slate-900 text-white text-[9px] font-black uppercase tracking-widest rounded-lg hover:bg-slate-800 transition-all">GIRO</button>
                          <button onClick={() => handleActionToast(`Opening CPF E-Submit Portal...`)} className="px-4 py-2 bg-emerald-600 text-white text-[9px] font-black uppercase tracking-widest rounded-lg hover:bg-emerald-700 transition-all">FTP</button>
                          <button onClick={() => setPayslipPeriod(run.period)} className="px-4 py-2 bg-white border border-slate-200 text-[9px] font-black text-slate-400 uppercase tracking-widest rounded-lg hover:text-indigo-600 hover:border-indigo-600 transition-all">Payslips</button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      
      {/* Initiation Modal (Glassmorphism Overhaul) */}
      {isRunModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/40 backdrop-blur-md animate-in fade-in duration-300">
          <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-xl overflow-hidden border border-slate-100 animate-in slide-in-from-bottom-10">
            <div className="bg-slate-50 border-b border-slate-100 p-10 flex justify-between items-center">
              <div>
                <h3 className="text-2xl font-black text-slate-900 tracking-tighter uppercase">Initiate Engine</h3>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-2">Fiscal Cycle Alignment v2.4</p>
              </div>
              <button onClick={() => setIsRunModalOpen(false)} className="w-10 h-10 flex items-center justify-center bg-white border border-slate-200 rounded-2xl text-slate-400 hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-all font-black">&times;</button>
            </div>
            
            <div className="p-10 flex flex-col gap-8">
              <div className="flex flex-col gap-3">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Accounting Period (YYYY-MM)</label>
                <input 
                  type="month" 
                  value={selectedPeriod} 
                  onChange={e => setSelectedPeriod(e.target.value)} 
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-6 py-4 text-sm font-black text-slate-900 outline-none focus:border-indigo-600 transition-all" 
                />
              </div>
              
              <div className="flex flex-col gap-3">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Workforce Partition</label>
                <select 
                  value={processingGroup} 
                  onChange={e => setProcessingGroup(e.target.value)} 
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-6 py-4 text-sm font-black text-slate-900 outline-none focus:border-indigo-600 appearance-none cursor-pointer"
                >
                  <option value="all">Global Workforce (All Sectors)</option>
                  <option value="full_time">Personnel: Full-Time</option>
                  <option value="contractors">Personnel: Contractors</option>
                  <option value="management">Personnel: Executive</option>
                </select>
              </div>
              
              <div className="space-y-4 pt-4 border-t border-slate-50">
                <label className="flex items-center gap-4 cursor-pointer group">
                  <div className="relative">
                    <input type="checkbox" defaultChecked className="peer opacity-0 absolute inset-0 w-6 h-6 cursor-pointer" />
                    <div className="w-6 h-6 bg-slate-100 border border-slate-200 rounded-lg peer-checked:bg-indigo-600 peer-checked:border-indigo-600 transition-all flex items-center justify-center">
                       <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" d="M5 13l4 4L19 7"></path></svg>
                    </div>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[11px] font-black text-slate-900 uppercase group-hover:text-indigo-600 transition-colors">Apply Central Provident Fund (CPF)</span>
                    <span className="text-[9px] font-bold text-slate-400 uppercase mt-0.5 tracking-tight">Age-Band Compliance v2026.01</span>
                  </div>
                </label>
                
                <label className="flex items-center gap-4 cursor-pointer group">
                  <div className="relative">
                    <input type="checkbox" defaultChecked className="peer opacity-0 absolute inset-0 w-6 h-6 cursor-pointer" />
                    <div className="w-6 h-6 bg-slate-100 border border-slate-200 rounded-lg peer-checked:bg-indigo-600 peer-checked:border-indigo-600 transition-all flex items-center justify-center">
                       <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" d="M5 13l4 4L19 7"></path></svg>
                    </div>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[11px] font-black text-slate-900 uppercase group-hover:text-indigo-600 transition-colors">Apply Skills Development Levy (SDL)</span>
                    <span className="text-[9px] font-bold text-slate-400 uppercase mt-0.5 tracking-tight">Cap Protection: SGD 11.25</span>
                  </div>
                </label>
              </div>
            </div>
            
            <div className="bg-slate-50 border-t border-slate-100 p-10 flex justify-end gap-5">
               <button onClick={() => setIsRunModalOpen(false)} className="px-8 py-4 bg-white border border-slate-200 text-slate-500 font-black text-[10px] uppercase tracking-widest rounded-2xl hover:bg-slate-100 transition-all">Abort</button>
               <button 
                onClick={handleExecute} 
                disabled={isProcessing}
                className={`px-10 py-4 bg-indigo-600 text-white font-black text-[10px] uppercase tracking-[0.2em] rounded-2xl transition-all shadow-2xl shadow-indigo-500/20 flex items-center gap-3 active:scale-95 ${isProcessing ? 'opacity-70 pointer-events-none' : 'hover:bg-indigo-700'}`}
              >
                {isProcessing ? (
                  <>
                    <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    Simulating Compute...
                  </>
                ) : (
                  <><span>⚡</span> Execute Nexus Pipeline</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Review Run Modal (High Fidelity Overlay) */}
      {reviewRunData && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/60 backdrop-blur-xl p-8 animate-in fade-in duration-300">
          <div className="bg-white rounded-[3rem] shadow-2xl w-full max-w-4xl border border-slate-100 flex flex-col max-h-[90vh] animate-in slide-in-from-top-10 overflow-hidden">
            <div className="bg-slate-900 border-b border-slate-800 p-10 flex justify-between items-center shrink-0">
              <div className="flex gap-6 items-center">
                 <div className="w-14 h-14 bg-indigo-600 rounded-3xl flex items-center justify-center text-2xl font-black text-white shadow-2xl shadow-indigo-500/20 shadow-inner">R</div>
                 <div>
                    <h3 className="text-3xl font-black text-white tracking-tighter uppercase whitespace-nowrap">Review Protocol</h3>
                    <p className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.3em] mt-2">Fiscal Deployment: {reviewRunData.period}</p>
                 </div>
              </div>
              <button onClick={() => setReviewRunData(null)} className="w-12 h-12 flex items-center justify-center bg-slate-800 border border-slate-700 rounded-2xl text-slate-400 hover:text-white transition-all text-2xl">&times;</button>
            </div>
            
            <div className="p-10 overflow-y-auto space-y-12">
              <div className="grid grid-cols-3 gap-8">
                <div className="bg-indigo-50/50 p-8 rounded-[2rem] border border-indigo-100/50 relative group">
                   <div className="absolute top-0 right-0 p-2 opacity-5 group-hover:opacity-20 transition-all text-2xl">💰</div>
                   <p className="text-[9px] font-black text-indigo-600 uppercase tracking-widest mb-3">Gross Liquidity</p>
                   <h4 className="text-3xl font-black text-slate-900 tracking-tighter">{reviewRunData.net}</h4>
                </div>
                <div className="bg-emerald-50/50 p-8 rounded-[2rem] border border-emerald-100/50 relative group">
                   <div className="absolute top-0 right-0 p-2 opacity-5 group-hover:opacity-20 transition-all text-2xl">🏛️</div>
                   <p className="text-[9px] font-black text-emerald-600 uppercase tracking-widest mb-3">Statutory Burden</p>
                   <h4 className="text-3xl font-black text-slate-900 tracking-tighter">{reviewRunData.cpf}</h4>
                </div>
                <div className="bg-slate-50/50 p-8 rounded-[2rem] border border-slate-100 relative group">
                   <div className="absolute top-0 right-0 p-2 opacity-5 group-hover:opacity-20 transition-all text-2xl">👥</div>
                   <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3">Active Population</p>
                   <h4 className="text-3xl font-black text-slate-900 tracking-tighter">{reviewRunData.employees}</h4>
                </div>
              </div>

              <div className="space-y-6">
                 <div className="flex items-center gap-4">
                    <div className="w-8 h-1 bg-indigo-600 rounded-full"></div>
                    <h4 className="text-[11px] font-black text-slate-900 uppercase tracking-[0.2em]">Sovereign Computation Breakdown</h4>
                 </div>
                 
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="bg-white rounded-[2rem] border border-slate-100 overflow-hidden shadow-xl shadow-slate-900/5">
                       <div className="p-6 bg-slate-50 border-b border-slate-100 flex justify-between uppercase">
                          <span className="text-[9px] font-black text-slate-400 tracking-widest">Component Ledger</span>
                          <span className="text-[9px] font-black text-slate-900">Computed Multiplier</span>
                       </div>
                       <div className="p-8 space-y-4">
                          <div className="flex justify-between items-center">
                             <span className="text-xs font-bold text-slate-500 uppercase tracking-tight">Ordinary Wages (OW)</span>
                             <span className="text-xs font-black text-slate-900">$245,600.00</span>
                          </div>
                          <div className="flex justify-between items-center text-red-500">
                             <span className="text-xs font-bold uppercase tracking-tight italic">Employee CPF (Deducted)</span>
                             <span className="text-xs font-black">-$44,200.00</span>
                          </div>
                          <div className="pt-4 border-t border-slate-50 flex justify-between items-center">
                             <span className="text-xs font-black text-indigo-600 uppercase tracking-widest">Net Payable Total</span>
                             <span className="text-sm font-black text-indigo-600">$201,400.00</span>
                          </div>
                       </div>
                    </div>
                    
                    <div className="bg-indigo-950 p-8 rounded-[2rem] border border-indigo-900 flex flex-col justify-center gap-6 relative overflow-hidden">
                       <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-600/10 rounded-full blur-3xl"></div>
                       <div className="flex flex-col gap-2">
                          <span className="text-[9px] font-black text-indigo-400 uppercase tracking-widest leading-none">Global Cost of Workforce</span>
                          <span className="text-4xl font-black text-white tracking-tighter leading-none">$284,569.00</span>
                       </div>
                       <div className="space-y-4 pt-6 border-t border-indigo-900">
                          <div className="flex justify-between items-center text-[10px] font-bold text-indigo-300 uppercase">
                             <span>Employer CPF (+17%)</span>
                             <span>$37,570.00</span>
                          </div>
                          <div className="flex justify-between items-center text-[10px] font-bold text-indigo-300 uppercase">
                             <span>Statutory SDL (Cap)</span>
                             <span>$1,399.00</span>
                          </div>
                       </div>
                    </div>
                 </div>
              </div>

              <div className="space-y-8 pb-10">
                <div className="flex justify-between items-center border-b border-slate-100 pb-4">
                   <h4 className="text-[11px] font-black text-slate-900 uppercase tracking-[0.2em] flex items-center gap-4">
                      <div className="w-8 h-1 bg-emerald-500 rounded-full"></div>
                      Resource Verification Matrix
                   </h4>
                   <input 
                    type="text" 
                    placeholder="Search focal point..." 
                    value={searchQuery} 
                    onChange={e => setSearchQuery(e.target.value)} 
                    className="bg-slate-50 border border-slate-100 rounded-xl px-5 py-2.5 text-[10px] font-black text-slate-900 outline-none focus:border-indigo-600 w-64" 
                   />
                </div>
                
                <div className="overflow-hidden border border-slate-100 rounded-[2rem] shadow-2xl shadow-indigo-500/5">
                  <div className="max-h-72 overflow-y-auto custom-scrollbar">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-slate-50/50 border-b border-slate-100 font-black text-slate-400 uppercase tracking-widest sticky top-0 z-10 backdrop-blur-md">
                        <tr>
                          <th className="px-8 py-5">Entity</th>
                          <th className="px-8 py-5 text-right">Gross Exposure</th>
                          <th className="px-8 py-5 text-right">Self CPF</th>
                          <th className="px-8 py-5 text-right">Firm CPF</th>
                          <th className="px-8 py-5 text-right">Liquid Net</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {filteredEmployees.map((emp, i) => (
                          <tr key={i} className="hover:bg-slate-50 cursor-pointer transition-all" onClick={() => setSelectedEmployee(emp)}>
                            <td className="px-8 py-4">
                               <div className="flex flex-col">
                                  <span className="font-black text-slate-900 uppercase tracking-tight">{emp.name}</span>
                                  <span className="text-[10px] font-bold text-slate-400 uppercase mt-0.5">{emp.department}</span>
                               </div>
                            </td>
                            <td className="px-8 py-4 text-right text-slate-600">${emp.gross.toFixed(2)}</td>
                            <td className="px-8 py-4 text-right text-red-500 italic">-${emp.empCpf.toFixed(2)}</td>
                            <td className="px-8 py-4 text-right text-slate-400">${emp.emprCpf.toFixed(2)}</td>
                            <td className="px-8 py-4 text-right font-black text-indigo-600 tracking-tight">${emp.net.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="bg-slate-50 border-t border-slate-100 p-10 flex justify-between items-center rounded-b-[3rem]">
               <button 
                onClick={() => {
                  const targetId = reviewRunData.id;
                  setReviewRunData(null);
                  setRuns(runs.map(r => r.id === targetId ? { ...r, status: 'Rejected' } : r));
                  handleActionToast(`Protocol Rejected. Operational cycle reset.`);
                }} 
                className="px-10 py-5 bg-white border border-red-200 text-red-600 text-[10px] font-black uppercase tracking-widest rounded-2xl hover:bg-red-50 transition-all shadow-xl shadow-red-500/5 active:scale-95"
               >
                 Reject Protocol
               </button>
               <div className="flex gap-4">
                 <button onClick={() => setReviewRunData(null)} className="px-8 py-5 bg-white border border-slate-200 text-slate-500 text-[10px] font-black uppercase tracking-widest rounded-2xl hover:bg-slate-100 transition-all">Abort Review</button>
                 <button 
                  onClick={() => {
                    const targetId = reviewRunData.id;
                    setReviewRunData(null);
                    setRuns(runs.map(r => r.id === targetId ? { ...r, status: 'Disbursed' } : r));
                    handleActionToast(`Settlement Approved. Liquidity synchronized.`);
                  }} 
                  className="px-12 py-5 bg-indigo-600 text-white text-[10px] font-black uppercase tracking-widest rounded-2xl hover:bg-indigo-700 shadow-2xl shadow-indigo-500/20 active:scale-95 transition-all"
                 >
                   Authorize Disbursement
                 </button>
               </div>
            </div>
          </div>
        </div>
      )}

      {/* Payslip Overlay (Simplified Matrix) */}
      {payslipPeriod && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/40 backdrop-blur-md p-8 animate-in fade-in duration-300">
           <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-3xl overflow-hidden border border-slate-100 animate-in slide-in-from-bottom-5">
              <div className="p-10 border-b border-slate-100 flex justify-between items-center">
                 <div>
                    <h3 className="text-2xl font-black text-slate-900 tracking-tighter uppercase leading-none">Entity Payslips</h3>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-3">Fiscal Window: {payslipPeriod}</p>
                 </div>
                 <button onClick={() => setPayslipPeriod(null)} className="w-10 h-10 flex items-center justify-center bg-white border border-slate-200 rounded-2xl text-slate-400 hover:text-red-500 transition-all font-black">&times;</button>
              </div>
              <div className="max-h-[50vh] overflow-y-auto">
                 <table className="w-full text-left text-sm border-collapse">
                    <thead className="bg-slate-50/50 text-[10px] font-black text-slate-400 uppercase tracking-widest sticky top-0 z-10 backdrop-blur-md">
                       <tr>
                          <th className="px-10 py-5">Personnel Name</th>
                          <th className="px-10 py-5">Structural Unit</th>
                          <th className="px-10 py-5 text-right">Net Settlement</th>
                          <th className="px-10 py-5 text-center">Export Protocol</th>
                       </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                       {mockEmployees.slice(0, 8).map((emp, i) => (
                          <tr key={i} className="hover:bg-slate-50 transition-all group">
                             <td className="px-10 py-4 text-xs font-black text-slate-900 group-hover:text-indigo-600 pointer-events-none uppercase tracking-tight">{emp.name}</td>
                             <td className="px-10 py-4 text-[10px] font-bold text-slate-400 uppercase">{emp.department}</td>
                             <td className="px-10 py-4 text-xs font-black text-slate-900 text-right">${emp.net.toFixed(2)}</td>
                             <td className="px-10 py-4 text-center">
                                <button onClick={() => handleActionToast(`Encrypting PDF for ${emp.name}...`)} className="px-4 py-1.5 bg-indigo-50 text-indigo-600 text-[9px] font-black uppercase rounded-lg hover:bg-indigo-600 hover:text-white transition-all">Download PDF</button>
                             </td>
                          </tr>
                       ))}
                    </tbody>
                 </table>
              </div>
              <div className="p-10 bg-slate-50/50 border-t border-slate-100 flex justify-between items-center">
                 <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest italic opacity-50">Global Batch Export (124 PDF Units)</p>
                 <button onClick={() => handleActionToast(`Compiling Global ISO-20022 Batch Archive...`)} className="px-8 py-4 bg-slate-950 text-white text-[10px] font-black uppercase tracking-widest rounded-2xl hover:bg-indigo-600 transition-all shadow-xl shadow-slate-950/10">Download All Interface (ZIP)</button>
              </div>
           </div>
        </div>
      )}

      {/* Success Notifications & Status Overlays */}
      {showSuccessToast && (
        <div className="fixed bottom-10 right-10 z-[200] max-w-md animate-in slide-in-from-right-10 duration-500">
           <div className="bg-emerald-950 border border-emerald-500/30 p-6 rounded-[2rem] shadow-2xl flex items-center gap-6 overflow-hidden relative group">
              <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500"></div>
              <div className="w-14 h-14 bg-emerald-500/20 rounded-2xl flex items-center justify-center text-2xl group-hover:scale-110 transition-transform duration-500">⚡</div>
              <div className="flex flex-col">
                 <h4 className="text-sm font-black text-white uppercase tracking-widest">Pipeline Synchronized</h4>
                 <p className="text-[10px] font-bold text-emerald-400/70 uppercase mt-1">Settlement confirmed for {latestRunCount} workforce entities.</p>
              </div>
           </div>
        </div>
      )}

      {actionToast && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[200] animate-in slide-in-from-bottom-10 duration-500">
           <div className="bg-slate-900 border border-slate-800 px-8 py-5 rounded-[2rem] shadow-2xl flex items-center gap-6">
              <div className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse"></div>
              <span className="text-[10px] font-black text-slate-100 uppercase tracking-[0.2em]">{actionToast}</span>
           </div>
        </div>
      )}

      {/* Detailed Entity Review (Side Drawer Simulation) */}
      {selectedEmployee && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-950/80 backdrop-blur-xl animate-in fade-in duration-500">
          <div className="bg-white rounded-[3rem] shadow-2xl w-full max-w-xl overflow-hidden border border-slate-100 animate-in zoom-in-95 duration-500">
            <div className="bg-slate-900 px-10 py-8 flex justify-between items-start text-white relative">
              <div className="absolute top-0 right-0 p-3 opacity-10 text-4xl">💎</div>
              <div className="flex flex-col gap-1 relative z-10">
                <h3 className="text-3xl font-black tracking-tighter uppercase whitespace-nowrap">{selectedEmployee.name}</h3>
                <p className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.3em] mt-2">{selectedEmployee.role} <span className="opacity-30 mx-2">|</span> {selectedEmployee.department}</p>
                <div className="flex gap-2 mt-6">
                  <span className="bg-slate-800 text-indigo-400 text-[8px] font-black px-3 py-1 rounded-full border border-slate-700 uppercase tracking-widest">{selectedEmployee.citizenship}</span>
                  <span className="bg-slate-800 text-slate-400 text-[8px] font-black px-3 py-1 rounded-full border border-slate-700 uppercase tracking-widest">Active Schema: 2026</span>
                </div>
              </div>
              <button onClick={() => setSelectedEmployee(null)} className="w-10 h-10 flex items-center justify-center bg-slate-800 border border-slate-700 rounded-2xl text-slate-400 hover:text-white transition-all text-2xl font-black">&times;</button>
            </div>

            <div className="p-10 space-y-10">
              <section>
                <div className="flex items-center gap-4 mb-6">
                  <div className="w-6 h-1 bg-indigo-600 rounded-full"></div>
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em]">Gross Exposure (OW+AW)</h4>
                </div>
                <div className="space-y-3">
                  <div className="flex justify-between items-center bg-slate-50 px-6 py-4 rounded-2xl border border-slate-100 group hover:border-indigo-600/30 transition-all">
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Contractual Base (OW)</span>
                    <span className="text-sm font-black text-slate-900">${selectedEmployee.base.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center bg-slate-50 px-6 py-4 rounded-2xl border border-slate-100 group hover:border-indigo-600/30 transition-all">
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Operational Allowance (AW)</span>
                    <span className="text-sm font-black text-slate-900">${selectedEmployee.allowance.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center pt-8 px-6">
                    <span className="text-[11px] font-black text-slate-900 uppercase tracking-widest">Computed Gross Entity Exposure</span>
                    <span className="text-2xl font-black text-slate-900 tracking-tighter">${selectedEmployee.gross.toFixed(2)}</span>
                  </div>
                </div>
              </section>

              <section className="bg-slate-50/50 p-8 rounded-[2.5rem] border border-slate-100 flex flex-col gap-6">
                <div>
                   <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] mb-6 flex items-center gap-4">
                      <div className="w-1.5 h-1.5 bg-red-500 rounded-full"></div>
                      Statutory Leakage (Deductions)
                   </h4>
                   <div className="flex justify-between items-center px-4">
                     <span className="text-xs font-bold text-slate-600 uppercase">Mandatory Employee CPF (20%)</span>
                     <span className="text-sm font-black text-red-600 italic">-${selectedEmployee.empCpf.toFixed(2)}</span>
                   </div>
                </div>
                
                <div className="pt-6 border-t border-slate-100">
                   <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] mb-6 flex items-center gap-4">
                      <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></div>
                      External Firm Burden (Non-Deducted)
                   </h4>
                   <div className="space-y-4 px-4">
                     <div className="flex justify-between items-center">
                       <span className="text-xs font-bold text-slate-400 uppercase">Mandatory Employer CPF (17%)</span>
                       <span className="text-xs font-black text-slate-500">${selectedEmployee.emprCpf.toFixed(2)}</span>
                     </div>
                     <div className="flex justify-between items-center">
                       <span className="text-xs font-bold text-slate-400 uppercase">Statutory SDL Contribution</span>
                       <span className="text-xs font-black text-slate-500">${selectedEmployee.sdl.toFixed(2)}</span>
                     </div>
                   </div>
                </div>
              </section>
            </div>

            <div className="bg-indigo-600 px-10 py-10 flex justify-between items-center relative overflow-hidden group">
              <div className="absolute inset-0 bg-slate-950 opacity-0 group-hover:opacity-10 transition-opacity"></div>
              <div className="flex flex-col gap-1 relative z-10">
                 <span className="text-[10px] font-black text-indigo-100 uppercase tracking-[0.3em] italic">Net Liquidity Transfer</span>
                 <span className="text-[11px] font-black text-white/50 uppercase tracking-widest mt-1 opacity-70">Sector: {selectedEmployee.company}</span>
              </div>
              <span className="text-5xl font-black text-white tracking-tighter relative z-10 italic">${selectedEmployee.net.toFixed(2)}</span>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
