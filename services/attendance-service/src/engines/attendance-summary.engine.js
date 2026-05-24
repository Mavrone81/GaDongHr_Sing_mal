'use strict';
/**
 * TAT-005 attendance-summary engine.
 *
 * Given a list of AttendanceRecord rows for ONE employee in ONE pay period,
 * produces the summary the payroll auto-feed consumes:
 *
 *   { regularHours, otHours (capped), absentDays, lateDays, halfDayDays,
 *     phWorkedDays, expectedWorkDays, rawOtHours }
 *
 * Counting rules:
 *   - regularHours = Σ min(hoursWorked, hoursPerDay) on PRESENT/LATE/HALF_DAY/PUBLIC_HOLIDAY rows
 *   - otHours      = min(Σ otHours on all rows, otMonthlyCap)  (MOM 72h monthly cap)
 *   - rawOtHours   = uncapped sum — kept so the caller can flag a cap breach
 *   - absentDays   = count of rows with status=ABSENT (paid-time-off excluded — those carry status=ON_LEAVE)
 *   - lateDays     = count of rows with status=LATE
 *   - halfDayDays  = count of rows with status=HALF_DAY  (0.5 day each)
 *   - phWorkedDays = count of rows on a date in the PH set with hoursWorked > 0
 *                    (PH-worked entitles employee to PH day pay + OIL or extra-day-pay)
 *
 * Absent-day inference (when no record exists): the engine does NOT manufacture
 * absent days for missing rows. The clock-in flow is expected to upsert a row
 * per attempted day; HR is responsible for end-of-period cleanup before locking.
 * This keeps the engine pure and the source of truth in the database.
 */

const DEFAULT_HOURS_PER_DAY = 8;
const DEFAULT_OT_MONTHLY_CAP = 72;

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Pure summary for a single employee.
 * @param {Array<object>} records  raw AttendanceRecord rows (status, hoursWorked, otHours, date)
 * @param {object} opts
 * @param {number} opts.expectedWorkDays  the period's working-day count (caller-computed)
 * @param {Set<string>} [opts.holidaySet] YYYY-MM-DD strings — used to classify PH-worked
 * @param {number} [opts.hoursPerDay]
 * @param {number} [opts.otMonthlyCap]
 */
function summarizeEmployee(records, { expectedWorkDays, holidaySet = new Set(), hoursPerDay = DEFAULT_HOURS_PER_DAY, otMonthlyCap = DEFAULT_OT_MONTHLY_CAP } = {}) {
  if (!Number.isFinite(expectedWorkDays) || expectedWorkDays < 0) {
    throw new Error('expectedWorkDays must be a non-negative number');
  }
  let regularHours = 0;
  let rawOtHours = 0;
  let absentDays = 0;
  let lateDays = 0;
  let halfDayDays = 0;
  let phWorkedDays = 0;

  for (const r of records || []) {
    // TAT-005: prefer reconciled billable hours when present. They already
    // incorporate the scheduled-time approval workflow — unapproved early/late
    // time has been clipped out. Fall back to raw hoursWorked/otHours for
    // legacy rows or records with no roster.
    const hasBillable = r.billableHours != null;
    const hours = Math.max(0, hasBillable ? r.billableHours : (r.hoursWorked || 0));
    const ot    = Math.max(0, hasBillable ? (r.billableOtHours || 0) : (r.otHours || 0));
    const dStr  = r.date instanceof Date
      ? r.date.toISOString().slice(0, 10)
      : (typeof r.date === 'string' ? r.date.slice(0, 10) : null);

    switch (r.status) {
      case 'PRESENT':
      case 'LATE':
        regularHours += Math.min(hours, hoursPerDay);
        if (r.status === 'LATE') lateDays += 1;
        break;
      case 'HALF_DAY':
        regularHours += Math.min(hours, hoursPerDay / 2);
        halfDayDays += 1;
        break;
      case 'ABSENT':
        absentDays += 1;
        break;
      case 'PUBLIC_HOLIDAY':
        // PH rows only contribute regular hours when the employee actually worked
        if (hours > 0) {
          regularHours += Math.min(hours, hoursPerDay);
          phWorkedDays += 1;
        }
        break;
      case 'ON_LEAVE':
      default:
        // Paid/unpaid leave is reconciled separately by the leave engine — don't double-count.
        break;
    }

    rawOtHours += ot;

    // PH-worked classification by holiday set: catches PRESENT/LATE rows that
    // fall on a PH date without the explicit PUBLIC_HOLIDAY status flag.
    if (dStr && holidaySet.has(dStr) && hours > 0 && r.status !== 'PUBLIC_HOLIDAY') {
      phWorkedDays += 1;
    }
  }

  const otHours = Math.min(rawOtHours, otMonthlyCap);

  return {
    expectedWorkDays,
    regularHours: round2(regularHours),
    otHours:      round2(otHours),
    rawOtHours:   round2(rawOtHours),
    otCapped:     rawOtHours > otMonthlyCap,
    absentDays,
    lateDays,
    halfDayDays,
    phWorkedDays,
  };
}

/**
 * Group raw records by employeeId and summarize each group.
 * @param {Array<object>} allRecords
 * @param {object} opts  same as summarizeEmployee, plus optional `employeeIds`
 *                       to ensure absent-only employees are still represented.
 */
function summarizeAll(allRecords, { expectedWorkDays, holidaySet, hoursPerDay, otMonthlyCap, employeeIds = [] } = {}) {
  const byEmp = new Map();
  for (const r of allRecords || []) {
    if (!byEmp.has(r.employeeId)) byEmp.set(r.employeeId, []);
    byEmp.get(r.employeeId).push(r);
  }
  for (const id of employeeIds) {
    if (!byEmp.has(id)) byEmp.set(id, []);
  }
  const result = {};
  for (const [empId, rows] of byEmp.entries()) {
    result[empId] = summarizeEmployee(rows, { expectedWorkDays, holidaySet, hoursPerDay, otMonthlyCap });
  }
  return result;
}

module.exports = {
  summarizeEmployee,
  summarizeAll,
  DEFAULT_HOURS_PER_DAY,
  DEFAULT_OT_MONTHLY_CAP,
};
