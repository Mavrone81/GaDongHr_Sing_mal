export default function ExecutiveDashboard() {
  return (
    <div className="flex flex-col gap-6 max-w-[1600px] mx-auto pb-12">
      
      {/* Top KPI row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: Headcount */}
        <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Total Headcount</p>
              <h3 className="text-2xl font-bold text-gray-900 mt-1">1,248</h3>
            </div>
            <div className="p-2 bg-blue-50 rounded-md">
              <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"></path></svg>
            </div>
          </div>
          <div className="mt-4 flex items-center text-sm">
            <span className="text-green-600 font-medium flex items-center">↑ 2.4%</span>
            <span className="text-gray-400 ml-2">vs last month</span>
          </div>
        </div>

        {/* KPI 2: Attrition */}
        <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Attrition Rate (12M)</p>
              <h3 className="text-2xl font-bold text-gray-900 mt-1">8.2%</h3>
            </div>
            <div className="p-2 bg-red-50 rounded-md">
              <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6"></path></svg>
            </div>
          </div>
          <div className="mt-4 flex items-center text-sm">
            <span className="text-red-600 font-medium flex items-center">↑ 0.5%</span>
            <span className="text-gray-400 ml-2">vs last month</span>
          </div>
        </div>

        {/* KPI 3: Payroll Cost */}
        <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Monthly Payroll</p>
              <h3 className="text-2xl font-bold text-gray-900 mt-1">$4.2M</h3>
            </div>
            <div className="p-2 bg-emerald-50 rounded-md">
              <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
            </div>
          </div>
          <div className="mt-4 flex items-center text-sm">
            <span className="text-green-600 font-medium flex items-center">↓ 1.2%</span>
            <span className="text-gray-400 ml-2">vs prior month</span>
          </div>
        </div>

        {/* KPI 4: Leave Liability */}
        <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Leave Liability</p>
              <h3 className="text-2xl font-bold text-gray-900 mt-1">$850K</h3>
            </div>
            <div className="p-2 bg-amber-50 rounded-md">
              <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
            </div>
          </div>
          <div className="mt-4 flex items-center text-sm text-amber-600">
            <span>Projected Liability Value</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        
        {/* Left Column (2 spans wide) */}
        <div className="xl:col-span-2 flex flex-col gap-6">
          
          {/* Headcount Breakdown */}
          <section className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-base font-semibold text-gray-800">Headcount Overview</h3>
              <select className="text-sm border-gray-200 rounded-md text-gray-600"><option>By Department</option><option>By Nationality</option><option>By Pass Type</option></select>
            </div>
            
            <div className="space-y-4">
              {/* Engineering */}
              <div className="flex items-center justify-between">
                <div className="w-1/4 text-sm font-medium text-gray-700">Engineering</div>
                <div className="flex-1 mx-4 h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full" style={{width: '45%'}}></div>
                </div>
                <div className="w-16 text-right text-sm text-gray-600">45% (561)</div>
              </div>
              {/* Sales */}
              <div className="flex items-center justify-between">
                <div className="w-1/4 text-sm font-medium text-gray-700">Sales & Marketing</div>
                <div className="flex-1 mx-4 h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-400 rounded-full" style={{width: '25%'}}></div>
                </div>
                <div className="w-16 text-right text-sm text-gray-600">25% (312)</div>
              </div>
              {/* Operations */}
              <div className="flex items-center justify-between">
                <div className="w-1/4 text-sm font-medium text-gray-700">Operations</div>
                <div className="flex-1 mx-4 h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-300 rounded-full" style={{width: '20%'}}></div>
                </div>
                <div className="w-16 text-right text-sm text-gray-600">20% (250)</div>
              </div>
              {/* HR & Finance */}
              <div className="flex items-center justify-between">
                <div className="w-1/4 text-sm font-medium text-gray-700">HR & Finance</div>
                <div className="flex-1 mx-4 h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-200 rounded-full" style={{width: '10%'}}></div>
                </div>
                <div className="w-16 text-right text-sm text-gray-600">10% (125)</div>
              </div>
            </div>
          </section>

          {/* New Hires vs Terminations */}
          <section className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
            <h3 className="text-base font-semibold text-gray-800 mb-6">Net Hiring Trend (6 Months)</h3>
            <div className="h-48 flex items-end gap-2 sm:gap-4 lg:gap-8 pt-4">
              {['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'].map(month => (
                <div key={month} className="flex-1 flex flex-col justify-end items-center gap-2 group">
                  <div className="flex gap-1 w-full justify-center items-end">
                    <div className="w-1/3 bg-emerald-400 rounded-t h-32 group-hover:opacity-80 transition-opacity" title="Hires"></div>
                    <div className="w-1/3 bg-red-400 rounded-t h-12 group-hover:opacity-80 transition-opacity" title="Terminations"></div>
                  </div>
                  <span className="text-xs text-gray-500 font-medium">{month}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-center gap-6 mt-6 pt-4 border-t border-gray-100">
              <div className="flex items-center gap-2 text-sm"><span className="w-3 h-3 bg-emerald-400 rounded-sm"></span><span className="text-gray-600">New Hires</span></div>
              <div className="flex items-center gap-2 text-sm"><span className="w-3 h-3 bg-red-400 rounded-sm"></span><span className="text-gray-600">Terminations</span></div>
            </div>
          </section>

        </div>

        {/* Right Column (1 span wide) */}
        <div className="flex flex-col gap-6">
          
          {/* Action Items */}
          <section className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
            <h3 className="text-base font-semibold text-gray-800 mb-4">Pending Approvals</h3>
            <div className="space-y-3">
              <div className="p-3 bg-orange-50 border border-orange-100 rounded-md flex justify-between items-center cursor-pointer hover:bg-orange-100 transition-colors">
                <div>
                  <p className="text-sm font-medium text-orange-900">Payroll Run - Mar 2026</p>
                  <p className="text-xs text-orange-700 mt-0.5">Pending Executive Approval</p>
                </div>
                <span className="text-orange-600">→</span>
              </div>
              <div className="p-3 bg-gray-50 border border-gray-100 rounded-md flex justify-between items-center cursor-pointer hover:bg-gray-100 transition-colors">
                <div>
                  <p className="text-sm font-medium text-gray-800">42 Pending Leave Requests</p>
                  <p className="text-xs text-gray-500 mt-0.5">Requires Manager Review</p>
                </div>
                <span className="text-gray-400">→</span>
              </div>
              <div className="p-3 bg-gray-50 border border-gray-100 rounded-md flex justify-between items-center cursor-pointer hover:bg-gray-100 transition-colors">
                <div>
                  <p className="text-sm font-medium text-gray-800">18 Claims Outstanding</p>
                  <p className="text-xs text-gray-500 mt-0.5">$4,250.00 Total Value</p>
                </div>
                <span className="text-gray-400">→</span>
              </div>
            </div>
          </section>

          {/* Quick Metrics */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-brand-50 border border-brand-100 p-4 rounded-lg text-center">
              <div className="text-3xl font-bold text-brand-700">12</div>
              <div className="text-xs font-semibold text-brand-600 uppercase mt-1">Open Positions</div>
            </div>
            <div className="bg-purple-50 border border-purple-100 p-4 rounded-lg text-center">
              <div className="text-3xl font-bold text-purple-700">94%</div>
              <div className="text-xs font-semibold text-purple-600 uppercase mt-1">Training Cmpl.</div>
            </div>
          </div>

          <section className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
            <h3 className="text-base font-semibold text-gray-800 mb-4">Overtime Trend</h3>
            <div className="flex flex-col gap-3">
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-600">Operations</span>
                <span className="font-medium text-gray-900">4,250 hrs</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-600">Sales</span>
                <span className="font-medium text-gray-900">1,120 hrs</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-600">Engineering</span>
                <span className="font-medium text-gray-900">850 hrs</span>
              </div>
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}
