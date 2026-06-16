// ─────────────────────────────────────────────────────────────────────────────
// Centralised business-timezone handling.
//
// WHY THIS EXISTS
//   Date-only values in HR (an attendance day, a leave date, a roster cell, a
//   period boundary) belong to the *company's* calendar, not the viewer's
//   browser. The old code derived these keys with `Date#toISOString()` (UTC)
//   while doing the surrounding arithmetic in browser-local time — so for any
//   timezone east of UTC (Singapore = +08, and the whole intended market) the
//   day silently shifted back by one. CI ran in UTC and never caught it.
//
//   Every helper here resolves the calendar date *in BUSINESS_TZ* and anchors it
//   at UTC-midnight, so subsequent get/setUTC* arithmetic is calendar-exact and
//   completely independent of the runner/browser timezone. SG, MY and ID observe
//   no daylight saving, so a fixed-offset UTC-midnight anchor is exact.
//
// FORWARD COMPATIBILITY
//   Today every tenant runs on Singapore time, so BUSINESS_TZ is a constant.
//   When per-tenant timezones land (Malaysia / Indonesia / …), thread the
//   tenant's IANA zone through the optional `tz` argument these helpers already
//   accept — no call-site math changes.
//
//   ⚠ DO NOT use this for CPF / IRAS / SDL / MOM payroll computations. Those are
//   statutorily Singapore-time and are computed server-side in the payroll
//   service; they must stay SGT regardless of a tenant's display timezone.
// ─────────────────────────────────────────────────────────────────────────────

/** The tenant's business timezone. Phase 1 will source this per-tenant. */
export const BUSINESS_TZ = 'Asia/Singapore';

/** Calendar Y/M/D of an instant as seen in `tz`. */
function civilParts(instant: Date, tz: string): { y: number; m: number; d: number } {
  // en-CA renders as YYYY-MM-DD; parse defensively from the numeric parts.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

/**
 * The calendar date of `instant`, as seen in `tz`, anchored at UTC-midnight.
 * The returned Date is a stable civil-date token: read it back with `toISODate`
 * or with `getUTC*`, and advance it with `setUTCDate` — never with local getters.
 */
export function civilDate(instant: Date = new Date(), tz: string = BUSINESS_TZ): Date {
  const { y, m, d } = civilParts(instant, tz);
  return new Date(Date.UTC(y, m - 1, d));
}

/** `YYYY-MM-DD` for a civil-date anchor (reads UTC parts — never local). */
export function toISODate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** Today's business date as `YYYY-MM-DD`, independent of the viewer's browser TZ. */
export function todayISO(tz: string = BUSINESS_TZ): string {
  return toISODate(civilDate(new Date(), tz));
}

/** A new civil-date anchor `n` days after `d` (UTC arithmetic; n may be negative). */
export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

/** Format a civil-date anchor for display, reading the anchor's UTC parts. */
export function formatCivil(
  d: Date,
  opts: Intl.DateTimeFormatOptions,
  locale = 'en-SG',
): string {
  return d.toLocaleDateString(locale, { timeZone: 'UTC', ...opts });
}
