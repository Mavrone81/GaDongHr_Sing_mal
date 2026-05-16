// Pure utility functions for attendance period calculations.
// Extracted here so they can be unit-tested without importing the full React page.

export type ViewMode = 'work-week' | 'week' | 'bi-weekly' | 'month';

export interface AttendanceRecord {
  date: string;
  isoDate: string;
  dayOfWeek: number;
  clockIn: string | null;
  clockOut: string | null;
  duration: string | null;
  status: 'present' | 'half' | 'absent' | 'leave' | 'weekend';
}

export type ApiRecord = {
  date: string;
  clockIn?: string | null;
  clockOut?: string | null;
  hoursWorked?: number | null;
  status?: string;
};

/** Returns the Monday of the week containing date d (ISO week, Mon=start). */
export function getMondayOf(d: Date): Date {
  const out = new Date(d);
  const day = out.getDay();
  out.setDate(out.getDate() - ((day + 6) % 7));
  out.setHours(0, 0, 0, 0);
  return out;
}

/** Returns start/end Date and a human-readable label for the given view mode and offset. */
export function getPeriodBounds(
  mode: ViewMode,
  offset: number,
  today: Date = new Date()
): { start: Date; end: Date; label: string } {
  const fmt = (d: Date) => d.toLocaleDateString('en-SG', { day: 'numeric', month: 'short' });

  if (mode === 'work-week' || mode === 'week') {
    const monday = getMondayOf(today);
    monday.setDate(monday.getDate() + offset * 7);
    const end = new Date(monday);
    end.setDate(monday.getDate() + (mode === 'work-week' ? 4 : 6));
    return { start: monday, end, label: `${fmt(monday)} – ${fmt(end)} ${end.getFullYear()}` };
  }
  if (mode === 'bi-weekly') {
    const monday = getMondayOf(today);
    monday.setDate(monday.getDate() + offset * 14);
    const end = new Date(monday);
    end.setDate(monday.getDate() + 13);
    return { start: monday, end, label: `${fmt(monday)} – ${fmt(end)} ${end.getFullYear()}` };
  }
  // month
  const d = new Date(today.getFullYear(), today.getMonth() + offset, 1);
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { start, end, label: start.toLocaleDateString('en-SG', { month: 'long', year: 'numeric' }) };
}

/** Builds a full list of AttendanceRecord rows covering start→end, merging API data. */
export function buildPeriodLog(
  apiRecords: ApiRecord[],
  start: Date,
  end: Date
): AttendanceRecord[] {
  const recMap = new Map<string, ApiRecord>();
  for (const r of apiRecords) recMap.set(r.date.slice(0, 10), r);

  const fmtT = (iso: string | null | undefined): string | null =>
    iso ? new Date(iso).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', hour12: true }) : null;

  const rows: AttendanceRecord[] = [];
  const cur = new Date(start);
  while (cur <= end) {
    const iso = cur.toISOString().slice(0, 10);
    const dow = cur.getDay();
    const label = cur.toLocaleDateString('en-SG', { weekday: 'short', day: 'numeric', month: 'short' });
    const isWeekend = dow === 0 || dow === 6;
    const rec = recMap.get(iso);

    if (!rec) {
      rows.push({ date: label, isoDate: iso, dayOfWeek: dow, clockIn: null, clockOut: null, duration: null, status: isWeekend ? 'weekend' : 'absent' });
    } else {
      const dur = rec.hoursWorked != null
        ? `${Math.floor(rec.hoursWorked)}h ${Math.round((rec.hoursWorked % 1) * 60)}m`
        : null;
      let status: AttendanceRecord['status'] = 'present';
      if (rec.status === 'HALF_DAY') status = 'half';
      else if (rec.status === 'LEAVE') status = 'leave';
      rows.push({ date: label, isoDate: iso, dayOfWeek: dow, clockIn: fmtT(rec.clockIn), clockOut: fmtT(rec.clockOut), duration: dur, status });
    }
    cur.setDate(cur.getDate() + 1);
  }
  return rows;
}
