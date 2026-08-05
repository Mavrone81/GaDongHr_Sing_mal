'use strict';

/**
 * Malaysian employment rules and the data Malaysian payroll requires.
 *
 * Mirrors the shape statutory-sg-service serves from /employment-rules and
 * /schema, so payroll consumes one contract regardless of country (PRD ENT-002).
 *
 * SOURCE DISCIPLINE. Statutory FIGURES live in the database under a versioned,
 * provenance-checked RateVersion — never in this file. What lives here is
 * structure: which fields payroll must have before it can compute, and the
 * shape of the employment rules. The two entitlement tiers below are set by the
 * Employment Act 1955 itself rather than by an annually-published table, so they
 * are stated here with their section; anything that moves with a published
 * schedule (EPF, SOCSO, EIS, PCB, HRD Corp) does not appear.
 */

const MY_EMPLOYMENT_RULES = {
  country: 'MY',
  currency: 'MYR',
  statute: 'Employment Act 1955 (as amended by Act A1651, in force 1 Jan 2023)',

  normalHours: {
    // Reduced from 48 by the 2022 amendment — a detail worth pinning, because
    // overtime is calculated on the excess and the old figure silently
    // under-pays.
    perWeek: 45,
    reference: 'EA s.60A',
  },

  overtime: {
    normalDay: 1.5,
    restDay: 2.0,
    publicHoliday: 3.0,
    reference: 'EA s.60A(3), s.60(3), s.60D(3)',
  },

  annualLeave: {
    // Tiers are by completed years of service.
    tiers: [
      { minYears: 0, maxYears: 2, days: 8 },
      { minYears: 2, maxYears: 5, days: 12 },
      { minYears: 5, maxYears: null, days: 16 },
    ],
    reference: 'EA s.60E',
  },

  sickLeave: {
    // Without hospitalisation, by completed years of service.
    tiers: [
      { minYears: 0, maxYears: 2, days: 14 },
      { minYears: 2, maxYears: 5, days: 18 },
      { minYears: 5, maxYears: null, days: 22 },
    ],
    // Hospitalisation is a separate, larger aggregate entitlement.
    hospitalisationDays: 60,
    reference: 'EA s.60F',
  },

  maternityLeave: { days: 98, reference: 'EA s.37 (as amended)' },
  paternityLeave: { days: 7, reference: 'EA s.60FA' },

  notice: {
    // By length of service, and — as in Singapore — the same either way.
    tiers: [
      { minYears: 0, maxYears: 2, weeks: 4 },
      { minYears: 2, maxYears: 5, weeks: 6 },
      { minYears: 5, maxYears: null, weeks: 8 },
    ],
    reference: 'EA s.12',
  },
};

/**
 * What Malaysian payroll needs before it can compute.
 *
 * `required: true` fields are checked by /validate BEFORE a run computes, so
 * missing data surfaces as a list of employees to fix rather than a half-written
 * payroll run (PRD §3.4).
 */
const MY_SCHEMA = {
  country: 'MY',
  currency: 'MYR',
  employeeFields: [
    { name: 'age', type: 'integer', required: true,
      why: 'EPF, SOCSO and EIS all change at 60' },
    { name: 'citizenship', type: 'enum', values: ['CITIZEN', 'PR', 'FOREIGNER'], required: true,
      why: 'SOCSO category and EIS eligibility both turn on it' },
    { name: 'epfNumber', type: 'string', required: true },
    { name: 'socsoNumber', type: 'string', required: true },
    { name: 'incomeTaxNumber', type: 'string', required: true,
      why: 'PCB cannot be filed without it' },
    { name: 'mtdCategory', type: 'enum', values: [1, 2, 3], required: true,
      why: '1 single, 2 married with spouse not working, 3 married with spouse working' },
    { name: 'qualifyingChildren', type: 'integer', required: false, default: 0 },
    { name: 'zakatEnrolled', type: 'boolean', required: false, default: false },
    { name: 'epfVoluntaryEmployeeRate', type: 'float', required: false,
      why: 'Employee may elect above the statutory rate' },
  ],
  entityFields: [
    { name: 'epfEmployerNumber', type: 'string', required: true },
    { name: 'socsoEmployerNumber', type: 'string', required: true },
    { name: 'lhdnEmployerNumber', type: 'string', required: true },
    { name: 'hrdCorpRegistered', type: 'boolean', required: true,
      why: 'The levy applies only to registered employers (PSMB Act)' },
    { name: 'epfEmployerRateOverride', type: 'float', required: false,
      why: 'An employer may contribute above the statutory minimum' },
  ],
};

module.exports = { MY_EMPLOYMENT_RULES, MY_SCHEMA };
