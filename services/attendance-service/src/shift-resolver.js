'use strict';
/**
 * TAT-005 shift resolver.
 *
 * Given an employeeId and a calendar date, return the effective shift bounds
 * (scheduledStart/scheduledEnd as Dates in SGT) plus the bookkeeping fields
 * the reconciliation engine needs (breakMinutes, hoursPerDay, grace windows).
 *
 * Lookup priority on the RosterEntry for that date:
 *   1. workingShiftId → WorkingShift
 *   2. shiftTemplateId → ShiftTemplate
 *   3. shiftPatternId → ShiftPattern
 *
 * Returns null if there's no roster entry or no resolvable shift — caller
 * falls back to "no schedule" behaviour (reconciliation treats this as
 * NOT_APPLICABLE on both sides; billable = raw clock times).
 */

// Singapore is UTC+8 year-round.
const SGT_OFFSET_MINUTES = 8 * 60;

/**
 * Combine a calendar date (any time) with a "HH:mm" string interpreted in SGT,
 * returning the matching UTC Date.
 */
function makeSgtDate(date, hhmm) {
  if (!hhmm || typeof hhmm !== 'string') return null;
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hours = parseInt(m[1], 10);
  const minutes = parseInt(m[2], 10);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  // Date components in SGT — convert via offset.
  const sgtMs = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hours, minutes, 0);
  return new Date(sgtMs - SGT_OFFSET_MINUTES * 60 * 1000);
}

/**
 * Resolve a shift descriptor (template / working / pattern) into a normalised
 * object. Patterns don't carry per-day work flags, so they're treated as
 * always-on for the day they're assigned to.
 */
function normalizeShift(workingShift, shiftTemplate, shiftPattern) {
  if (workingShift) {
    return {
      startTime: workingShift.startTime,
      endTime: workingShift.endTime,
      breakMinutes: workingShift.breakMinutes ?? 60,
      hoursPerDay: workingShift.hoursPerDay ?? 8,
      graceMinutesEarly: workingShift.graceMinutesEarly ?? 15,
      graceMinutesLate: workingShift.graceMinutesLate ?? 15,
      source: 'workingShift',
    };
  }
  if (shiftTemplate) {
    return {
      startTime: shiftTemplate.startTime,
      endTime: shiftTemplate.endTime,
      breakMinutes: shiftTemplate.breakMinutes ?? 60,
      hoursPerDay: shiftTemplate.hoursPerDay ?? 8,
      graceMinutesEarly: shiftTemplate.graceMinutesEarly ?? 15,
      graceMinutesLate: shiftTemplate.graceMinutesLate ?? 15,
      source: 'shiftTemplate',
    };
  }
  if (shiftPattern) {
    return {
      startTime: shiftPattern.startTime,
      endTime: shiftPattern.endTime,
      breakMinutes: shiftPattern.breakMinutes ?? 60,
      hoursPerDay: shiftPattern.hoursPerShift ?? 8,
      // Patterns currently don't carry grace fields — fall back to defaults.
      graceMinutesEarly: 15,
      graceMinutesLate: 15,
      source: 'shiftPattern',
    };
  }
  return null;
}

/**
 * Resolve the scheduled bounds for one employee on one date.
 * @param {object} prisma  PrismaClient instance
 * @param {string} employeeId
 * @param {Date}   date    midnight-aligned date (matches AttendanceRecord.date)
 * @returns {Promise<object|null>}  { scheduledStart, scheduledEnd, breakMinutes, hoursPerDay, graceMinutesEarly, graceMinutesLate, source }
 */
async function resolveSchedule(prisma, employeeId, date) {
  const entry = await prisma.rosterEntry.findUnique({
    where: { employeeId_date: { employeeId, date } },
    include: {
      shiftTemplate: true,
      workingShift: true,
      shiftPattern: true,
    },
  });
  if (!entry) return null;

  const shift = normalizeShift(entry.workingShift, entry.shiftTemplate, entry.shiftPattern);
  if (!shift) return null;

  const scheduledStart = makeSgtDate(date, shift.startTime);
  const scheduledEnd   = makeSgtDate(date, shift.endTime);
  if (!scheduledStart || !scheduledEnd) return null;

  // Overnight shifts (end < start) — bump end by one day.
  if (scheduledEnd < scheduledStart) {
    scheduledEnd.setUTCDate(scheduledEnd.getUTCDate() + 1);
  }

  return {
    scheduledStart,
    scheduledEnd,
    breakMinutes: shift.breakMinutes,
    hoursPerDay: shift.hoursPerDay,
    graceMinutesEarly: shift.graceMinutesEarly,
    graceMinutesLate: shift.graceMinutesLate,
    source: shift.source,
  };
}

module.exports = {
  resolveSchedule,
  makeSgtDate,
  normalizeShift,
};
