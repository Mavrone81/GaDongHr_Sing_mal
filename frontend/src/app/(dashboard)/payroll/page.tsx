'use client';

import { useState, useMemo } from 'react';

export default function PayrollDashboard() {
  const [isRunModalOpen, setIsRunModalOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showSuccessToast, setShowSuccessToast] = useState(false);
  
  // New States for dead buttons
  const [reviewRunData, setReviewRunData] = useState<string | null>(null);
  const [payslipPeriod, setPayslipPeriod] = useState<string | null>(null);
  const [actionToast, setActionToast] = useState<string | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const [runs, setRuns] = useState([
    { id: 'run-3', period: 'March 2026', status: 'Pending Approval', employees: 124, net: '$201,400.00', cpf: '$44,200.00' },
    { id: 'run-2', period: 'February 2026', status: 'Disbursed', employees: 121, net: '$198,250.00', cpf: '$43,500.00' },
    { id: 'run-1', period: 'January 2026', status: 'Disbursed', employees: 120, net: '$195,100.00', cpf: '$42,900.00' }
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
    // Simulate server compute
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

    setRuns([{ id: 'run-' + Date.now().toString(), period: periodName, status: 'Pending Approval', employees: count, net, cpf }, ...runs]);
    setLatestRunCount(count);
    
    setShowSuccessToast(true);
    setTimeout(() => setShowSuccessToast(false), 3000);
  };

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
              {runs.map((run, i) => (
                <tr key={i} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4 font-medium text-gray-900">{run.period}</td>
                  <td className="px-6 py-4">
                    <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${
                      run.status === 'Pending Approval' ? 'bg-amber-100 text-amber-800' : 
                      run.status === 'Rejected' ? 'bg-red-100 text-red-800' : 
                      'bg-emerald-100 text-emerald-800'
                    }`}>
                      {run.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-gray-600">{run.employees}</td>
                  <td className="px-6 py-4 text-gray-900 font-medium text-right">{run.net}</td>
                  <td className="px-6 py-4 text-gray-600 text-right">{run.cpf}</td>
                  <td className="px-6 py-4 text-center">
                    {run.status === 'Pending Approval' ? (
                      <button onClick={() => setReviewRunData(run)} className="text-brand-600 hover:text-brand-800 font-medium text-xs border border-brand-200 px-3 py-1 rounded-full hover:bg-brand-50 transition-colors">Review Run</button>
                    ) : run.status === 'Rejected' ? (
                      <span className="text-gray-400 text-xs font-medium">Archived</span>
                    ) : (
                      <div className="flex justify-center gap-2">
                        <button onClick={() => handleActionToast(`Downloading Bank Upload File for ${run.period}...`)} className="text-blue-600 hover:text-blue-800 font-medium text-xs px-2.5 py-1 bg-blue-50 hover:bg-blue-100 rounded transition-colors" title="Download GIRO TXT">Bank File</button>
                        <button onClick={() => handleActionToast(`Downloading CPF Upload File for ${run.period}...`)} className="text-emerald-600 hover:text-emerald-800 font-medium text-xs px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 rounded transition-colors" title="Download CPF FTP">CPF File</button>
                        <button onClick={() => setPayslipPeriod(run.period)} className="text-gray-600 hover:text-gray-800 font-medium text-xs px-2.5 py-1 bg-gray-100 hover:bg-gray-200 rounded transition-colors" title="View & Download Payslips">Payslips</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
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
                <input type="month" value={selectedPeriod} onChange={e => setSelectedPeriod(e.target.value)} className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none w-full" />
              </div>
              
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-gray-700">Processing Group</label>
                <select value={processingGroup} onChange={e => setProcessingGroup(e.target.value)} className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none w-full bg-white appearance-none cursor-pointer">
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
              <button 
                onClick={handleExecute} 
                disabled={isProcessing}
                className={`px-5 py-2 bg-brand-600 text-white font-medium text-sm rounded transition-all shadow-sm flex items-center gap-2 ${isProcessing ? 'opacity-70 cursor-not-allowed' : 'hover:bg-brand-500'}`}
              >
                {isProcessing ? (
                  <>
                    <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    Processing...
                  </>
                ) : (
                  <><span>⚡</span> Execute Calculation Engine</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Success Toast */}
      {showSuccessToast && (
        <div className="fixed bottom-6 right-6 bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 animate-fade-in-up">
          <div className="bg-emerald-100 rounded-full p-1">
            <svg className="w-4 h-4 text-emerald-600" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor"><path d="M5 13l4 4L19 7"></path></svg>
          </div>
          <div>
            <h4 className="text-sm font-bold">Compute Successful</h4>
            <p className="text-xs text-emerald-600 mt-0.5">Payroll calculated for {latestRunCount} employees.</p>
          </div>
        </div>
      )}
      {/* Review Run Modal */}
      {reviewRunData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl border border-gray-200 animate-slide-up flex flex-col max-h-[90vh]">
            <div className="bg-gray-50 border-b border-gray-200 px-6 py-4 flex justify-between items-center shrink-0 rounded-t-lg">
              <div>
                <h3 className="text-lg font-bold text-gray-900 tracking-tight">Review Payroll Run</h3>
                <p className="text-xs text-gray-500 mt-0.5">Pay Period: {reviewRunData.period}</p>
              </div>
              <button onClick={() => setReviewRunData(null)} className="text-gray-400 hover:text-gray-600 text-xl font-bold">&times;</button>
            </div>
            <div className="p-6 overflow-y-auto w-full">
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="bg-brand-50 p-4 rounded-lg border border-brand-100">
                  <p className="text-xs font-semibold text-brand-700 uppercase tracking-wide">Net Payout</p>
                  <h4 className="text-2xl font-bold text-brand-900 mt-1">{reviewRunData.net}</h4>
                </div>
                <div className="bg-emerald-50 p-4 rounded-lg border border-emerald-100">
                  <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">CPF / SDL</p>
                  <h4 className="text-2xl font-bold text-emerald-900 mt-1">{reviewRunData.cpf}</h4>
                </div>
                <div className="bg-amber-50 p-4 rounded-lg border border-amber-100">
                  <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">Employees</p>
                  <h4 className="text-2xl font-bold text-amber-900 mt-1">{reviewRunData.employees}</h4>
                </div>
              </div>

              <div className="border-t border-gray-100 pt-5 mb-5 space-y-4">
                <h4 className="text-sm font-bold text-gray-900 tracking-tight flex items-center gap-2">
                  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                  Financial Breakdown
                </h4>
                <div className="bg-white rounded-lg border border-gray-200 overflow-hidden text-sm shadow-sm">
                  <div className="flex justify-between items-center px-4 py-2.5 bg-gray-50 border-b border-gray-200">
                    <span className="text-gray-600 font-medium tracking-wide text-xs">Total Gross Wages</span>
                    <span className="font-semibold text-gray-900">$245,600.00</span>
                  </div>
                  <div className="flex justify-between items-center px-4 py-2.5 text-gray-600 border-b border-gray-100">
                    <span>Employee CPF Deduction (20%)</span>
                    <span className="font-medium text-red-600 tracking-tight">-$44,200.00</span>
                  </div>
                  <div className="flex justify-between items-center px-4 py-3 font-bold text-gray-900 bg-brand-50/50">
                    <span>Net Payout to Employees</span>
                    <span className="text-brand-700 tracking-tight text-base">$201,400.00</span>
                  </div>
                </div>

                <div className="bg-white rounded-lg border border-gray-200 overflow-hidden text-sm shadow-sm">
                  <div className="flex justify-between items-center px-4 py-2.5 text-gray-600 border-b border-gray-100">
                    <span>Employer CPF Contribution (17%)</span>
                    <span className="font-medium text-gray-900 tracking-tight">$37,570.00</span>
                  </div>
                  <div className="flex justify-between items-center px-4 py-2.5 text-gray-600 border-b border-gray-100">
                    <span>Skills Development Levy (SDL)</span>
                    <span className="font-medium text-gray-900 tracking-tight">$1,399.00</span>
                  </div>
                   <div className="flex justify-between items-center px-4 py-3 font-bold text-gray-900 bg-emerald-50 border-t border-emerald-100">
                    <span>Total Employer Cost</span>
                    <span className="text-emerald-700 tracking-tight text-base">$284,569.00</span>
                  </div>
                </div>
              </div>

              <div className="border-t border-gray-100 pt-5 mb-5 space-y-4">
                <div className="flex justify-between items-center">
                  <h4 className="text-sm font-bold text-gray-900 tracking-tight flex items-center gap-2">
                    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"></path></svg>
                    Individual Breakdown
                  </h4>
                  <div className="relative">
                    <svg className="w-4 h-4 text-gray-400 absolute left-2.5 top-[7px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                    <input type="text" placeholder="Search employee..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="pl-8 pr-3 py-1.5 text-xs border border-gray-300 rounded focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none w-56" />
                  </div>
                </div>
                <div className="overflow-hidden border border-gray-200 rounded-lg shadow-sm">
                  <div className="max-h-48 overflow-y-auto">
                    <table className="w-full text-left text-xs whitespace-nowrap">
                      <thead className="bg-gray-50 border-b border-gray-200 font-semibold text-gray-700 uppercase tracking-wider sticky top-0">
                        <tr>
                          <th className="px-4 py-2">Employee</th>
                          <th className="px-4 py-2 text-right">Gross Pay</th>
                          <th className="px-4 py-2 text-right">Own CPF</th>
                          <th className="px-4 py-2 text-right">Emp. CPF</th>
                          <th className="px-4 py-2 text-right">Net Pay</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {filteredEmployees.map((emp, i) => (
                          <tr key={i} className="hover:bg-gray-100 cursor-pointer transition-colors" onClick={() => setSelectedEmployee(emp)}>
                            <td className="px-4 py-2 font-medium text-brand-600">
                              {emp.name}
                              <div className="text-gray-400 font-normal text-[10px] uppercase tracking-wider">{emp.department}</div>
                            </td>
                            <td className="px-4 py-2 text-right text-gray-600">${emp.gross.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                            <td className="px-4 py-2 text-right text-red-600">-${emp.empCpf.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                            <td className="px-4 py-2 text-right text-gray-500">${emp.emprCpf.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                            <td className="px-4 py-2 text-right font-medium text-brand-700">${emp.net.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                          </tr>
                        ))}
                        {filteredEmployees.length === 0 && (
                          <tr><td colSpan={5} className="px-4 py-4 text-center text-gray-500 italic">No employees found matching "{searchQuery}"</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="text-sm text-gray-700 space-y-3">
                <p><strong>Maker:</strong> John Admin (super_admin) on Mar 28, 2026</p>
                <div className="bg-yellow-50 border-l-4 border-yellow-400 p-3 text-yellow-800 rounded-r text-sm">
                  <p className="font-semibold">Checker Verification Required</p>
                  <p className="mt-1 opacity-90">Please ensure the final payout tally matches the finance treasury allocation before approving this run. Once approved, the system will lock the records and prepare the GIRO txt and CPF e-Submission formats.</p>
                </div>
              </div>
            </div>
            <div className="bg-gray-50 border-t border-gray-200 px-6 py-4 flex justify-between items-center shrink-0 rounded-b-lg">
              <button onClick={() => {
                const targetId = reviewRunData.id;
                setReviewRunData(null);
                setRuns(runs.map(r => r.id === targetId ? { ...r, status: 'Rejected' } : r));
                handleActionToast(`Payroll Run rejected. Maker has been notified.`);
              }} className="px-4 py-2 border border-red-200 text-red-600 bg-red-50 font-medium text-sm rounded hover:bg-red-100 transition-colors shadow-sm focus:outline-none">
                Reject Run
              </button>
              <div className="flex gap-3">
                <button onClick={() => setReviewRunData(null)} className="px-4 py-2 border border-gray-300 text-gray-700 bg-white font-medium text-sm rounded hover:bg-gray-100 transition-colors shadow-sm">
                  Cancel
                </button>
                <button onClick={() => {
                  const targetId = reviewRunData.id;
                  setReviewRunData(null);
                  setRuns(runs.map(r => r.id === targetId ? { ...r, status: 'Disbursed' } : r));
                  handleActionToast(`Payroll Run successfully approved. Disbursement files generated.`);
                }} className="px-5 py-2 bg-brand-600 text-white font-medium text-sm rounded hover:bg-brand-500 transition-colors shadow-sm flex items-center gap-2">
                  Approve Run
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* View Payslips Modal */}
      {payslipPeriod && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl overflow-hidden border border-gray-200 animate-slide-up">
            <div className="bg-gray-50 border-b border-gray-200 px-6 py-4 flex justify-between items-center">
              <div>
                <h3 className="text-lg font-bold text-gray-900 tracking-tight">Employee Payslips</h3>
                <p className="text-xs text-gray-500 mt-0.5">Pay Period: {payslipPeriod}</p>
              </div>
              <button onClick={() => setPayslipPeriod(null)} className="text-gray-400 hover:text-gray-600 text-xl font-bold">&times;</button>
            </div>
            
            <div className="max-h-[60vh] overflow-y-auto">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-700 uppercase tracking-wider sticky top-0">
                  <tr>
                    <th className="px-6 py-3">Employee</th>
                    <th className="px-6 py-3 font-medium">Department</th>
                    <th className="px-6 py-3 font-medium text-right">Net Pay</th>
                    <th className="px-6 py-3 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  <tr className="hover:bg-gray-50">
                    <td className="px-6 py-3 font-medium text-gray-900">Johnathan Lim</td>
                    <td className="px-6 py-3 text-gray-500">Engineering</td>
                    <td className="px-6 py-3 font-medium text-gray-900 text-right">$6,240.00</td>
                    <td className="px-6 py-3 text-center">
                      <button onClick={() => handleActionToast("Downloading Johnathan's PDF Payslip...")} className="text-brand-600 hover:text-brand-800 text-xs font-medium bg-brand-50 px-3 py-1 rounded">Download PDF</button>
                    </td>
                  </tr>
                  <tr className="hover:bg-gray-50">
                    <td className="px-6 py-3 font-medium text-gray-900">Sarah Tan</td>
                    <td className="px-6 py-3 text-gray-500">Marketing</td>
                    <td className="px-6 py-3 font-medium text-gray-900 text-right">$4,850.00</td>
                    <td className="px-6 py-3 text-center">
                      <button onClick={() => handleActionToast("Downloading Sarah's PDF Payslip...")} className="text-brand-600 hover:text-brand-800 text-xs font-medium bg-brand-50 px-3 py-1 rounded">Download PDF</button>
                    </td>
                  </tr>
                  <tr className="hover:bg-gray-50">
                    <td className="px-6 py-3 font-medium text-gray-900">David Chen</td>
                    <td className="px-6 py-3 text-gray-500">Finance</td>
                    <td className="px-6 py-3 font-medium text-gray-900 text-right">$7,100.00</td>
                    <td className="px-6 py-3 text-center">
                      <button onClick={() => handleActionToast("Downloading David's PDF Payslip...")} className="text-brand-600 hover:text-brand-800 text-xs font-medium bg-brand-50 px-3 py-1 rounded">Download PDF</button>
                    </td>
                  </tr>
                   <tr className="hover:bg-gray-50">
                    <td className="px-6 py-3 font-medium text-gray-900">Amanda Leong</td>
                    <td className="px-6 py-3 text-gray-500">Human Resources</td>
                    <td className="px-6 py-3 font-medium text-gray-900 text-right">$5,200.00</td>
                    <td className="px-6 py-3 text-center">
                      <button onClick={() => handleActionToast("Downloading Amanda's PDF Payslip...")} className="text-brand-600 hover:text-brand-800 text-xs font-medium bg-brand-50 px-3 py-1 rounded">Download PDF</button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="bg-gray-50 border-t border-gray-200 px-6 py-4 flex justify-between items-center">
              <p className="text-xs text-gray-500">Showing 4 of 124 employees</p>
              <button onClick={() => handleActionToast("Generating ZIP folder containing all 124 payslips...")} className="px-4 py-2 bg-gray-800 text-white font-medium text-sm rounded hover:bg-gray-700 transition-colors shadow-sm flex items-center gap-2">
                Download All (ZIP)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Action Generic Toast */}
      {actionToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-800 text-white px-5 py-3 rounded-lg shadow-lg flex items-center gap-3 animate-fade-in-up z-50">
          <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
          <span className="text-sm font-medium">{actionToast}</span>
        </div>
      )}

      {/* Selected Employee Detailed Computation Overlay */}
      {selectedEmployee && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden border border-gray-200 animate-slide-up">
            
            <div className="bg-slate-900 px-6 py-5 flex justify-between items-start text-white">
              <div>
                <h3 className="text-xl font-bold tracking-tight">{selectedEmployee.name}</h3>
                <p className="text-sm text-slate-300 mt-1">{selectedEmployee.role} • {selectedEmployee.department} • {selectedEmployee.company}</p>
                <div className="flex gap-2 mt-3">
                  <span className="bg-slate-800 text-slate-200 text-xs px-2 py-1 rounded inline-block">{selectedEmployee.citizenship}</span>
                  <span className="bg-slate-800 text-slate-200 text-xs px-2 py-1 rounded inline-block">Age: {selectedEmployee.ageRank}</span>
                </div>
              </div>
              <button onClick={() => setSelectedEmployee(null)} className="text-slate-400 hover:text-white text-xl font-bold">&times;</button>
            </div>

            <div className="p-6">
              <h4 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Earnings</h4>
              <div className="space-y-2 text-sm text-gray-700">
                <div className="flex justify-between items-center bg-gray-50 px-3 py-2 rounded">
                  <span>Basic Wage (OW)</span>
                  <span className="font-medium">${selectedEmployee.base.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center bg-gray-50 px-3 py-2 rounded">
                  <span>Allowances (AW)</span>
                  <span className="font-medium">${selectedEmployee.allowance.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center pt-2 px-3">
                  <span className="font-semibold text-gray-900">Gross Total</span>
                  <span className="font-bold text-gray-900">${selectedEmployee.gross.toFixed(2)}</span>
                </div>
              </div>

              <div className="my-5 border-t border-gray-100"></div>

              <h4 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Statutory Deductions</h4>
              <div className="space-y-2 text-sm text-gray-700 border-l-2 border-red-200 pl-3">
                <div className="flex justify-between items-center">
                  <span>Employee CPF (20%)</span>
                  <span className="font-medium text-red-600">-${selectedEmployee.empCpf.toFixed(2)}</span>
                </div>
              </div>

              <div className="my-5 border-t border-gray-100"></div>

              <h4 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Firm Contributions (Not Deducted)</h4>
              <div className="space-y-2 text-sm text-gray-700 border-l-2 border-brand-200 pl-3">
                <div className="flex justify-between items-center">
                  <span>Employer CPF (17%)</span>
                  <span className="font-medium text-gray-500">${selectedEmployee.emprCpf.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span>Skills Development Levy</span>
                  <span className="font-medium text-gray-500">${selectedEmployee.sdl.toFixed(2)}</span>
                </div>
              </div>
            </div>

            <div className="bg-brand-50 border-t border-brand-100 px-6 py-5 flex justify-between items-center">
              <span className="text-brand-900 font-bold uppercase tracking-widest text-xs">Final Net Payout</span>
              <span className="text-brand-700 font-black text-2xl tracking-tighter">${selectedEmployee.net.toFixed(2)}</span>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
