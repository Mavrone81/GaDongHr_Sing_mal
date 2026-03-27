#!/usr/bin/env node
'use strict';

/**
 * EzyHRM Seed Script
 * Populates: 
 *  - Super Admin user (auth-service)
 *  - CPF rate table (payroll-service)
 *  - 59 pay components (payroll-service)
 *  - SDL config (payroll-service)
 *  - 22 leave types (leave-service)
 *  - Claim categories (claims-service)
 *  - Singapore public holidays 2025 (leave-service)
 */

const { execSync } = require('child_process');
const path = require('path');
const bcrypt = require('bcryptjs');

// We'll directly use Prisma clients for each service
process.chdir(path.join(__dirname, '../services/auth-service'));
const { PrismaClient: AuthPrisma } = require('@prisma/client');

process.chdir(path.join(__dirname, '../services/payroll-service'));
const { PrismaClient: PayrollPrisma } = require('@prisma/client');

process.chdir(path.join(__dirname, '../services/leave-service'));
const { PrismaClient: LeavePrisma } = require('@prisma/client');

process.chdir(path.join(__dirname, '../services/claims-service'));
const { PrismaClient: ClaimsPrisma } = require('@prisma/client');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { v4: uuidv4 } = require('uuid');

async function seedAuth() {
  const authPrisma = new AuthPrisma({ datasources: { db: { url: `postgresql://${process.env.POSTGRES_USER}:${process.env.POSTGRES_PASSWORD}@${process.env.POSTGRES_HOST || 'localhost'}:5432/hrms_auth` } } });
  try {
    const existing = await authPrisma.user.findUnique({ where: { email: 'admin@ezyhRM.sg' } });
    if (!existing) {
      const hash = await bcrypt.hash('***REMOVED***', 12);
      await authPrisma.user.create({
        data: { id: uuidv4(), email: 'admin@ezyhRM.sg', passwordHash: hash, name: 'System Admin', role: 'SUPER_ADMIN' },
      });
      console.log('✅ Super Admin created: admin@ezyhRM.sg / ***REMOVED***');
    } else {
      console.log('ℹ️  Super Admin already exists');
    }
  } finally { await authPrisma.$disconnect(); }
}

async function seedPayroll() {
  const payrollPrisma = new PayrollPrisma({ datasources: { db: { url: `postgresql://${process.env.POSTGRES_USER}:${process.env.POSTGRES_PASSWORD}@${process.env.POSTGRES_HOST || 'localhost'}:5432/hrms_payroll` } } });
  try {
    // CPF Rates (Jan 2025 rates)
    const cpfRates = [
      { id: uuidv4(), citizenStatus: 'SC_PR', ageMin: 0,  ageMax: 55,  employeeRate: 0.20, employerRate: 0.17, effectiveDate: new Date('2025-01-01') },
      { id: uuidv4(), citizenStatus: 'SC_PR', ageMin: 55, ageMax: 60,  employeeRate: 0.16, employerRate: 0.15, effectiveDate: new Date('2025-01-01') },
      { id: uuidv4(), citizenStatus: 'SC_PR', ageMin: 60, ageMax: 65,  employeeRate: 0.105,employerRate: 0.115,effectiveDate: new Date('2025-01-01') },
      { id: uuidv4(), citizenStatus: 'SC_PR', ageMin: 65, ageMax: 70,  employeeRate: 0.075,employerRate: 0.09, effectiveDate: new Date('2025-01-01') },
      { id: uuidv4(), citizenStatus: 'SC_PR', ageMin: 70, ageMax: null,employeeRate: 0.05, employerRate: 0.075,effectiveDate: new Date('2025-01-01') },
      { id: uuidv4(), citizenStatus: 'PR_YEAR1', ageMin: 0, ageMax: null, employeeRate: 0.05, employerRate: 0.04, effectiveDate: new Date('2025-01-01') },
      { id: uuidv4(), citizenStatus: 'PR_YEAR2', ageMin: 0, ageMax: null, employeeRate: 0.15, employerRate: 0.09, effectiveDate: new Date('2025-01-01') },
      { id: uuidv4(), citizenStatus: 'FOREIGNER', ageMin: 0, ageMax: null, employeeRate: 0.0, employerRate: 0.0, effectiveDate: new Date('2025-01-01') },
    ];
    const existingRates = await payrollPrisma.cpfRate.count();
    if (existingRates === 0) {
      await payrollPrisma.cpfRate.createMany({ data: cpfRates });
      console.log('✅ CPF rates seeded (Jan 2025)');
    }

    // SDL Config
    const sdlCount = await payrollPrisma.sdlConfig.count();
    if (sdlCount === 0) {
      await payrollPrisma.sdlConfig.create({ data: { id: uuidv4(), rate: 0.0025, minAmount: 2.00, maxAmount: 11.25, salaryCap: 4500, effectiveDate: new Date('2025-01-01') } });
      console.log('✅ SDL config seeded');
    }

    // 59 Pay Components
    const components = [
      // A - Ordinary Wages
      { code: 'BASIC', name: 'Basic Salary', category: 'ORDINARY_WAGES', isCpfApplicable: true, isIrasTaxable: true, wageType: 'OW', sortOrder: 1 },
      { code: 'DAILY_WAGE', name: 'Daily-Rated Wage', category: 'ORDINARY_WAGES', isCpfApplicable: true, isIrasTaxable: true, wageType: 'OW', sortOrder: 2 },
      { code: 'HOURLY_WAGE', name: 'Hourly-Rated Wage', category: 'ORDINARY_WAGES', isCpfApplicable: true, isIrasTaxable: true, wageType: 'OW', sortOrder: 3 },
      { code: 'PIECE_RATE', name: 'Piece-Rate / Output-Based', category: 'ORDINARY_WAGES', isCpfApplicable: true, isIrasTaxable: true, wageType: 'OW', sortOrder: 4 },
      // B - Allowances
      { code: 'FIXED_ALLOW', name: 'Fixed Monthly Allowance', category: 'ALLOWANCE', isCpfApplicable: true, isIrasTaxable: true, wageType: 'OW', sortOrder: 5 },
      { code: 'TRANSPORT_ALLOW', name: 'Transport Allowance (Fixed)', category: 'ALLOWANCE', isCpfApplicable: true, isIrasTaxable: true, wageType: 'OW', sortOrder: 6 },
      { code: 'MEAL_ALLOW', name: 'Meal Allowance', category: 'ALLOWANCE', isCpfApplicable: true, isIrasTaxable: true, wageType: 'OW', sortOrder: 7 },
      { code: 'HOUSING_ALLOW', name: 'Housing Allowance', category: 'ALLOWANCE', isCpfApplicable: true, isIrasTaxable: true, wageType: 'OW', sortOrder: 8 },
      { code: 'MOBILE_ALLOW', name: 'Mobile / Handphone Allowance', category: 'ALLOWANCE', isCpfApplicable: true, isIrasTaxable: true, wageType: 'OW', sortOrder: 9 },
      { code: 'CLOTHING_ALLOW', name: 'Clothing / Uniform Allowance', category: 'ALLOWANCE', isCpfApplicable: false, isIrasTaxable: false, wageType: 'OW', sortOrder: 10 },
      { code: 'NIGHT_SHIFT_ALLOW', name: 'Night Shift Allowance', category: 'ALLOWANCE', isCpfApplicable: true, isIrasTaxable: true, wageType: 'OW', sortOrder: 11 },
      { code: 'SHIFT_DIFF', name: 'Shift Differential Pay', category: 'ALLOWANCE', isCpfApplicable: true, isIrasTaxable: true, wageType: 'OW', sortOrder: 12 },
      { code: 'OFFSHORE_ALLOW', name: 'Offshore / Sea Allowance', category: 'ALLOWANCE', isCpfApplicable: false, isIrasTaxable: false, wageType: 'OW', sortOrder: 13 },
      { code: 'SITE_ALLOW', name: 'Site / Field Allowance', category: 'ALLOWANCE', isCpfApplicable: true, isIrasTaxable: true, wageType: 'OW', sortOrder: 14 },
      // C - Overtime
      { code: 'OT_PAY', name: 'Overtime Pay (EA Part IV)', category: 'OT', isCpfApplicable: true, isIrasTaxable: true, wageType: 'OW', sortOrder: 15 },
      { code: 'REST_DAY_EMP', name: 'Rest Day Pay (Employee Request)', category: 'OT', isCpfApplicable: true, isIrasTaxable: true, wageType: 'OW', sortOrder: 16 },
      { code: 'REST_DAY_ER', name: 'Rest Day Pay (Employer Request)', category: 'OT', isCpfApplicable: true, isIrasTaxable: true, wageType: 'OW', sortOrder: 17 },
      { code: 'PH_WORK', name: 'Public Holiday Work Pay', category: 'OT', isCpfApplicable: true, isIrasTaxable: true, wageType: 'OW', sortOrder: 18 },
      { code: 'OIL', name: 'Off-In-Lieu (OIL)', category: 'OT', isCpfApplicable: false, isIrasTaxable: false, wageType: 'OW', sortOrder: 19 },
      // D - Additional Wages
      { code: 'AWS', name: 'Annual Wage Supplement (AWS)', category: 'ADDITIONAL_WAGES', isCpfApplicable: true, isIrasTaxable: true, wageType: 'AW', sortOrder: 20 },
      { code: 'PERF_BONUS', name: 'Performance Bonus', category: 'ADDITIONAL_WAGES', isCpfApplicable: true, isIrasTaxable: true, wageType: 'AW', sortOrder: 21 },
      { code: 'COMMISSION', name: 'Commission', category: 'ADDITIONAL_WAGES', isCpfApplicable: true, isIrasTaxable: true, wageType: 'AW', sortOrder: 22 },
      { code: 'PROFIT_SHARE', name: 'Profit-Sharing Bonus', category: 'ADDITIONAL_WAGES', isCpfApplicable: true, isIrasTaxable: true, wageType: 'AW', sortOrder: 23 },
      { code: 'RETENTION_BONUS', name: 'Retention Bonus', category: 'ADDITIONAL_WAGES', isCpfApplicable: true, isIrasTaxable: true, wageType: 'AW', sortOrder: 24 },
      { code: 'CONTRACT_BONUS', name: 'Contractual Bonus', category: 'ADDITIONAL_WAGES', isCpfApplicable: true, isIrasTaxable: true, wageType: 'AW', sortOrder: 25 },
      { code: 'SIGN_ON', name: 'Sign-On Bonus', category: 'ADDITIONAL_WAGES', isCpfApplicable: true, isIrasTaxable: true, wageType: 'AW', sortOrder: 26 },
      { code: 'DISC_BONUS', name: 'Discretionary Bonus', category: 'ADDITIONAL_WAGES', isCpfApplicable: true, isIrasTaxable: true, wageType: 'AW', sortOrder: 27 },
      { code: 'LSA_CASH', name: 'Long Service Award (Cash)', category: 'ADDITIONAL_WAGES', isCpfApplicable: true, isIrasTaxable: false, wageType: 'AW', sortOrder: 28 },
      // E - Deductions
      { code: 'EMP_CPF', name: 'Employee CPF Contribution', category: 'DEDUCTION', isCpfApplicable: false, isIrasTaxable: false, wageType: 'DEDUCTION', sortOrder: 29 },
      { code: 'NPL_DED', name: 'No-Pay Leave (NPL) Deduction', category: 'DEDUCTION', isCpfApplicable: false, isIrasTaxable: false, wageType: 'DEDUCTION', sortOrder: 30 },
      { code: 'ABSENCE_DED', name: 'Absence / AWOL Deduction', category: 'DEDUCTION', isCpfApplicable: false, isIrasTaxable: false, wageType: 'DEDUCTION', sortOrder: 31 },
      { code: 'SAL_ADV_RECOV', name: 'Salary Advance Recovery', category: 'DEDUCTION', isCpfApplicable: false, isIrasTaxable: false, wageType: 'DEDUCTION', sortOrder: 32 },
      { code: 'STAFF_LOAN', name: 'Staff Loan Repayment', category: 'DEDUCTION', isCpfApplicable: false, isIrasTaxable: false, wageType: 'DEDUCTION', sortOrder: 33 },
      { code: 'OVERPAY_RECOV', name: 'Overpayment Recovery', category: 'DEDUCTION', isCpfApplicable: false, isIrasTaxable: false, wageType: 'DEDUCTION', sortOrder: 34 },
      { code: 'GARNISHMENT', name: 'Court Order / Garnishment', category: 'DEDUCTION', isCpfApplicable: false, isIrasTaxable: false, wageType: 'DEDUCTION', sortOrder: 35 },
      // F - Reimbursements
      { code: 'MED_REIMB', name: 'Medical Reimbursement', category: 'REIMBURSEMENT', isCpfApplicable: false, isIrasTaxable: false, wageType: 'REIMBURSEMENT', sortOrder: 36 },
      { code: 'TRANSPORT_CLAIM', name: 'Transport Claim (Actual)', category: 'REIMBURSEMENT', isCpfApplicable: false, isIrasTaxable: false, wageType: 'REIMBURSEMENT', sortOrder: 37 },
      { code: 'ENTERTAIN_REIMB', name: 'Entertainment Reimbursement', category: 'REIMBURSEMENT', isCpfApplicable: false, isIrasTaxable: false, wageType: 'REIMBURSEMENT', sortOrder: 38 },
      { code: 'TRAINING_REIMB', name: 'Training / Course Reimbursement', category: 'REIMBURSEMENT', isCpfApplicable: false, isIrasTaxable: false, wageType: 'REIMBURSEMENT', sortOrder: 39 },
      { code: 'HANDPHONE_REIMB', name: 'Handphone Bill Reimbursement', category: 'REIMBURSEMENT', isCpfApplicable: false, isIrasTaxable: false, wageType: 'REIMBURSEMENT', sortOrder: 40 },
      { code: 'MILEAGE_REIMB', name: 'Mileage Reimbursement', category: 'REIMBURSEMENT', isCpfApplicable: false, isIrasTaxable: false, wageType: 'REIMBURSEMENT', sortOrder: 41 },
      // G - Government-Paid Leave
      { code: 'GPML', name: 'Government-Paid Maternity Leave', category: 'GOVT_PAID', isCpfApplicable: true, isIrasTaxable: false, wageType: 'OW', sortOrder: 42 },
      { code: 'GPPL', name: 'Government-Paid Paternity Leave', category: 'GOVT_PAID', isCpfApplicable: true, isIrasTaxable: false, wageType: 'OW', sortOrder: 43 },
      { code: 'GPCL', name: 'Government-Paid Childcare Leave', category: 'GOVT_PAID', isCpfApplicable: true, isIrasTaxable: false, wageType: 'OW', sortOrder: 44 },
      { code: 'GPSL', name: 'Government-Paid Shared Parental Leave', category: 'GOVT_PAID', isCpfApplicable: true, isIrasTaxable: false, wageType: 'OW', sortOrder: 45 },
      // H - BIK (Benefits in Kind)
      { code: 'CAR_BIK', name: 'Company Car (BIK)', category: 'BIK', isCpfApplicable: false, isIrasTaxable: true, wageType: 'OW', sortOrder: 46 },
      { code: 'HOUSING_BIK', name: 'Housing Benefit (BIK)', category: 'BIK', isCpfApplicable: false, isIrasTaxable: true, wageType: 'OW', sortOrder: 47 },
      { code: 'CLUB_MEMB', name: 'Club Membership (BIK)', category: 'BIK', isCpfApplicable: false, isIrasTaxable: true, wageType: 'OW', sortOrder: 48 },
      { code: 'GRP_INS', name: 'Group Insurance Premium (BIK)', category: 'BIK', isCpfApplicable: false, isIrasTaxable: true, wageType: 'OW', sortOrder: 49 },
      // I - ESOP / Stock
      { code: 'ESOP_GAIN', name: 'Stock Option Gain (ESOP)', category: 'ADDITIONAL_WAGES', isCpfApplicable: false, isIrasTaxable: true, wageType: 'AW', sortOrder: 50 },
      // J - Statutory
      { code: 'SDL', name: 'Skills Development Levy (SDL)', category: 'STATUTORY', isCpfApplicable: false, isIrasTaxable: false, wageType: 'DEDUCTION', sortOrder: 51 },
      { code: 'FWL', name: 'Foreign Worker Levy (FWL)', category: 'STATUTORY', isCpfApplicable: false, isIrasTaxable: false, wageType: 'DEDUCTION', sortOrder: 52 },
      { code: 'EMPL_CPF', name: 'Employer CPF Contribution', category: 'STATUTORY', isCpfApplicable: false, isIrasTaxable: false, wageType: 'DEDUCTION', sortOrder: 53 },
      // K - Additional
      { code: 'DIRECTOR_FEE', name: 'Director Fees', category: 'ADDITIONAL_WAGES', isCpfApplicable: false, isIrasTaxable: true, wageType: 'AW', sortOrder: 54 },
      { code: 'GRATUITY', name: 'Gratuity Payment', category: 'ADDITIONAL_WAGES', isCpfApplicable: true, isIrasTaxable: true, wageType: 'AW', sortOrder: 55 },
      { code: 'NOTICE_PAY', name: 'Pay in Lieu of Notice', category: 'ADDITIONAL_WAGES', isCpfApplicable: true, isIrasTaxable: true, wageType: 'AW', sortOrder: 56 },
      { code: 'LEAVE_ENCASH', name: 'Leave Encashment', category: 'ADDITIONAL_WAGES', isCpfApplicable: true, isIrasTaxable: true, wageType: 'OW', sortOrder: 57 },
      { code: 'NS_PAY', name: 'NSman Make-Up Pay', category: 'GOVT_PAID', isCpfApplicable: true, isIrasTaxable: false, wageType: 'OW', sortOrder: 58 },
      { code: 'COMPASSIONATE', name: 'Compassionate Payment', category: 'ADDITIONAL_WAGES', isCpfApplicable: false, isIrasTaxable: true, wageType: 'AW', sortOrder: 59 },
    ];

    const existingComps = await payrollPrisma.payComponent.count();
    if (existingComps === 0) {
      await payrollPrisma.payComponent.createMany({ data: components.map(c => ({ ...c, id: uuidv4() })) });
      console.log(`✅ ${components.length} pay components seeded`);
    }

    // FWL Rates (sample)
    const fwlCount = await payrollPrisma.fwlRate.count();
    if (fwlCount === 0) {
      await payrollPrisma.fwlRate.createMany({
        data: [
          { id: uuidv4(), passType: 'WP', sector: 'SERVICES', tier: 'BASIC_SKILLED', dailyRate: 15.00, effectiveDate: new Date('2025-01-01') },
          { id: uuidv4(), passType: 'WP', sector: 'SERVICES', tier: 'HIGHER_SKILLED', dailyRate: 7.00, effectiveDate: new Date('2025-01-01') },
          { id: uuidv4(), passType: 'S_PASS', sector: 'SERVICES', tier: 'TIER1', dailyRate: 13.00, effectiveDate: new Date('2025-01-01') },
          { id: uuidv4(), passType: 'WP', sector: 'CONSTRUCTION', tier: 'BASIC_SKILLED', dailyRate: 15.00, effectiveDate: new Date('2025-01-01') },
        ],
      });
      console.log('✅ FWL rates seeded');
    }

    // Singapore Public Holidays 2025
    const phCount = await payrollPrisma.publicHoliday.count();
    if (phCount === 0) {
      await payrollPrisma.publicHoliday.createMany({
        data: [
          { id: uuidv4(), date: new Date('2025-01-01'), name: "New Year's Day", year: 2025 },
          { id: uuidv4(), date: new Date('2025-01-29'), name: 'Chinese New Year', year: 2025 },
          { id: uuidv4(), date: new Date('2025-01-30'), name: 'Chinese New Year (Day 2)', year: 2025 },
          { id: uuidv4(), date: new Date('2025-03-31'), name: 'Hari Raya Puasa', year: 2025 },
          { id: uuidv4(), date: new Date('2025-04-18'), name: 'Good Friday', year: 2025 },
          { id: uuidv4(), date: new Date('2025-05-01'), name: 'Labour Day', year: 2025 },
          { id: uuidv4(), date: new Date('2025-06-06'), name: 'Hari Raya Haji', year: 2025 },
          { id: uuidv4(), date: new Date('2025-08-09'), name: 'National Day', year: 2025 },
          { id: uuidv4(), date: new Date('2025-10-20'), name: 'Deepavali', year: 2025 },
          { id: uuidv4(), date: new Date('2025-12-25'), name: 'Christmas Day', year: 2025 },
        ],
        skipDuplicates: true,
      });
      console.log('✅ Singapore Public Holidays 2025 seeded');
    }
  } finally { await payrollPrisma.$disconnect(); }
}

async function seedLeave() {
  const leavePrisma = new LeavePrisma({ datasources: { db: { url: `postgresql://${process.env.POSTGRES_USER}:${process.env.POSTGRES_PASSWORD}@${process.env.POSTGRES_HOST || 'localhost'}:5432/hrms_leave` } } });
  try {
    const count = await leavePrisma.leaveType.count();
    if (count > 0) { console.log('ℹ️  Leave types already seeded'); return; }

    const leaveTypes = [
      { code: 'AL', name: 'Annual Leave', isStatutory: true, isPaid: true, annualEntitlement: 14, maxCarryForward: 5 },
      { code: 'SL', name: 'Sick Leave (Outpatient)', isStatutory: true, isPaid: true, annualEntitlement: 14, requiresDocument: true },
      { code: 'HL', name: 'Hospitalisation Leave', isStatutory: true, isPaid: true, annualEntitlement: 60, requiresDocument: true },
      { code: 'ML', name: 'Maternity Leave', isStatutory: true, isPaid: true, annualEntitlement: 112, isGovtPaid: true, requiresDocument: true },
      { code: 'PL', name: 'Paternity Leave', isStatutory: true, isPaid: true, annualEntitlement: 14, isGovtPaid: true },
      { code: 'CL', name: 'Childcare Leave', isStatutory: true, isPaid: true, annualEntitlement: 6, isGovtPaid: true },
      { code: 'ECL', name: 'Extended Childcare Leave', isStatutory: true, isPaid: true, annualEntitlement: 2 },
      { code: 'SPL', name: 'Shared Parental Leave', isStatutory: true, isPaid: true, annualEntitlement: 28, isGovtPaid: true },
      { code: 'ADPL', name: 'Adoption Leave', isStatutory: true, isPaid: true, annualEntitlement: 12, isGovtPaid: true },
      { code: 'NSL', name: 'NSman Leave', isStatutory: true, isPaid: true, annualEntitlement: 0 },
      { code: 'COMP', name: 'Compassionate Leave', isStatutory: false, isPaid: true, annualEntitlement: 3 },
      { code: 'MARR', name: 'Marriage Leave', isStatutory: false, isPaid: true, annualEntitlement: 3 },
      { code: 'EXAM', name: 'Examination Leave', isStatutory: false, isPaid: true, annualEntitlement: 5, requiresDocument: true },
      { code: 'NPL', name: 'No-Pay Leave', isStatutory: true, isPaid: false, annualEntitlement: 0 },
      { code: 'OIL', name: 'Off-In-Lieu', isStatutory: false, isPaid: true, annualEntitlement: 0 },
      { code: 'PHI', name: 'Public Holiday In-Lieu', isStatutory: true, isPaid: true, annualEntitlement: 0 },
      { code: 'VWO', name: 'VWO Leave', isStatutory: false, isPaid: false, annualEntitlement: 0 },
      { code: 'STUDY', name: 'Study Leave', isStatutory: false, isPaid: false, annualEntitlement: 5 },
      { code: 'LSL', name: 'Long Service Leave', isStatutory: false, isPaid: true, annualEntitlement: 5 },
      { code: 'QUAR', name: 'Quarantine Leave', isStatutory: true, isPaid: true, annualEntitlement: 0, requiresDocument: true },
      { code: 'JURY', name: 'Jury Duty Leave', isStatutory: true, isPaid: true, annualEntitlement: 0, requiresDocument: true },
      { code: 'OTHER', name: 'Other Leave', isStatutory: false, isPaid: false, annualEntitlement: 0 },
    ];
    await leavePrisma.leaveType.createMany({ data: leaveTypes.map(l => ({ ...l, id: uuidv4() })) });
    console.log(`✅ ${leaveTypes.length} leave types seeded`);

    // Public Holidays in leave-service too
    await leavePrisma.publicHoliday.createMany({
      data: [
        { id: uuidv4(), date: new Date('2025-01-01'), name: "New Year's Day", year: 2025 },
        { id: uuidv4(), date: new Date('2025-01-29'), name: 'Chinese New Year', year: 2025 },
        { id: uuidv4(), date: new Date('2025-01-30'), name: 'Chinese New Year (Day 2)', year: 2025 },
        { id: uuidv4(), date: new Date('2025-03-31'), name: 'Hari Raya Puasa', year: 2025 },
        { id: uuidv4(), date: new Date('2025-04-18'), name: 'Good Friday', year: 2025 },
        { id: uuidv4(), date: new Date('2025-05-01'), name: 'Labour Day', year: 2025 },
        { id: uuidv4(), date: new Date('2025-06-06'), name: 'Hari Raya Haji', year: 2025 },
        { id: uuidv4(), date: new Date('2025-08-09'), name: 'National Day', year: 2025 },
        { id: uuidv4(), date: new Date('2025-10-20'), name: 'Deepavali', year: 2025 },
        { id: uuidv4(), date: new Date('2025-12-25'), name: 'Christmas Day', year: 2025 },
      ], skipDuplicates: true,
    });
    console.log('✅ Singapore Public Holidays 2025 seeded (leave-service)');
  } finally { await leavePrisma.$disconnect(); }
}

async function seedClaims() {
  const claimsPrisma = new ClaimsPrisma({ datasources: { db: { url: `postgresql://${process.env.POSTGRES_USER}:${process.env.POSTGRES_PASSWORD}@${process.env.POSTGRES_HOST || 'localhost'}:5432/hrms_claims` } } });
  try {
    const count = await claimsPrisma.claimCategory.count();
    if (count > 0) { console.log('ℹ️  Claim categories already seeded'); return; }
    await claimsPrisma.claimCategory.createMany({
      data: [
        { id: uuidv4(), code: 'MEDICAL', name: 'Medical / Dental', requiresReceipt: true, isGstClaimable: false, maxAmount: 500 },
        { id: uuidv4(), code: 'TRANSPORT', name: 'Transport (Business)', requiresReceipt: true, isGstClaimable: false },
        { id: uuidv4(), code: 'ENTERTAINMENT', name: 'Business Entertainment', requiresReceipt: true, isGstClaimable: true, maxAmount: 1000 },
        { id: uuidv4(), code: 'TRAINING', name: 'Training / Course Fees', requiresReceipt: true, isGstClaimable: true },
        { id: uuidv4(), code: 'TELECOM', name: 'Telecommunication (Business)', requiresReceipt: true, isGstClaimable: true },
        { id: uuidv4(), code: 'MEAL', name: 'Meal (Business)', requiresReceipt: true, isGstClaimable: false, maxAmount: 200 },
        { id: uuidv4(), code: 'OTHER', name: 'Other Business Expense', requiresReceipt: true, isGstClaimable: false },
      ],
    });
    console.log('✅ Claim categories seeded');
  } finally { await claimsPrisma.$disconnect(); }
}

async function main() {
  console.log('\n🌱 EzyHRM Seed Script\n');
  await seedAuth();
  await seedPayroll();
  await seedLeave();
  await seedClaims();
  console.log('\n✅ Seeding complete!\n');
  console.log('Default Super Admin: admin@ezyhRM.sg / ***REMOVED***');
}

main().catch(err => { console.error('❌ Seed failed:', err.message); process.exit(1); });
