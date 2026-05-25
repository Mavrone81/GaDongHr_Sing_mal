'use strict';

const { groupBySector, computeDrcStatus, MOM_DEFAULTS, PASS_TYPES_IN_DRC, LOCAL_CITIZEN_STATUSES } = require('../src/engines/drc.engine');

// ── helpers ───────────────────────────────────────────────────────────────────

function emp(overrides) {
  return { citizenshipStatus: 'SC', passType: null, workPassSector: null, ...overrides };
}

// ── groupBySector ─────────────────────────────────────────────────────────────

describe('groupBySector', () => {
  test('WP employee assigned to their workPassSector', () => {
    const groups = groupBySector([emp({ passType: 'WP', workPassSector: 'CONSTRUCTION', citizenshipStatus: 'FOREIGNER' })]);
    expect(groups.get('CONSTRUCTION').wp).toBe(1);
    expect(groups.get('CONSTRUCTION').sPass).toBe(0);
  });

  test('S_PASS employee assigned to their workPassSector', () => {
    const groups = groupBySector([emp({ passType: 'S_PASS', workPassSector: 'SERVICES', citizenshipStatus: 'FOREIGNER' })]);
    expect(groups.get('SERVICES').sPass).toBe(1);
    expect(groups.get('SERVICES').wp).toBe(0);
  });

  test('SC employee goes into LOCAL bucket', () => {
    const groups = groupBySector([emp({ citizenshipStatus: 'SC' })]);
    expect(groups.get('LOCAL').localCount).toBe(1);
  });

  test('PR_YEAR1 employee counted as local', () => {
    const groups = groupBySector([emp({ citizenshipStatus: 'PR_YEAR1' })]);
    expect(groups.get('LOCAL').localCount).toBe(1);
  });

  test('EP holder is exempt — not counted anywhere', () => {
    const groups = groupBySector([emp({ passType: 'EP', workPassSector: 'SERVICES', citizenshipStatus: 'FOREIGNER' })]);
    expect(groups.has('SERVICES')).toBe(false);
    expect(groups.has('LOCAL')).toBe(false);
  });

  test('employee with no passType and no citizenshipStatus goes to LOCAL', () => {
    const groups = groupBySector([{ passType: null, workPassSector: null }]);
    expect(groups.get('LOCAL').localCount).toBe(1);
  });

  test('WP without workPassSector defaults to SERVICES sector', () => {
    const groups = groupBySector([emp({ passType: 'WP', workPassSector: null, citizenshipStatus: 'FOREIGNER' })]);
    expect(groups.get('SERVICES').wp).toBe(1);
  });

  test('multiple employees across sectors', () => {
    const employees = [
      emp({ citizenshipStatus: 'SC' }),
      emp({ citizenshipStatus: 'PR_YEAR1' }),
      emp({ passType: 'WP', workPassSector: 'CONSTRUCTION', citizenshipStatus: 'FOREIGNER' }),
      emp({ passType: 'WP', workPassSector: 'CONSTRUCTION', citizenshipStatus: 'FOREIGNER' }),
      emp({ passType: 'S_PASS', workPassSector: 'CONSTRUCTION', citizenshipStatus: 'FOREIGNER' }),
      emp({ passType: 'S_PASS', workPassSector: 'SERVICES', citizenshipStatus: 'FOREIGNER' }),
    ];
    const groups = groupBySector(employees);
    expect(groups.get('LOCAL').localCount).toBe(2);
    expect(groups.get('CONSTRUCTION').wp).toBe(2);
    expect(groups.get('CONSTRUCTION').sPass).toBe(1);
    expect(groups.get('SERVICES').sPass).toBe(1);
    expect(groups.get('SERVICES').wp).toBe(0);
  });
});

// ── computeDrcStatus ──────────────────────────────────────────────────────────

describe('computeDrcStatus', () => {
  const serviceQuotas = [
    { sector: 'SERVICES', passType: 'WP',     maxRatioPct: 15.0, alertThreshPct: 80.0 },
    { sector: 'SERVICES', passType: 'S_PASS',  maxRatioPct: 15.0, alertThreshPct: 80.0 },
  ];

  test('OK when well below ceiling', () => {
    const groups = new Map([
      ['LOCAL',    { localCount: 90, wp: 0, sPass: 0 }],
      ['SERVICES', { wp: 5, sPass: 2, localCount: 0 }],
    ]);
    const results = computeDrcStatus(groups, serviceQuotas);
    const wp = results.find(r => r.sector === 'SERVICES' && r.passType === 'WP');
    expect(wp.status).toBe('OK');
    expect(wp.fwCount).toBe(5);
    expect(wp.localCount).toBe(90);
  });

  test('WARNING when usagePct >= alertThreshPct (80% of ceiling)', () => {
    // 15% ceiling: warning at 12%. total=100, wp=12 → 12% → 80% of 15 = OK threshold
    // Set wp=12, local=81, sPass=7 → total=100, wpRatio=12% → usagePct=80%
    const groups = new Map([
      ['LOCAL',    { localCount: 81, wp: 0, sPass: 0 }],
      ['SERVICES', { wp: 12, sPass: 7, localCount: 0 }],
    ]);
    const results = computeDrcStatus(groups, serviceQuotas);
    const wp = results.find(r => r.sector === 'SERVICES' && r.passType === 'WP');
    expect(wp.status).toBe('WARNING');
  });

  test('EXCEEDED when currentRatioPct > maxRatioPct', () => {
    // 15% ceiling: 20 WP out of 100 total = 20%
    const groups = new Map([
      ['LOCAL',    { localCount: 80, wp: 0, sPass: 0 }],
      ['SERVICES', { wp: 20, sPass: 0, localCount: 0 }],
    ]);
    const results = computeDrcStatus(groups, serviceQuotas);
    const wp = results.find(r => r.sector === 'SERVICES' && r.passType === 'WP');
    expect(wp.status).toBe('EXCEEDED');
    expect(wp.currentRatioPct).toBeGreaterThan(15);
  });

  test('results sorted EXCEEDED → WARNING → OK', () => {
    const quotas = [
      { sector: 'SERVICES',     passType: 'WP', maxRatioPct: 15.0, alertThreshPct: 80.0 },
      { sector: 'CONSTRUCTION', passType: 'WP', maxRatioPct: 83.0, alertThreshPct: 80.0 },
    ];
    const groups = new Map([
      ['LOCAL',        { localCount: 50, wp: 0, sPass: 0 }],
      ['SERVICES',     { wp: 20, sPass: 0, localCount: 0 }], // 20/70 = 28.6% → EXCEEDED
      ['CONSTRUCTION', { wp: 5,  sPass: 0, localCount: 0 }], // 5/55  = 9.1% → OK
    ]);
    const results = computeDrcStatus(groups, quotas);
    expect(results[0].status).toBe('EXCEEDED');
    expect(results[results.length - 1].status).toBe('OK');
  });

  test('remainingHeadroom computed correctly', () => {
    // 15% ceiling, 100 total, 5 WP → room = (15% × 100) - 5 = 10
    const groups = new Map([
      ['LOCAL',    { localCount: 95, wp: 0, sPass: 0 }],
      ['SERVICES', { wp: 5, sPass: 0, localCount: 0 }],
    ]);
    const results = computeDrcStatus(groups, serviceQuotas);
    const wp = results.find(r => r.sector === 'SERVICES' && r.passType === 'WP');
    expect(wp.remainingHeadroom).toBeGreaterThan(0);
  });

  test('remainingHeadroom is 0 when EXCEEDED', () => {
    const groups = new Map([
      ['LOCAL',    { localCount: 80, wp: 0, sPass: 0 }],
      ['SERVICES', { wp: 20, sPass: 0, localCount: 0 }],
    ]);
    const results = computeDrcStatus(groups, serviceQuotas);
    const wp = results.find(r => r.sector === 'SERVICES' && r.passType === 'WP');
    expect(wp.remainingHeadroom).toBe(0);
  });

  test('no FW employees → all OK with fwCount=0', () => {
    const groups = new Map([
      ['LOCAL', { localCount: 100, wp: 0, sPass: 0 }],
    ]);
    const results = computeDrcStatus(groups, serviceQuotas);
    results.forEach(r => {
      expect(r.status).toBe('OK');
      expect(r.fwCount).toBe(0);
    });
  });

  test('falls back to MOM_DEFAULTS when quotas array is empty', () => {
    const groups = new Map([
      ['LOCAL',    { localCount: 80, wp: 0, sPass: 0 }],
      ['SERVICES', { wp: 20, sPass: 0, localCount: 0 }],
    ]);
    const results = computeDrcStatus(groups, []); // no DB quotas — uses MOM_DEFAULTS
    const wp = results.find(r => r.sector === 'SERVICES' && r.passType === 'WP');
    expect(wp).toBeTruthy();
    expect(wp.maxRatioPct).toBe(15.0); // MOM default for SERVICES WP
    expect(wp.status).toBe('EXCEEDED');
  });

  test('currentRatioPct has max 2 decimal places', () => {
    const groups = new Map([
      ['LOCAL',    { localCount: 97, wp: 0, sPass: 0 }],
      ['SERVICES', { wp: 1, sPass: 0, localCount: 0 }],
    ]);
    const results = computeDrcStatus(groups, serviceQuotas);
    const wp = results.find(r => r.sector === 'SERVICES' && r.passType === 'WP');
    expect(wp.currentRatioPct.toString().split('.')[1]?.length ?? 0).toBeLessThanOrEqual(2);
  });
});

// ── MOM_DEFAULTS ──────────────────────────────────────────────────────────────

describe('MOM_DEFAULTS', () => {
  test('all 5 sectors are covered', () => {
    const sectors = [...new Set(MOM_DEFAULTS.map(d => d.sector))];
    expect(sectors.sort()).toEqual(['CONSTRUCTION', 'MANUFACTURING', 'MARINE', 'PROCESS', 'SERVICES']);
  });

  test('each sector has WP and S_PASS entries', () => {
    const sectors = ['SERVICES', 'CONSTRUCTION', 'MARINE', 'PROCESS', 'MANUFACTURING'];
    for (const s of sectors) {
      expect(MOM_DEFAULTS.find(d => d.sector === s && d.passType === 'WP')).toBeTruthy();
      expect(MOM_DEFAULTS.find(d => d.sector === s && d.passType === 'S_PASS')).toBeTruthy();
    }
  });

  test('SERVICES WP ceiling is 15%', () => {
    const d = MOM_DEFAULTS.find(d => d.sector === 'SERVICES' && d.passType === 'WP');
    expect(d.maxRatioPct).toBe(15.0);
  });

  test('CONSTRUCTION WP ceiling is 83%', () => {
    const d = MOM_DEFAULTS.find(d => d.sector === 'CONSTRUCTION' && d.passType === 'WP');
    expect(d.maxRatioPct).toBe(83.0);
  });
});
