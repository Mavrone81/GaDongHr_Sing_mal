'use strict';

/**
 * Singapore employment terms — Employment Act (Cap. 91).
 *
 * Exposed over the contract so leave-service and attendance-service never hold
 * country constants of their own. `leaveEntitlements` is a tiered list keyed by
 * minimum completed service months: Singapore happens to be flat (one tier),
 * Malaysia is genuinely tiered (8/12/16 annual, 14/18/22 sick). Same SHAPE
 * either way, so consumers need no country branch — which is the point.
 *
 * These are STATUTORY MINIMA. A tenant's configured LeaveType may exceed them
 * but must never fall below; validation compares against these on save.
 */
const SG_EMPLOYMENT_RULES = {
  country: 'SG',
  normalWeeklyHours: 44,
  // EA s.38 has a single overtime rate. MY s.60A differentiates 1.5 / 2 / 3 by
  // day type — expressing SG as three identical values keeps the consumer
  // country-agnostic.
  overtimeMultipliers: { NORMAL: 1.5, REST_DAY: 1.5, PUBLIC_HOLIDAY: 1.5 },
  leaveEntitlements: {
    ANNUAL:          [{ minServiceMonths: 0, days: 7 }],   // EA statutory minimum
    SICK_OUTPATIENT: [{ minServiceMonths: 0, days: 14 }],
    HOSPITALISATION: [{ minServiceMonths: 0, days: 60 }],
    MATERNITY:       [{ minServiceMonths: 0, days: 112 }], // 16 weeks
    PATERNITY:       [{ minServiceMonths: 0, days: 14 }],  // 2 weeks
  },
  noticePeriods: [
    { minServiceMonths: 0,  days: 1 },
    { minServiceMonths: 6,  days: 7 },
    { minServiceMonths: 24, days: 14 },
    { minServiceMonths: 60, days: 28 },
  ],
};

/**
 * What this country needs on an employee and an entity before payroll can
 * compute. payroll-service validates against this BEFORE starting a run, so
 * missing data surfaces as a list of employees to fix rather than a half-written
 * payroll (spec §3.4).
 */
const SG_SCHEMA = {
  country: 'SG',
  identityTypes: ['NRIC', 'FIN'],
  employeeFields: [
    { name: 'citizenStatus', type: 'enum', required: true,
      values: ['SC', 'PR', 'PR_YEAR1', 'PR_YEAR2', 'FOREIGNER'] },
    { name: 'dateOfBirth',      type: 'date',    required: true },
    { name: 'cpfPrYear',        type: 'int',     required: false },
    { name: 'cpfVoluntaryRate', type: 'boolean', required: false },
    { name: 'passType',         type: 'enum',    required: false, values: ['WP', 'S_PASS', 'EP'] },
    { name: 'workPassSector',   type: 'string',  required: false },
  ],
  entityFields: [
    { name: 'cpfSubmissionNumber', type: 'string', required: true },
  ],
};

module.exports = { SG_EMPLOYMENT_RULES, SG_SCHEMA };
