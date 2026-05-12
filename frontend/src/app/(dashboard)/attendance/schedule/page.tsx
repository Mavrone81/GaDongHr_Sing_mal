'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { apiFetch } from '@/lib/api';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface RosterShift {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  color: string;
  hoursPerDay: number;
}

interface ShiftPatternEntry {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  color: string;
  hoursPerShift: number;
}

interface RosterDay {
  date: string; // YYYY-MM-DD
  shift: RosterShift | null;
  note: string | null;
}

function getWeekStart(base: Date): Date {
  const d = new Date(base);
  const day = d.getDay();
  d.setDate(d.getDate() - ((day + 6) % 7)); // Monday
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function toISO(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default function MySchedulePage() {
  const { user } = useAuth();
  const [weekOffset, setWeekOffset] = useState(0);
  const [roster, setRoster] = useState<RosterDay[]>([]);
  const [loading, setLoading] = useState(true);

  const weekStart = getWeekStart(addDays(new Date(), weekOffset * 7));
  const weekEnd   = addDays(weekStart, 6);

  useEffect(() => {
    if (!user?.employeeId) { setLoading(false); return; }
    setLoading(true);
    const from = toISO(weekStart);
    const to   = toISO(weekEnd);
    apiFetch(`/attendance/roster?employeeId=${user.employeeId}&from=${from}&to=${to}`)
      .then((data: any) => {
        const entries: any[] = data.entries ?? data ?? [];
        const map = new Map<string, any>();
        for (const e of entries) map.set(e.date?.slice(0, 10) ?? '', e);
        const days: RosterDay[] = Array.from({ length: 7 }).map((_, i) => {
          const d = addDays(weekStart, i);
          const key = toISO(d);
          const entry = map.get(key);
          let shift: RosterShift | null = null;
          if (entry) {
            if (entry.shiftTemplate) {
              shift = entry.shiftTemplate;
            } else if (entry.workingShift) {
              shift = entry.workingShift;
            } else if (entry.shiftPattern) {
              const p = entry.shiftPattern as ShiftPatternEntry;
              shift = { id: p.id, name: p.name, startTime: p.startTime, endTime: p.endTime, color: p.color, hoursPerDay: p.hoursPerShift };
            }
          }
          return { date: key, shift, note: entry?.note ?? null };
        });
        setRoster(days);
      })
      .catch(() => setRoster(Array.from({ length: 7 }).map((_, i) => ({ date: toISO(addDays(weekStart, i)), shift: null, note: null }))))
      .finally(() => setLoading(false));
  }, [user?.employeeId, weekOffset]);

  const totalHours = roster.reduce((s, d) => s + (d.shift?.hoursPerDay ?? 0), 0);
  const workDays   = roster.filter(d => d.shift !== null).length;

  const today = toISO(new Date());

  return (
    <div className="flex flex-col gap-6 max-w-[1100px] mx-auto pb-12 animate-in fade-in duration-700">

      {/* Header */}
      <div className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-xl shadow-indigo-500/5 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tighter">My <span className="text-indigo-600">Schedule</span></h1>
          <p className="text-[10px] font-black text-slate-400 mt-1 uppercase tracking-widest">Weekly roster · Shift assignments</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setWeekOffset(w => w - 1)}
            className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 transition-all font-black text-sm"
          >‹</button>
          <button
            onClick={() => setWeekOffset(0)}
            className="px-5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-indigo-50 text-indigo-600 border border-indigo-100 hover:bg-indigo-100 transition-all"
          >
            This Week
          </button>
          <button
            onClick={() => setWeekOffset(w => w + 1)}
            className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 transition-all font-black text-sm"
          >›</button>
        </div>
      </div>

      {/* Week label + stats */}
      <div className="grid grid-cols-3 gap-5">
        <div className="col-span-1 bg-slate-900 p-7 rounded-[1.5rem] border border-slate-800 shadow-xl">
          <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-2">Week of</p>
          <p className="text-2xl font-black text-white tracking-tighter">
            {weekStart.getDate()} {MONTH_NAMES[weekStart.getMonth()]}
            {weekStart.getFullYear() !== weekEnd.getFullYear() ? ` ${weekStart.getFullYear()}` : ''}
            {' – '}
            {weekEnd.getDate()} {MONTH_NAMES[weekEnd.getMonth()]} {weekEnd.getFullYear()}
          </p>
        </div>
        <div className="bg-white p-7 rounded-[1.5rem] border border-slate-100 shadow-lg shadow-indigo-500/5">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Scheduled Hours</p>
          {loading ? <div className="h-10 w-20 bg-slate-100 rounded-xl animate-pulse" /> : <p className="text-4xl font-black text-slate-900 tracking-tighter">{totalHours}h</p>}
        </div>
        <div className="bg-indigo-50/60 p-7 rounded-[1.5rem] border border-indigo-100">
          <p className="text-[10px] font-black text-indigo-700 uppercase tracking-widest mb-3">Work Days</p>
          {loading ? <div className="h-10 w-16 bg-indigo-100 rounded-xl animate-pulse" /> : <p className="text-4xl font-black text-indigo-700 tracking-tighter">{workDays} / 7</p>}
        </div>
      </div>

      {/* Week grid */}
      <div className="bg-white rounded-[2rem] border border-slate-100 shadow-xl shadow-indigo-500/5 overflow-hidden">
        <div className="px-8 py-5 border-b border-slate-100 bg-slate-50/50">
          <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest">Weekly View</h3>
        </div>
        <div className="grid grid-cols-7 divide-x divide-slate-100 min-h-[280px]">
          {loading
            ? Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="p-4 flex flex-col gap-2">
                  <div className="h-4 w-10 bg-slate-100 rounded animate-pulse" />
                  <div className="h-20 bg-slate-50 rounded-2xl animate-pulse" />
                </div>
              ))
            : roster.map((day) => {
                const d = new Date(day.date + 'T00:00:00');
                const isToday = day.date === today;
                const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                return (
                  <div key={day.date} className={`p-4 flex flex-col gap-2 ${isWeekend ? 'bg-slate-50/40' : ''}`}>
                    {/* Day header */}
                    <div className="flex flex-col items-center mb-1">
                      <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{DAY_NAMES[d.getDay()]}</span>
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center mt-1 ${isToday ? 'bg-indigo-600 shadow-lg shadow-indigo-500/30' : ''}`}>
                        <span className={`text-sm font-black ${isToday ? 'text-white' : 'text-slate-700'}`}>{d.getDate()}</span>
                      </div>
                    </div>

                    {/* Shift card */}
                    {day.shift ? (
                      <div
                        className="flex-1 rounded-2xl p-3 flex flex-col gap-1 border"
                        style={{ backgroundColor: `${day.shift.color}18`, borderColor: `${day.shift.color}40` }}
                      >
                        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: day.shift.color }} />
                        <p className="text-[10px] font-black text-slate-900 leading-tight mt-0.5">{day.shift.name}</p>
                        <p className="text-[9px] font-bold text-slate-500 mt-1">{day.shift.startTime} – {day.shift.endTime}</p>
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-auto">{day.shift.hoursPerDay}h</p>
                        {day.note && <p className="text-[8px] font-bold text-slate-400 italic truncate">{day.note}</p>}
                      </div>
                    ) : (
                      <div className="flex-1 rounded-2xl border border-dashed border-slate-200 flex items-center justify-center">
                        <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest">Off</span>
                      </div>
                    )}
                  </div>
                );
              })}
        </div>
      </div>

      {/* List view */}
      {!loading && workDays > 0 && (
        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-xl shadow-indigo-500/5 overflow-hidden">
          <div className="px-8 py-5 border-b border-slate-100 bg-slate-50/50">
            <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest">Shift Details</h3>
          </div>
          <div className="divide-y divide-slate-50">
            {roster.filter(d => d.shift).map(day => {
              const d = new Date(day.date + 'T00:00:00');
              const isToday = day.date === today;
              return (
                <div key={day.date} className="flex items-center gap-5 px-8 py-4 hover:bg-slate-50/50 transition-all">
                  <div className={`w-12 h-12 rounded-2xl flex flex-col items-center justify-center shrink-0 ${isToday ? 'bg-indigo-600' : 'bg-slate-100'}`}>
                    <span className={`text-[8px] font-black uppercase tracking-wider ${isToday ? 'text-indigo-200' : 'text-slate-400'}`}>{DAY_NAMES[d.getDay()]}</span>
                    <span className={`text-lg font-black leading-none ${isToday ? 'text-white' : 'text-slate-700'}`}>{d.getDate()}</span>
                  </div>
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: day.shift!.color }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-black text-slate-900 uppercase tracking-tight">{day.shift!.name}</p>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">
                      {day.shift!.startTime} – {day.shift!.endTime} · {day.shift!.hoursPerDay}h
                    </p>
                    {day.note && <p className="text-[9px] font-bold text-slate-400 italic mt-0.5">"{day.note}"</p>}
                  </div>
                  {isToday && (
                    <span className="text-[9px] font-black text-indigo-600 bg-indigo-50 border border-indigo-100 px-3 py-1 rounded-lg uppercase tracking-widest shrink-0">Today</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!loading && workDays === 0 && (
        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-xl shadow-indigo-500/5 py-16 text-center">
          <p className="text-sm font-black text-slate-300 uppercase tracking-widest">No shifts scheduled this week</p>
          <p className="text-[10px] font-bold text-slate-400 mt-2">Your manager will publish shifts here</p>
        </div>
      )}
    </div>
  );
}
