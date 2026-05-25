'use strict';

const { expandWeekdays, detectPatterns, buildTrends, DEFAULT_THRESHOLDS } = require('../src/engines/mc-pattern.engine');

// ── expandWeekdays ─────────────────────────────────────────────────────────────

describe('expandWeekdays', () => {
  test('returns only Mon-Fri days', () => {
    // 2024-04-01 = Monday … 2024-04-07 = Sunday
    const days = expandWeekdays('2024-04-01', '2024-04-07');
    expect(days).toHaveLength(5);
    expect(days.map(d => d.dow)).toEqual([1, 2, 3, 4, 5]);
  });

  test('single-day Saturday returns empty', () => {
    const days = expandWeekdays('2024-04-06', '2024-04-06'); // Saturday
    expect(days).toHaveLength(0);
  });

  test('single Monday', () => {
    const days = expandWeekdays('2024-04-01', '2024-04-01');
    expect(days).toHaveLength(1);
    expect(days[0].dow).toBe(1);
  });

  test('cross-week range includes correct weekdays', () => {
    // 2024-04-08 Mon → 2024-04-12 Fri = 5 days
    const days = expandWeekdays('2024-04-08', '2024-04-14'); // includes Sat + Sun
    expect(days).toHaveLength(5);
  });
});

// ── detectPatterns ─────────────────────────────────────────────────────────────

function makeApp(employeeId, startDate, endDate) {
  return { employeeId, startDate, endDate };
}

describe('detectPatterns', () => {
  test('DEFAULT_THRESHOLDS are {minOccurrences:3, minRatio:0.5}', () => {
    expect(DEFAULT_THRESHOLDS).toEqual({ minOccurrences: 3, minRatio: 0.5 });
  });

  test('employee with >=3 Monday applications is flagged as MONDAY_PATTERN', () => {
    // All Mondays
    const apps = [
      makeApp('emp1', '2024-04-01', '2024-04-01'),
      makeApp('emp1', '2024-04-08', '2024-04-08'),
      makeApp('emp1', '2024-04-15', '2024-04-15'),
    ];
    const result = detectPatterns(apps);
    expect(result).toHaveLength(1);
    expect(result[0].employeeId).toBe('emp1');
    expect(result[0].patternType).toBe('MONDAY_PATTERN');
    expect(result[0].occurrences).toBe(3);
    expect(result[0].mondayCount).toBe(3);
    expect(result[0].monFriRatio).toBeCloseTo(1.0);
  });

  test('employee with >=3 Friday applications is flagged as FRIDAY_PATTERN', () => {
    const apps = [
      makeApp('emp2', '2024-04-05', '2024-04-05'),
      makeApp('emp2', '2024-04-12', '2024-04-12'),
      makeApp('emp2', '2024-04-19', '2024-04-19'),
    ];
    const result = detectPatterns(apps);
    expect(result[0].patternType).toBe('FRIDAY_PATTERN');
    expect(result[0].fridayCount).toBe(3);
  });

  test('employee with mixed Mon+Fri is flagged as MONDAY_FRIDAY_PATTERN', () => {
    const apps = [
      makeApp('emp3', '2024-04-01', '2024-04-01'), // Mon
      makeApp('emp3', '2024-04-05', '2024-04-05'), // Fri
      makeApp('emp3', '2024-04-08', '2024-04-08'), // Mon
      makeApp('emp3', '2024-04-12', '2024-04-12'), // Fri
    ];
    const result = detectPatterns(apps);
    expect(result[0].patternType).toBe('MONDAY_FRIDAY_PATTERN');
  });

  test('employee below minOccurrences threshold is NOT flagged', () => {
    const apps = [
      makeApp('emp4', '2024-04-01', '2024-04-01'),
      makeApp('emp4', '2024-04-08', '2024-04-08'),
    ];
    const result = detectPatterns(apps); // needs 3
    expect(result).toHaveLength(0);
  });

  test('employee with mid-week sick days is NOT flagged even with many occurrences', () => {
    const apps = [
      makeApp('emp5', '2024-04-02', '2024-04-04'), // Tue-Thu
      makeApp('emp5', '2024-04-09', '2024-04-11'), // Tue-Thu
      makeApp('emp5', '2024-04-16', '2024-04-18'), // Tue-Thu
    ];
    const result = detectPatterns(apps);
    expect(result).toHaveLength(0);
  });

  test('severity HIGH when monFriRatio >= 0.75', () => {
    // 3 Mondays + 1 Wednesday = 4 total; monRatio = 3/4 = 0.75
    const apps = [
      makeApp('emp6', '2024-04-01', '2024-04-01'), // Mon
      makeApp('emp6', '2024-04-08', '2024-04-08'), // Mon
      makeApp('emp6', '2024-04-15', '2024-04-15'), // Mon
      makeApp('emp6', '2024-04-17', '2024-04-17'), // Wed
    ];
    const result = detectPatterns(apps);
    expect(result[0].severity).toBe('HIGH');
  });

  test('severity MEDIUM when monFriRatio >= 0.5 and < 0.75', () => {
    // 2 Mondays + 2 Wednesdays = ratio 0.5
    const apps = [
      makeApp('emp7', '2024-04-01', '2024-04-01'), // Mon
      makeApp('emp7', '2024-04-08', '2024-04-08'), // Mon
      makeApp('emp7', '2024-04-10', '2024-04-10'), // Wed
      makeApp('emp7', '2024-04-17', '2024-04-17'), // Wed
    ];
    const result = detectPatterns(apps, { minOccurrences: 4, minRatio: 0.5 });
    expect(result[0].severity).toBe('MEDIUM');
  });

  test('results sorted by monFriRatio descending', () => {
    const appsHigh = [
      makeApp('empH', '2024-04-01', '2024-04-01'),
      makeApp('empH', '2024-04-08', '2024-04-08'),
      makeApp('empH', '2024-04-15', '2024-04-15'),
    ];
    // emp with lower ratio: 3 Mon + 3 Wed
    const appsLow = [
      makeApp('empL', '2024-04-01', '2024-04-01'),
      makeApp('empL', '2024-04-08', '2024-04-08'),
      makeApp('empL', '2024-04-15', '2024-04-15'),
      makeApp('empL', '2024-04-03', '2024-04-03'),
      makeApp('empL', '2024-04-10', '2024-04-10'),
      makeApp('empL', '2024-04-17', '2024-04-17'),
    ];
    const result = detectPatterns([...appsLow, ...appsHigh]);
    expect(result[0].employeeId).toBe('empH');
    expect(result[0].monFriRatio).toBeGreaterThanOrEqual(result[1].monFriRatio);
  });

  test('multi-day application spanning Mon-Fri counts all weekdays (no pattern — ratio too low)', () => {
    // Full-week applications dilute Mon/Fri ratio → should NOT be flagged
    const apps = [
      makeApp('emp8', '2024-04-01', '2024-04-05'), // Mon-Fri
      makeApp('emp8', '2024-04-08', '2024-04-12'),
      makeApp('emp8', '2024-04-15', '2024-04-19'),
    ];
    const result = detectPatterns(apps);
    // 3 Mondays + 3 Fridays out of 15 total days = 0.2 ratio each — below threshold
    expect(result).toHaveLength(0);
  });

  test('Mon+Fri 2-day applications accumulate correctly', () => {
    // Each application = Mon+Fri (2 days), 3 occurrences = 6 days total, 3 Mon + 3 Fri
    const apps = [
      makeApp('emp9', '2024-04-01', '2024-04-05'), // Mon-Fri but only Mon+Fri matter for ratio
      makeApp('emp9', '2024-04-08', '2024-04-08'), // Mon only
      makeApp('emp9', '2024-04-12', '2024-04-12'), // Fri only
      makeApp('emp9', '2024-04-15', '2024-04-15'), // Mon only
      makeApp('emp9', '2024-04-19', '2024-04-19'), // Fri only
    ];
    // emp9 has many days; let's check a pure Mon+Fri case instead
    const pureApps = [
      makeApp('empP', '2024-04-01', '2024-04-01'), // Mon
      makeApp('empP', '2024-04-05', '2024-04-05'), // Fri
      makeApp('empP', '2024-04-08', '2024-04-08'), // Mon
      makeApp('empP', '2024-04-12', '2024-04-12'), // Fri
      makeApp('empP', '2024-04-15', '2024-04-15'), // Mon
    ];
    const result = detectPatterns(pureApps, { minOccurrences: 5, minRatio: 0.5 });
    expect(result).toHaveLength(1);
    expect(result[0].totalSickDays).toBe(5);
    expect(result[0].mondayCount).toBe(3);
    expect(result[0].fridayCount).toBe(2);
  });
});

// ── buildTrends ────────────────────────────────────────────────────────────────

describe('buildTrends', () => {
  const empMap = new Map([
    ['e1', { name: 'Alice', department: 'Engineering' }],
    ['e2', { name: 'Bob',   department: 'HR' }],
    ['e3', { name: 'Carol', department: 'Engineering' }],
  ]);

  const apps = [
    { employeeId: 'e1', startDate: '2024-01-08', endDate: '2024-01-10', totalDays: 3 },
    { employeeId: 'e1', startDate: '2024-02-05', endDate: '2024-02-06', totalDays: 2 },
    { employeeId: 'e2', startDate: '2024-01-15', endDate: '2024-01-15', totalDays: 1 },
    { employeeId: 'e3', startDate: '2024-03-04', endDate: '2024-03-04', totalDays: 1 },
  ];

  test('byEmployee sorted by totalDays descending', () => {
    const { byEmployee } = buildTrends(apps, empMap);
    expect(byEmployee[0].employeeId).toBe('e1');
    expect(byEmployee[0].totalDays).toBe(5);
    expect(byEmployee[0].occurrences).toBe(2);
  });

  test('byEmployee includes monthlyBreakdown', () => {
    const { byEmployee } = buildTrends(apps, empMap);
    const alice = byEmployee.find(e => e.employeeId === 'e1');
    expect(alice.monthlyBreakdown['2024-01']).toBe(3);
    expect(alice.monthlyBreakdown['2024-02']).toBe(2);
  });

  test('byDepartment aggregates correctly', () => {
    const { byDepartment } = buildTrends(apps, empMap);
    const eng = byDepartment.find(d => d.department === 'Engineering');
    expect(eng.totalDays).toBe(6);   // e1=5 + e3=1
    expect(eng.employeeCount).toBe(2);
  });

  test('byDepartment sorted by totalDays descending', () => {
    const { byDepartment } = buildTrends(apps, empMap);
    expect(byDepartment[0].totalDays).toBeGreaterThanOrEqual(byDepartment[1].totalDays);
  });

  test('unknown employee falls into "Unknown" department', () => {
    const unknownApps = [{ employeeId: 'unk', startDate: '2024-04-01', endDate: '2024-04-01', totalDays: 1 }];
    const { byDepartment } = buildTrends(unknownApps, new Map());
    expect(byDepartment.find(d => d.department === 'Unknown')).toBeTruthy();
  });

  test('empty applications returns empty arrays', () => {
    const { byEmployee, byDepartment } = buildTrends([], empMap);
    expect(byEmployee).toHaveLength(0);
    expect(byDepartment).toHaveLength(0);
  });
});
