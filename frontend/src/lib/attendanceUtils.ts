// Pure utility functions for attendance period calculations.
// Extracted here so they can be unit-tested without importing the full React page.
//
// All calendar math runs in the business timezone via the helpers in
// `./timezone`: dates are UTC-midnight civil-date anchors, advanced with
// setUTCDate and keyed with toISODate. This keeps day boundaries, ISO keys and
// labels mutually consistent and independent of the viewer's browser timezone
// (the old code mixed local arithmetic with UTC `toISOString()`, which shifted
// every date back a day in Singapore time).

import { BUSINESS_TZ, civilDate, toISODate, formatCivil } from './timezone';

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

/** Returns the Monday (business-TZ) of the week containing date d, as a
 *  UTC-midnight civil-date anchor (ISO week, Mon=start). */
export function getMondayOf(d: Date): Date {
  const out = civilDate(d);
  const day = out.getUTCDay();
  out.setUTCDate(out.getUTCDate() - ((day + 6) % 7));
  return out;
}

/** Returns start/end civil-date anchors and a human-readable label for the
 *  given view mode and offset. */
export function getPeriodBounds(
  mode: ViewMode,
  offset: number,
  today: Date = new Date()
): { start: Date; end: Date; label: string } {
  const fmt = (d: Date) => formatCivil(d, { day: 'numeric', month: 'short' });

  if (mode === 'work-week' || mode === 'week') {
    const monday = getMondayOf(today);
    monday.setUTCDate(monday.getUTCDate() + offset * 7);
    const end = new Date(monday);
    end.setUTCDate(monday.getUTCDate() + (mode === 'work-week' ? 4 : 6));
    return { start: monday, end, label: `${fmt(monday)} – ${fmt(end)} ${end.getUTCFullYear()}` };
  }
  if (mode === 'bi-weekly') {
    const monday = getMondayOf(today);
    monday.setUTCDate(monday.getUTCDate() + offset * 14);
    const end = new Date(monday);
    end.setUTCDate(monday.getUTCDate() + 13);
    return { start: monday, end, label: `${fmt(monday)} – ${fmt(end)} ${end.getUTCFullYear()}` };
  }
  // month
  const base = civilDate(today);
  const y = base.getUTCFullYear();
  const m = base.getUTCMonth();
  const start = new Date(Date.UTC(y, m + offset, 1));
  const end = new Date(Date.UTC(y, m + offset + 1, 0));
  return { start, end, label: formatCivil(start, { month: 'long', year: 'numeric' }) };
}

/** Builds a full list of AttendanceRecord rows covering start→end, merging API data. */
export function buildPeriodLog(
  apiRecords: ApiRecord[],
  start: Date,
  end: Date
): AttendanceRecord[] {
  const recMap = new Map<string, ApiRecord>();
  for (const r of apiRecords) recMap.set(r.date.slice(0, 10), r);

  // Clock timestamps are instants → render them in the business timezone so a
  // viewer abroad still sees the company's wall-clock time.
  const fmtT = (iso: string | null | undefined): string | null =>
    iso ? new Date(iso).toLocaleTimeString('en-SG', { timeZone: BUSINESS_TZ, hour: '2-digit', minute: '2-digit', hour12: true }) : null;

  const rows: AttendanceRecord[] = [];
  const cur = civilDate(start);
  const last = civilDate(end);
  while (cur <= last) {
    const iso = toISODate(cur);
    const dow = cur.getUTCDay();
    const label = formatCivil(cur, { weekday: 'short', day: 'numeric', month: 'short' });
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
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return rows;
}
