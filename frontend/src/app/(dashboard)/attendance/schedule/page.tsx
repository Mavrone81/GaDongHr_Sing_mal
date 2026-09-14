'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { apiFetch } from '@/lib/api';
import { getMondayOf } from '@/lib/attendanceUtils';
import { addDays, toISODate as toISO, todayISO } from '@/lib/timezone';
import { PageHeader, Stat, Card, CardHeader, Button, Badge, EmptyState, Icon } from '@/components/ui';

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

// Week-start, addDays, toISO (toISODate) and today come from the shared
// business-timezone helpers so roster date keys stay consistent across TZs.
const getWeekStart = getMondayOf;

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

  const today = todayISO();

  const weekLabel =
    `${weekStart.getDate()} ${MONTH_NAMES[weekStart.getMonth()]}` +
    (weekStart.getFullYear() !== weekEnd.getFullYear() ? ` ${weekStart.getFullYear()}` : '') +
    ` – ${weekEnd.getDate()} ${MONTH_NAMES[weekEnd.getMonth()]} ${weekEnd.getFullYear()}`;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="My schedule"
        subtitle={weekOffset === 0 ? 'This week' : weekOffset === 1 ? 'Next week' : weekOffset === -1 ? 'Last week' : weekLabel}
        actions={
          <>
            <Button variant="secondary" size="md" aria-label="Previous week" onClick={() => setWeekOffset(w => w - 1)}>
              <Icon name="chevronRight" size={16} className="rotate-180" />
            </Button>
            <Button variant="secondary" onClick={() => setWeekOffset(0)} disabled={weekOffset === 0}>This week</Button>
            <Button variant="secondary" size="md" aria-label="Next week" onClick={() => setWeekOffset(w => w + 1)}>
              <Icon name="chevronRight" size={16} />
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Stat label="Week of" value={<span className="text-[22px]">{weekLabel}</span>} />
        <Stat label="Scheduled hours" value={loading ? '—' : `${totalHours}h`} note="Across the week" />
        <Stat label="Working days" value={loading ? '—' : `${workDays} / 7`} note={loading ? undefined : workDays === 0 ? 'No shifts published yet' : `${7 - workDays} off`} />
      </div>

      {/* Week grid at ≥768px; a stacked list of day cards below that (375 rule). */}
      <Card padding="p-0" className="overflow-hidden">
        <div className="px-5 pt-5 pb-3"><CardHeader title="Week view" caption={weekLabel} className="mb-0" /></div>
        {loading ? (
          <div className="flex items-center justify-center py-16"><div className="w-8 h-8 border-4 border-accent border-t-accent animate-spin rounded-full" /></div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-7 md:divide-x divide-y md:divide-y-0 divide-rule border-t border-rule">
            {roster.map((day) => {
              const d = new Date(day.date + 'T00:00:00');
              const isToday = day.date === today;
              const isWeekend = d.getDay() === 0 || d.getDay() === 6;
              return (
                <div key={day.date} className={`flex md:flex-col gap-3 md:gap-2 p-4 md:min-h-[200px] ${isWeekend ? 'bg-page' : ''}`}>
                  <div className="flex md:flex-col items-center gap-2 md:gap-1 md:mb-1 shrink-0 w-14 md:w-auto">
                    <span className="text-xs font-semibold text-muted">{DAY_NAMES[d.getDay()]}</span>
                    <span className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold tabular-nums ${isToday ? 'bg-accent text-on-accent' : 'text-ink'}`}>{d.getDate()}</span>
                  </div>
                  {day.shift ? (
                    <div className="flex-1 flex flex-col gap-1 p-3 rounded-control border border-rule bg-paper min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: day.shift.color }} aria-hidden="true" />
                        <span className="text-sm font-semibold text-ink truncate">{day.shift.name}</span>
                      </div>
                      <span className="text-xs text-muted tabular-nums">{day.shift.startTime} – {day.shift.endTime}</span>
                      <span className="text-xs font-semibold text-ink mt-auto tabular-nums">{day.shift.hoursPerDay}h</span>
                      {day.note && <span className="text-xs text-muted truncate">{day.note}</span>}
                    </div>
                  ) : (
                    <div className="flex-1 flex items-center justify-center min-h-[44px] rounded-control border border-dashed border-rule text-xs font-semibold text-faint">Off</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {!loading && workDays > 0 && (
        <Card padding="p-0" className="overflow-hidden">
          <div className="px-5 pt-5 pb-3"><CardHeader title="Shift details" className="mb-0" /></div>
          <div className="flex flex-col divide-y divide-rule border-t border-rule">
            {roster.filter(d => d.shift).map(day => {
              const d = new Date(day.date + 'T00:00:00');
              const isToday = day.date === today;
              return (
                <div key={day.date} className="flex items-center gap-4 px-5 py-3.5 hover:bg-page">
                  <div className={`flex flex-col items-center justify-center w-12 h-12 rounded-control shrink-0 ${isToday ? 'bg-accent text-on-accent' : 'bg-pill text-ink'}`}>
                    <span className={`text-xs font-semibold ${isToday ? 'text-on-accent' : 'text-muted'}`}>{DAY_NAMES[d.getDay()]}</span>
                    <span className="text-lg font-bold leading-none tabular-nums">{d.getDate()}</span>
                  </div>
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: day.shift!.color }} aria-hidden="true" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-ink truncate">{day.shift!.name}</p>
                    <p className="text-xs text-muted tabular-nums">{day.shift!.startTime} – {day.shift!.endTime} · {day.shift!.hoursPerDay}h</p>
                    {day.note && <p className="text-xs text-muted truncate mt-0.5">{day.note}</p>}
                  </div>
                  {isToday && <Badge tone="accent">Today</Badge>}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {!loading && workDays === 0 && (
        <Card padding="p-0">
          <EmptyState
            icon="calendar"
            title="No shifts this week"
            description="Your manager publishes shifts here. Check back once the roster is out, or look at another week."
          />
        </Card>
      )}
    </div>
  );
}
