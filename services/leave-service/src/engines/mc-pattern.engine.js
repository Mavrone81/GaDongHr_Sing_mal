'use strict';

const DEFAULT_THRESHOLDS = { minOccurrences: 3, minRatio: 0.5 };

/**
 * Returns array of {date, dow} for weekdays (Mon-Fri) in [startDate, endDate] inclusive.
 * @param {Date|string} startDate
 * @param {Date|string} endDate
 * @returns {{ date: Date, dow: number }[]}  dow: 1=Mon … 5=Fri
 */
function expandWeekdays(startDate, endDate) {
  const result = [];
  const current = new Date(startDate);
  current.setUTCHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setUTCHours(0, 0, 0, 0);

  while (current <= end) {
    const dow = current.getUTCDay(); // 0=Sun … 6=Sat
    if (dow >= 1 && dow <= 5) {
      result.push({ date: new Date(current), dow });
    }
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return result;
}

/**
 * Determines pattern type and severity string from Mon/Fri counts.
 */
function _classify(monCount, friCount, total) {
  const monRatio = total > 0 ? monCount / total : 0;
  const friRatio = total > 0 ? friCount / total : 0;
  const bothRatio = total > 0 ? (monCount + friCount) / total : 0;

  let patternType = null;
  let ratio = 0;

  if (monRatio >= 0.3 && friRatio >= 0.3) {
    patternType = 'MONDAY_FRIDAY_PATTERN';
    ratio = bothRatio;
  } else if (monRatio >= friRatio && monRatio >= 0.3) {
    patternType = 'MONDAY_PATTERN';
    ratio = monRatio;
  } else if (friRatio > monRatio && friRatio >= 0.3) {
    patternType = 'FRIDAY_PATTERN';
    ratio = friRatio;
  }

  let severity = 'LOW';
  if (ratio >= 0.75) severity = 'HIGH';
  else if (ratio >= 0.5) severity = 'MEDIUM';

  return { patternType, ratio, severity };
}

/**
 * Detect Mon/Fri MC abuse patterns for a list of leave applications.
 *
 * @param {Array<{ employeeId: string, startDate: Date|string, endDate: Date|string }>} applications
 * @param {{ minOccurrences?: number, minRatio?: number }} thresholds
 * @returns {Array} flagged employees sorted by monFriRatio desc
 */
function detectPatterns(applications, thresholds = {}) {
  const { minOccurrences, minRatio } = { ...DEFAULT_THRESHOLDS, ...thresholds };

  // Aggregate per employee
  const stats = new Map();

  for (const app of applications) {
    const days = expandWeekdays(app.startDate, app.endDate);
    if (!days.length) continue;

    if (!stats.has(app.employeeId)) {
      stats.set(app.employeeId, { total: 0, monday: 0, friday: 0, occurrences: 0 });
    }
    const s = stats.get(app.employeeId);
    s.occurrences += 1;
    for (const { dow } of days) {
      s.total += 1;
      if (dow === 1) s.monday += 1;
      if (dow === 5) s.friday += 1;
    }
  }

  const flagged = [];
  for (const [employeeId, s] of stats) {
    if (s.occurrences < minOccurrences) continue;
    const { patternType, ratio, severity } = _classify(s.monday, s.friday, s.total);
    if (!patternType || ratio < minRatio) continue;

    flagged.push({
      employeeId,
      occurrences: s.occurrences,
      totalSickDays: s.total,
      mondayCount: s.monday,
      fridayCount: s.friday,
      monFriRatio: Math.round(ratio * 1000) / 1000,
      patternType,
      severity,
    });
  }

  flagged.sort((a, b) => b.monFriRatio - a.monFriRatio);
  return flagged;
}

/**
 * Aggregate sick leave trends by employee and by department.
 *
 * @param {Array<{ employeeId: string, startDate: Date|string, endDate: Date|string, totalDays: number }>} applications
 * @param {Map<string, { name: string, department: string }>} employeeMap  employeeId → { name, department }
 * @returns {{ byEmployee: Array, byDepartment: Array }}
 */
function buildTrends(applications, employeeMap) {
  const empStats = new Map();   // employeeId → { name, department, totalDays, occurrences, monthlyBreakdown }
  const deptStats = new Map();  // department  → { totalDays, occurrences, employeeCount }

  for (const app of applications) {
    const days = typeof app.totalDays === 'number' ? app.totalDays
      : expandWeekdays(app.startDate, app.endDate).length;
    const month = new Date(app.startDate).toISOString().slice(0, 7); // YYYY-MM

    const emp = employeeMap.get(app.employeeId) || {};
    const name = emp.name || app.employeeId;
    const department = emp.department || 'Unknown';

    // Per-employee
    if (!empStats.has(app.employeeId)) {
      empStats.set(app.employeeId, { employeeId: app.employeeId, name, department, totalDays: 0, occurrences: 0, monthlyBreakdown: {} });
    }
    const es = empStats.get(app.employeeId);
    es.totalDays += days;
    es.occurrences += 1;
    es.monthlyBreakdown[month] = (es.monthlyBreakdown[month] || 0) + days;

    // Per-department
    if (!deptStats.has(department)) {
      deptStats.set(department, { department, totalDays: 0, occurrences: 0, employeeIds: new Set() });
    }
    const ds = deptStats.get(department);
    ds.totalDays += days;
    ds.occurrences += 1;
    ds.employeeIds.add(app.employeeId);
  }

  const byEmployee = [...empStats.values()]
    .sort((a, b) => b.totalDays - a.totalDays)
    .map(e => ({ ...e, monthlyBreakdown: e.monthlyBreakdown }));

  const byDepartment = [...deptStats.values()]
    .sort((a, b) => b.totalDays - a.totalDays)
    .map(({ employeeIds, ...rest }) => ({ ...rest, employeeCount: employeeIds.size }));

  return { byEmployee, byDepartment };
}

module.exports = { expandWeekdays, detectPatterns, buildTrends, DEFAULT_THRESHOLDS };
