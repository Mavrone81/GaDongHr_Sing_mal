'use client';

import React from 'react';
import LeavesCard from './LeavesCard';
import ClaimsCard from './ClaimsCard';
import AttendanceCard from './AttendanceCard';
import TimesheetCard from './TimesheetCard';
import AnnouncementCard from './AnnouncementCard';
import CelebrationsCard from './CelebrationsCard';

export default function EmployeeDashboard() {
  return (
    <div className="flex flex-col gap-8 pb-12 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Column (2/3) */}
        <div className="lg:col-span-2 flex flex-col gap-8">
          
          {/* Top Row: Functional Signals */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="h-full"><LeavesCard /></div>
            <div className="h-full"><ClaimsCard /></div>
          </div>

          {/* Middle Row: Operational Flow */}
          <div className="min-h-[350px]">
            <TimesheetCard />
          </div>

          {/* Bottom Row: Social & Milestones */}
          <div className="min-h-[250px]">
            <CelebrationsCard />
          </div>

        </div>

        {/* Right Column (1/3) */}
        <div className="flex flex-col gap-8 text-slate-900">
          <AttendanceCard />
          <AnnouncementCard />
        </div>

      </div>
    </div>
  );
}
