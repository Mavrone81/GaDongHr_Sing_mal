#!/usr/bin/env node
'use strict';

/**
 * GaDongHR Seed Script — uses raw pg (PostgreSQL) queries
 * Run from repo root: node scripts/seed.js
 * Requires: docker-compose up  (postgres must be running on localhost:5432)
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { Client } = require('pg');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const HOST   = process.env.POSTGRES_HOST === 'postgres' ? 'localhost' : (process.env.POSTGRES_HOST || 'localhost');
const PORT   = parseInt(process.env.POSTGRES_PORT) || 5432;
const USER   = process.env.POSTGRES_USER || 'hrms';
const PASS   = process.env.POSTGRES_PASSWORD || 'hrms_secret_2025';

function client(database) {
  return new Client({ host: HOST, port: PORT, user: USER, password: PASS, database });
}

// ─── Auth: Users ──────────────────────────────────────────────────
async function seedAuth() {
  const db = client('hrms_auth');
  await db.connect();
  try {
    // Bootstrap passwords MUST come from env, in every environment.
    //
    // There is deliberately no fallback literal, not even a dev one. The old
    // NODE_ENV-gated fallback is exactly the shape VAPT C-05/C-06 flagged: a
    // known credential one mis-set env var away from reaching a real system.
    // A literal here is also a password sitting in git forever.
    const defaultUserPass = process.env.SEED_USER_PASSWORD;
    const defaultAdminPass = process.env.SEED_ADMIN_PASSWORD;
    if (!defaultUserPass || !defaultAdminPass) {
      throw new Error(
        'SEED_USER_PASSWORD and SEED_ADMIN_PASSWORD env vars are required.\n' +
        'Set them before seeding, e.g.:\n' +
        '  SEED_USER_PASSWORD=... SEED_ADMIN_PASSWORD=... node scripts/seed.js',
      );
    }
    const hash = await bcrypt.hash(defaultUserPass, 12);
    const adminHash = await bcrypt.hash(defaultAdminPass, 12);

    const usersToSeed = [
      { email: 'admin@gadonghr.sg', hash: adminHash, name: 'System Admin', role: 'SUPER_ADMIN' },
      { email: 'hr@gadonghr.sg', hash: hash, name: 'HR Admin', role: 'HR_ADMIN' },
      { email: 'payroll@gadonghr.sg', hash: hash, name: 'Payroll Officer', role: 'PAYROLL_OFFICER' },
      { email: 'manager@gadonghr.sg', hash: hash, name: 'Line Manager', role: 'MANAGER' },
      { email: 'employee@gadonghr.sg', hash: hash, name: 'Standard Employee', role: 'EMPLOYEE' }
    ];

    let count = 0;
    for (const u of usersToSeed) {
      const exists = await db.query(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [u.email]);
      if (exists.rows.length === 0) {
        await db.query(
          `INSERT INTO users (id, email, "passwordHash", name, role, "isActive", "mfaEnabled", "failedLogins", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, true, false, 0, NOW(), NOW())`,
          [uuidv4(), u.email, u.hash, u.name, u.role]
        );
        count++;
      }
    }
    
    if (count > 0) {
      console.log(`✅ Seeded ${count} authentication accounts successfully!`);
    } else {
      console.log(`ℹ️  Authentication accounts already exist — skipping`);
    }
  } finally { await db.end(); }
}

// ─── Payroll: CPF rates, SDL, FWL, pay components, public holidays ───────────
async function seedPayroll() {
  const db = client('hrms_payroll');
  await db.connect();
  try {
    // CPF Rates — per CPF Board "CPF Contribution Rate Table from 1 January 2026"
    // (official PDF: CPFcontributionratesfrom1Jan2026.pdf, Tables 1-3)
    // OW ceiling raised from $6,800 to $8,000 (final step of Budget 2023 4-year ramp).
    // Senior worker rates enhanced for 55-60 and 60-65 brackets.
    const cpfCount = await db.query(`SELECT COUNT(*) FROM cpf_rates`);
    if (cpfCount.rows[0].count === '0') {
      const rates = [
        // SC and PR Year 3+ — Table 1
        ['SC_PR',    0,  55,   0.20,  0.17 ],   // ≤55:    20% / 17%      (Total 37%)
        ['SC_PR',   55,  60,   0.18,  0.16 ],   // 55-60:  18% / 16%      (Total 34%, Jan 2026 enhanced)
        ['SC_PR',   60,  65,   0.125, 0.125],   // 60-65:  12.5% / 12.5%  (Total 25%, Jan 2026 enhanced, even split)
        ['SC_PR',   65,  70,   0.075, 0.09 ],   // 65-70:  7.5% / 9%      (Total 16.5%, unchanged)
        ['SC_PR',   70,  null, 0.05,  0.075],   // 70+:    5% / 7.5%      (Total 12.5%, floor)
        // PR Year 1 graduated (G/G) — Table 2
        ['PR_YEAR1', 0,  60,   0.05,  0.04 ],   // ≤60:    5% / 4%
        ['PR_YEAR1', 60, null, 0.05,  0.035],   // 60+:    5% / 3.5%      (employer rate drops)
        // PR Year 2 graduated (G/G) — Table 3
        ['PR_YEAR2', 0,  55,   0.15,  0.09 ],   // ≤55:    15% / 9%
        ['PR_YEAR2', 55, 60,   0.125, 0.06 ],   // 55-60:  12.5% / 6%
        ['PR_YEAR2', 60, 65,   0.075, 0.035],   // 60-65:  7.5% / 3.5%
        ['PR_YEAR2', 65, null, 0.05,  0.035],   // 65+:    5% / 3.5%
        // Foreigner — exempt per CPF Act s.7
        ['FOREIGNER', 0, null, 0.0,   0.0  ],
      ];
      for (const [cs, amin, amax, er, emr] of rates) {
        await db.query(
          `INSERT INTO cpf_rates (id, "citizenStatus", "ageMin", "ageMax", "employeeRate", "employerRate", "owCeiling", "awCeiling", "effectiveDate", "isActive", "createdAt")
           VALUES ($1,$2,$3,$4,$5,$6,8000,102000,'2026-01-01',true,NOW())`,
          [uuidv4(), cs, amin, amax, er, emr]
        );
      }
      console.log('✅ CPF rates seeded (Jan 2026)');
    } else { console.log('ℹ️  CPF rates already exist'); }

    // SDL config
    const sdlCount = await db.query(`SELECT COUNT(*) FROM sdl_config`);
    if (sdlCount.rows[0].count === '0') {
      await db.query(
        `INSERT INTO sdl_config (id, rate, "minAmount", "maxAmount", "salaryCap", "effectiveDate", "isActive", "createdAt")
         VALUES ($1, 0.0025, 2.00, 11.25, 4500, '2025-01-01', true, NOW())`,
        [uuidv4()]
      );
      console.log('✅ SDL config seeded');
    }

    // FWL rates
    const fwlCount = await db.query(`SELECT COUNT(*) FROM fwl_rates`);
    if (fwlCount.rows[0].count === '0') {
      const fwlRates = [
        ['WP',     'SERVICES',     'BASIC_SKILLED',  15.00],
        ['WP',     'SERVICES',     'HIGHER_SKILLED',  7.00],
        ['S_PASS', 'SERVICES',     'TIER1',           13.00],
        ['WP',     'CONSTRUCTION', 'BASIC_SKILLED',  15.00],
        ['WP',     'MANUFACTURING','BASIC_SKILLED',  15.00],
      ];
      for (const [pt, sec, tier, rate] of fwlRates) {
        await db.query(
          `INSERT INTO fwl_rates (id, "passType", sector, tier, "dailyRate", "effectiveDate", "isActive", "createdAt")
           VALUES ($1,$2,$3,$4,$5,'2025-01-01',true,NOW())`,
          [uuidv4(), pt, sec, tier, rate]
        );
      }
      console.log('✅ FWL rates seeded');
    }

    // Pay Components (all 59 from PRD)
    const compCount = await db.query(`SELECT COUNT(*) FROM pay_components`);
    if (compCount.rows[0].count === '0') {
      const components = [
        ['BASIC',          'Basic Salary',                     'ORDINARY_WAGES',   true, true, 'OW',  1],
        ['DAILY_WAGE',     'Daily-Rated Wage',                 'ORDINARY_WAGES',   true, true, 'OW',  2],
        ['HOURLY_WAGE',    'Hourly-Rated Wage',                'ORDINARY_WAGES',   true, true, 'OW',  3],
        ['PIECE_RATE',     'Piece-Rate / Output-Based',        'ORDINARY_WAGES',   true, true, 'OW',  4],
        ['FIXED_ALLOW',    'Fixed Monthly Allowance',          'ALLOWANCE',        true, true, 'OW',  5],
        ['TRANSPORT_ALLOW','Transport Allowance (Fixed)',       'ALLOWANCE',        true, true, 'OW',  6],
        ['MEAL_ALLOW',     'Meal Allowance',                   'ALLOWANCE',        true, true, 'OW',  7],
        ['HOUSING_ALLOW',  'Housing Allowance',                'ALLOWANCE',        true, true, 'OW',  8],
        ['MOBILE_ALLOW',   'Mobile / Handphone Allowance',     'ALLOWANCE',        true, true, 'OW',  9],
        ['CLOTHING_ALLOW', 'Clothing / Uniform Allowance',     'ALLOWANCE',       false,false, 'OW', 10],
        ['NIGHT_SHIFT',    'Night Shift Allowance',            'ALLOWANCE',        true, true, 'OW', 11],
        ['SHIFT_DIFF',     'Shift Differential Pay',           'ALLOWANCE',        true, true, 'OW', 12],
        ['OFFSHORE_ALLOW', 'Offshore / Sea Allowance',         'ALLOWANCE',       false,false, 'OW', 13],
        ['SITE_ALLOW',     'Site / Field Allowance',           'ALLOWANCE',        true, true, 'OW', 14],
        ['OT_PAY',         'Overtime Pay (EA Part IV)',         'OT',               true, true, 'OW', 15],
        ['REST_DAY_EMP',   'Rest Day Pay (Employee Request)',   'OT',               true, true, 'OW', 16],
        ['REST_DAY_ER',    'Rest Day Pay (Employer Request)',   'OT',               true, true, 'OW', 17],
        ['PH_WORK',        'Public Holiday Work Pay',           'OT',               true, true, 'OW', 18],
        ['OIL',            'Off-In-Lieu (OIL) Cash-out',        'OT',               true, true, 'OW', 19],
        ['AWS',            'Annual Wage Supplement (AWS)',      'ADDITIONAL_WAGES', true, true, 'AW', 20],
        ['PERF_BONUS',     'Performance Bonus',                'ADDITIONAL_WAGES', true, true, 'AW', 21],
        ['COMMISSION',     'Commission',                        'ADDITIONAL_WAGES', true, true, 'AW', 22],
        ['PROFIT_SHARE',   'Profit-Sharing Bonus',             'ADDITIONAL_WAGES', true, true, 'AW', 23],
        ['RETENTION_BONUS','Retention Bonus',                  'ADDITIONAL_WAGES', true, true, 'AW', 24],
        ['CONTRACT_BONUS', 'Contractual Bonus',                'ADDITIONAL_WAGES', true, true, 'AW', 25],
        ['SIGN_ON',        'Sign-On Bonus',                    'ADDITIONAL_WAGES', true, true, 'AW', 26],
        ['DISC_BONUS',     'Discretionary Bonus',              'ADDITIONAL_WAGES', true, true, 'AW', 27],
        ['LSA_CASH',       'Long Service Award (Cash)',         'ADDITIONAL_WAGES', true,false, 'AW', 28],
        ['EMP_CPF',        'Employee CPF Contribution',         'DEDUCTION',       false,false,  'DEDUCTION', 29],
        ['NPL_DED',        'No-Pay Leave (NPL) Deduction',      'DEDUCTION',       false,false,  'DEDUCTION', 30],
        ['ABSENCE_DED',    'Absence / AWOL Deduction',          'DEDUCTION',       false,false,  'DEDUCTION', 31],
        ['SAL_ADV_RECOV',  'Salary Advance Recovery',           'DEDUCTION',       false,false,  'DEDUCTION', 32],
        ['STAFF_LOAN',     'Staff Loan Repayment',              'DEDUCTION',       false,false,  'DEDUCTION', 33],
        ['OVERPAY_RECOV',  'Overpayment Recovery',              'DEDUCTION',       false,false,  'DEDUCTION', 34],
        ['GARNISHMENT',    'Court Order / Garnishment',         'DEDUCTION',       false,false,  'DEDUCTION', 35],
        ['MED_REIMB',      'Medical Reimbursement',             'REIMBURSEMENT',   false,false,  'REIMBURSEMENT', 36],
        ['TRANSPORT_CLAIM','Transport Claim (Actual)',           'REIMBURSEMENT',   false,false,  'REIMBURSEMENT', 37],
        ['ENTERTAIN_REIMB','Entertainment Reimbursement',       'REIMBURSEMENT',   false,false,  'REIMBURSEMENT', 38],
        ['TRAINING_REIMB', 'Training / Course Reimbursement',   'REIMBURSEMENT',   false,false,  'REIMBURSEMENT', 39],
        ['HANDPHONE_REIMB','Handphone Bill Reimbursement',      'REIMBURSEMENT',   false,false,  'REIMBURSEMENT', 40],
        ['MILEAGE_REIMB',  'Mileage Reimbursement',             'REIMBURSEMENT',   false,false,  'REIMBURSEMENT', 41],
        ['GPML',           'Government-Paid Maternity Leave',   'GOVT_PAID',        true,false, 'OW', 42],
        ['GPPL',           'Government-Paid Paternity Leave',   'GOVT_PAID',        true,false, 'OW', 43],
        ['GPCL',           'Government-Paid Childcare Leave',   'GOVT_PAID',        true,false, 'OW', 44],
        ['GPSL',           'Government-Paid Shared Parental Leave','GOVT_PAID',     true,false, 'OW', 45],
        ['CAR_BIK',        'Company Car (BIK)',                 'BIK',             false, true, 'OW', 46],
        ['HOUSING_BIK',    'Housing Benefit (BIK)',             'BIK',             false, true, 'OW', 47],
        ['CLUB_MEMB',      'Club Membership (BIK)',             'BIK',             false, true, 'OW', 48],
        ['GRP_INS',        'Group Insurance Premium (BIK)',     'BIK',             false, true, 'OW', 49],
        ['ESOP_GAIN',      'Stock Option Gain (ESOP)',          'ADDITIONAL_WAGES',false, true, 'AW', 50],
        ['SDL',            'Skills Development Levy (SDL)',     'STATUTORY',       false,false,  'DEDUCTION', 51],
        ['FWL',            'Foreign Worker Levy (FWL)',         'STATUTORY',       false,false,  'DEDUCTION', 52],
        ['EMPL_CPF',       'Employer CPF Contribution',         'STATUTORY',       false,false,  'DEDUCTION', 53],
        ['DIRECTOR_FEE',   'Director Fees',                     'ADDITIONAL_WAGES',false, true, 'AW', 54],
        ['GRATUITY',       'Gratuity Payment',                  'ADDITIONAL_WAGES', true, true, 'AW', 55],
        ['NOTICE_PAY',     'Pay in Lieu of Notice',             'ADDITIONAL_WAGES', true, true, 'AW', 56],
        ['LEAVE_ENCASH',   'Leave Encashment',                  'ADDITIONAL_WAGES', true, true, 'OW', 57],
        ['NS_PAY',         'NSman Make-Up Pay',                 'GOVT_PAID',        true,false, 'OW', 58],
        ['COMPASSIONATE',  'Compassionate Payment',             'ADDITIONAL_WAGES',false, true, 'AW', 59],
      ];
      for (const [code, name, cat, cpf, iras, wt, sort] of components) {
        await db.query(
          `INSERT INTO pay_components (id, code, name, category, "isCpfApplicable", "isIrasTaxable", "wageType", "isActive", "sortOrder", "createdAt", "updatedAt")
           VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,NOW(),NOW())`,
          [uuidv4(), code, name, cat, cpf, iras, wt, sort]
        );
      }
      console.log(`✅ 59 pay components seeded`);
    } else { console.log('ℹ️  Pay components already exist'); }

    // Singapore Public Holidays 2025
    const phCount = await db.query(`SELECT COUNT(*) FROM public_holidays`);
    if (phCount.rows[0].count === '0') {
      const phs = [
        ['2025-01-01', "New Year's Day"],
        ['2025-01-29', 'Chinese New Year'],
        ['2025-01-30', 'Chinese New Year (Day 2)'],
        ['2025-03-31', 'Hari Raya Puasa'],
        ['2025-04-18', 'Good Friday'],
        ['2025-05-01', 'Labour Day'],
        ['2025-06-06', 'Hari Raya Haji'],
        ['2025-08-09', 'National Day'],
        ['2025-10-20', 'Deepavali'],
        ['2025-12-25', 'Christmas Day'],
      ];
      for (const [date, name] of phs) {
        await db.query(
          `INSERT INTO public_holidays (id, date, name, year) VALUES ($1,$2,$3,2025)
           ON CONFLICT (date) DO NOTHING`,
          [uuidv4(), date, name]
        );
      }
      console.log('✅ Singapore Public Holidays 2025 seeded (payroll)');
    }
  } finally { await db.end(); }
}

// ─── Leave: 22 leave types + public holidays ─────────────────────────────────
async function seedLeave() {
  const db = client('hrms_leave');
  await db.connect();
  try {
    const count = await db.query(`SELECT COUNT(*) FROM leave_types`);
    if (count.rows[0].count !== '0') { console.log('ℹ️  Leave types already exist'); } else {
      const leaveTypes = [
        ['AL',   'Annual Leave',                     true, true,  14, 5,  false, false],
        ['SL',   'Sick Leave (Outpatient)',           true, true,  14, 0,  false, true],
        ['HL',   'Hospitalisation Leave',             true, true,  60, 0,  false, true],
        ['ML',   'Maternity Leave',                   true, true, 112, 0,  true,  true],
        ['PL',   'Paternity Leave',                   true, true,  14, 0,  true,  false],
        ['CL',   'Childcare Leave',                   true, true,   6, 0,  true,  false],
        ['ECL',  'Extended Childcare Leave',          true, true,   2, 0,  false, false],
        ['SPL',  'Shared Parental Leave',             true, true,  28, 0,  true,  false],
        ['ADPL', 'Adoption Leave',                    true, true,  12, 0,  true,  true],
        ['NSL',  'NSman Leave',                       true, true,   0, 0,  false, true],
        ['COMP', 'Compassionate Leave',              false, true,   3, 0,  false, false],
        ['MARR', 'Marriage Leave',                   false, true,   3, 0,  false, false],
        ['EXAM', 'Examination Leave',                false, true,   5, 0,  false, true],
        ['NPL',  'No-Pay Leave',                      true,false,   0, 0,  false, false],
        ['OIL',  'Off-In-Lieu',                      false, true,   0, 0,  false, false],
        ['PHI',  'Public Holiday In-Lieu',            true, true,   0, 0,  false, false],
        ['VWO',  'VWO Leave',                        false,false,   0, 0,  false, false],
        ['STUDY','Study Leave',                      false,false,   5, 0,  false, false],
        ['LSL',  'Long Service Leave',               false, true,   5, 0,  false, false],
        ['QUAR', 'Quarantine Leave',                  true, true,   0, 0,  false, true],
        ['JURY', 'Jury Duty Leave',                   true, true,   0, 0,  false, true],
        ['OTHER','Other Leave',                      false,false,   0, 0,  false, false],
      ];
      for (const [code, name, stat, paid, ent, cf, govt, doc] of leaveTypes) {
        await db.query(
          `INSERT INTO leave_types (id, code, name, "isStatutory", "isPaid", "annualEntitlement", "maxCarryForward", "isGovtPaid", "requiresDocument", "isActive", "createdAt")
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,NOW())`,
          [uuidv4(), code, name, stat, paid, ent, cf, govt, doc]
        );
      }
      console.log('✅ 22 leave types seeded');
    }

    const phCount = await db.query(`SELECT COUNT(*) FROM public_holidays`);
    if (phCount.rows[0].count === '0') {
      const phs = [
        ['2025-01-01', "New Year's Day"],
        ['2025-01-29', 'Chinese New Year'],
        ['2025-01-30', 'Chinese New Year (Day 2)'],
        ['2025-03-31', 'Hari Raya Puasa'],
        ['2025-04-18', 'Good Friday'],
        ['2025-05-01', 'Labour Day'],
        ['2025-06-06', 'Hari Raya Haji'],
        ['2025-08-09', 'National Day'],
        ['2025-10-20', 'Deepavali'],
        ['2025-12-25', 'Christmas Day'],
      ];
      for (const [date, name] of phs) {
        await db.query(
          `INSERT INTO public_holidays (id, date, name, year) VALUES ($1,$2,$3,2025)
           ON CONFLICT (date) DO NOTHING`,
          [uuidv4(), date, name]
        );
      }
      console.log('✅ Singapore Public Holidays 2025 seeded (leave)');
    }
  } finally { await db.end(); }
}

// ─── Claims: categories ───────────────────────────────────────────────────────
async function seedClaims() {
  const db = client('hrms_claims');
  await db.connect();
  try {
    const count = await db.query(`SELECT COUNT(*) FROM claim_categories`);
    if (count.rows[0].count !== '0') { console.log('ℹ️  Claim categories already exist'); return; }
    const cats = [
      ['MEDICAL',     'Medical / Dental',           true, false, 500],
      ['TRANSPORT',   'Transport (Business)',        true, false, null],
      ['ENTERTAINMENT','Business Entertainment',    true, true,  1000],
      ['TRAINING',    'Training / Course Fees',     true, true,  null],
      ['TELECOM',     'Telecommunication (Business)',true, true,  null],
      ['MEAL',        'Meal (Business)',             true, false, 200],
      ['OTHER',       'Other Business Expense',     true, false, null],
    ];
    for (const [code, name, rcpt, gst, max] of cats) {
      await db.query(
        `INSERT INTO claim_categories (id, code, name, "requiresReceipt", "isGstClaimable", "maxAmount", "requiresApproval", "isActive")
         VALUES ($1,$2,$3,$4,$5,$6,true,true)`,
        [uuidv4(), code, name, rcpt, gst, max]
      );
    }
    console.log('✅ 7 claim categories seeded');
  } finally { await db.end(); }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n🌱 GaDongHR Seed Script');
  console.log(`   Connecting to postgres at ${HOST}:${PORT}\n`);
  // Each phase is independent: a failure in one (e.g. seedAuth, whose users
  // INSERT predates the move to a relational roleId) must not abort the
  // reference-data seeds (payroll/leave/claims) that the e2e suite depends on.
  // SEED_SKIP_AUTH=1 skips the auth accounts entirely — in CI those come from
  // e2e/scripts/seed-test-users.js, so seed.js only needs to plant reference data.
  const phases = [
    ['auth',    seedAuth,    process.env.SEED_SKIP_AUTH === '1'],
    ['payroll', seedPayroll, false],
    ['leave',   seedLeave,   false],
    ['claims',  seedClaims,  false],
  ];
  let failed = 0;
  for (const [name, fn, skip] of phases) {
    if (skip) { console.log(`⏭️  Skipping ${name} seed (SEED_SKIP_AUTH)`); continue; }
    try { await fn(); }
    catch (err) { failed++; console.error(`⚠️  ${name} seed failed: ${err.message}`); }
  }
  console.log(`\n${failed ? '⚠️' : '✅'} Seed complete (${phases.length - failed} ok, ${failed} failed).\n`);
}

main().catch(err => {
  console.error('\n❌ Seed driver crashed:', err.message);
  console.error('   Make sure docker-compose is running (docker-compose up -d)');
  process.exit(1);
});
