#!/usr/bin/env node
'use strict';

/**
 * Employee Seed Script — populates hrms_employee + hrms_auth with test data
 * Run from repo root: node scripts/seed-employees.js
 * Requires: docker-compose up (postgres must be running on localhost:5444)
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { Client } = require('pg');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

const HOST = process.env.POSTGRES_HOST === 'postgres' ? 'localhost' : (process.env.POSTGRES_HOST || 'localhost');
const PORT = parseInt(process.env.POSTGRES_PORT) || 5432;
const USER = process.env.POSTGRES_USER || 'hrms';
const PASS = process.env.POSTGRES_PASSWORD || 'hrms_secret_2025';

// The .env stores the key as base64; the crypto module expects 64-char hex
const RAW_KEY = process.env.ENCRYPTION_KEY || '';
const ENC_KEY = RAW_KEY.length === 64
  ? Buffer.from(RAW_KEY, 'hex')
  : Buffer.from(RAW_KEY, 'base64');

function dbClient(database) {
  return new Client({ host: HOST, port: PORT, user: USER, password: PASS, database });
}

function encrypt(plaintext) {
  if (plaintext === null || plaintext === undefined) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv, { authTagLength: 16 });
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    data: encrypted.toString('hex'),
  });
}

// ── Seed Data ──────────────────────────────────────────────────────────────────

const DEPARTMENTS = ['Engineering', 'Human Resources', 'Finance', 'Operations', 'Sales', 'Marketing', 'Legal'];

// roleId from hrms_auth.roles
const EMPLOYEE_ROLE_ID = '2d98123b-12b2-4a2e-a602-365ce3ca925e';
const MANAGER_ROLE_ID  = 'aeeb1220-f6ff-47ff-bbc5-bb0adb14d498';

const EMPLOYEES = [
  // ── Engineering ──
  {
    fullName: 'Wei Jing Lim',      preferredName: 'WJ',
    nric: 'S8812345A', nricType: 'NRIC', nationality: 'Singaporean', citizenshipStatus: 'SC',
    dob: '1988-04-12', gender: 'MALE', race: 'Chinese', religion: 'Buddhist', maritalStatus: 'MARRIED',
    personalEmail: 'weijing.lim@gmail.com', workEmail: 'weijing.lim@vorkhive.sg', personalPhone: '+65 9111 2222',
    homeAddress: 'Blk 123, Jurong West Ave 6, #08-45, S640123',
    department: 'Engineering', designation: 'Senior Software Engineer', costCentre: 'ENG-001',
    employmentType: 'FULL_TIME', startDate: '2021-03-01', confirmationDate: '2021-09-01',
    noticePeriodDays: 60, weeklyHours: 44, basicSalary: 8500,
    bankName: 'DBS Bank', bankCode: '7171', bankAccount: '0123456789', bankBranchCode: '001',
    isManager: true,
  },
  {
    fullName: 'Priya Nair',        preferredName: 'Priya',
    nric: 'T9023456B', nricType: 'NRIC', nationality: 'Singaporean', citizenshipStatus: 'SC',
    dob: '1990-07-23', gender: 'FEMALE', race: 'Indian', religion: 'Hindu', maritalStatus: 'SINGLE',
    personalEmail: 'priya.nair@gmail.com', workEmail: 'priya.nair@vorkhive.sg', personalPhone: '+65 9222 3333',
    homeAddress: 'Blk 45, Tampines St 42, #12-10, S520045',
    department: 'Engineering', designation: 'Frontend Engineer', costCentre: 'ENG-001',
    employmentType: 'FULL_TIME', startDate: '2022-06-15', confirmationDate: '2022-12-15',
    noticePeriodDays: 30, weeklyHours: 44, basicSalary: 6200,
    bankName: 'OCBC Bank', bankCode: '7339', bankAccount: '5012345678', bankBranchCode: '501',
    isManager: false,
  },
  {
    fullName: 'Ahmad Fadzillah',   preferredName: 'Ahmad',
    nric: 'S9134567C', nricType: 'NRIC', nationality: 'Singaporean', citizenshipStatus: 'SC',
    dob: '1991-11-05', gender: 'MALE', race: 'Malay', religion: 'Islam', maritalStatus: 'MARRIED',
    personalEmail: 'ahmad.fad@gmail.com', workEmail: 'ahmad.fadzillah@vorkhive.sg', personalPhone: '+65 9333 4444',
    homeAddress: 'Blk 78, Woodlands Dr 14, #05-22, S730078',
    department: 'Engineering', designation: 'Backend Engineer', costCentre: 'ENG-001',
    employmentType: 'FULL_TIME', startDate: '2023-01-10', confirmationDate: '2023-07-10',
    noticePeriodDays: 30, weeklyHours: 44, basicSalary: 5800,
    bankName: 'UOB', bankCode: '7375', bankAccount: '3456789012', bankBranchCode: '001',
    isManager: false,
  },
  {
    fullName: 'Marcus Tan',        preferredName: 'Marcus',
    nric: 'G1234567P', nricType: 'FIN', nationality: 'Malaysian', citizenshipStatus: 'FOREIGNER',
    passType: 'EP', passNumber: 'EP123456A', passExpiryDate: '2026-12-31', passIssuedDate: '2023-01-01',
    dob: '1993-08-18', gender: 'MALE', race: 'Chinese', religion: null, maritalStatus: 'SINGLE',
    personalEmail: 'marcus.tan@gmail.com', workEmail: 'marcus.tan@vorkhive.sg', personalPhone: '+60 12-345 6789',
    homeAddress: 'Blk 200, Bukit Timah Rd, #03-11, S229853',
    department: 'Engineering', designation: 'DevOps Engineer', costCentre: 'ENG-001',
    employmentType: 'FULL_TIME', startDate: '2023-03-20', confirmationDate: '2023-09-20',
    noticePeriodDays: 30, weeklyHours: 44, basicSalary: 7000,
    bankName: 'DBS Bank', bankCode: '7171', bankAccount: '9876543210', bankBranchCode: '001',
    isManager: false,
  },
  // ── Human Resources ──
  {
    fullName: 'Rachel Ong',        preferredName: 'Rachel',
    nric: 'S8545678D', nricType: 'NRIC', nationality: 'Singaporean', citizenshipStatus: 'SC',
    dob: '1985-02-28', gender: 'FEMALE', race: 'Chinese', religion: 'Christian', maritalStatus: 'MARRIED',
    personalEmail: 'rachel.ong@gmail.com', workEmail: 'rachel.ong@vorkhive.sg', personalPhone: '+65 9444 5555',
    homeAddress: 'Blk 12, Bishan St 13, #10-05, S570012',
    department: 'Human Resources', designation: 'HR Manager', costCentre: 'HR-001',
    employmentType: 'FULL_TIME', startDate: '2019-07-01', confirmationDate: '2020-01-01',
    noticePeriodDays: 60, weeklyHours: 44, basicSalary: 7800,
    bankName: 'POSB', bankCode: '7171', bankAccount: '1122334455', bankBranchCode: '101',
    isManager: true,
  },
  {
    fullName: 'Siti Aminah Binte Yusof', preferredName: 'Siti',
    nric: 'T9256789E', nricType: 'NRIC', nationality: 'Singaporean', citizenshipStatus: 'SC',
    dob: '1992-05-14', gender: 'FEMALE', race: 'Malay', religion: 'Islam', maritalStatus: 'SINGLE',
    personalEmail: 'siti.aminah@gmail.com', workEmail: 'siti.aminah@vorkhive.sg', personalPhone: '+65 9555 6666',
    homeAddress: 'Blk 34, Bedok North Rd, #04-15, S460034',
    department: 'Human Resources', designation: 'HR Executive', costCentre: 'HR-001',
    employmentType: 'FULL_TIME', startDate: '2022-09-05', confirmationDate: '2023-03-05',
    noticePeriodDays: 30, weeklyHours: 44, basicSalary: 4500,
    bankName: 'OCBC Bank', bankCode: '7339', bankAccount: '6677889900', bankBranchCode: '501',
    isManager: false,
  },
  // ── Finance ──
  {
    fullName: 'David Chen Weiming', preferredName: 'David',
    nric: 'S7967890F', nricType: 'NRIC', nationality: 'Singaporean', citizenshipStatus: 'SC',
    dob: '1979-12-01', gender: 'MALE', race: 'Chinese', religion: 'Taoist', maritalStatus: 'MARRIED',
    personalEmail: 'david.chen@gmail.com', workEmail: 'david.chen@vorkhive.sg', personalPhone: '+65 9666 7777',
    homeAddress: 'Blk 5, Holland Cl, #08-22, S271005',
    department: 'Finance', designation: 'Finance Manager', costCentre: 'FIN-001',
    employmentType: 'FULL_TIME', startDate: '2017-04-15', confirmationDate: '2017-10-15',
    noticePeriodDays: 90, weeklyHours: 44, basicSalary: 9200,
    bankName: 'UOB', bankCode: '7375', bankAccount: '2233445566', bankBranchCode: '001',
    isManager: true,
  },
  {
    fullName: 'Kavitha Subramaniam', preferredName: 'Kavi',
    nric: 'S9478901G', nricType: 'NRIC', nationality: 'Singaporean', citizenshipStatus: 'SC',
    dob: '1994-09-30', gender: 'FEMALE', race: 'Indian', religion: 'Hindu', maritalStatus: 'SINGLE',
    personalEmail: 'kavitha.sub@gmail.com', workEmail: 'kavitha.subramaniam@vorkhive.sg', personalPhone: '+65 9777 8888',
    homeAddress: 'Blk 67, Clementi Ave 3, #06-08, S120067',
    department: 'Finance', designation: 'Accountant', costCentre: 'FIN-001',
    employmentType: 'FULL_TIME', startDate: '2023-08-01', confirmationDate: '2024-02-01',
    noticePeriodDays: 30, weeklyHours: 44, basicSalary: 4800,
    bankName: 'DBS Bank', bankCode: '7171', bankAccount: '3344556677', bankBranchCode: '001',
    isManager: false,
  },
  // ── Operations ──
  {
    fullName: 'James Koh Boon Huat', preferredName: 'James',
    nric: 'S8089012H', nricType: 'NRIC', nationality: 'Singaporean', citizenshipStatus: 'SC',
    dob: '1980-06-22', gender: 'MALE', race: 'Chinese', religion: 'Buddhist', maritalStatus: 'MARRIED',
    personalEmail: 'james.koh@gmail.com', workEmail: 'james.koh@vorkhive.sg', personalPhone: '+65 9888 9999',
    homeAddress: 'Blk 456, Ang Mo Kio Ave 10, #14-30, S560456',
    department: 'Operations', designation: 'Operations Manager', costCentre: 'OPS-001',
    employmentType: 'FULL_TIME', startDate: '2018-11-01', confirmationDate: '2019-05-01',
    noticePeriodDays: 60, weeklyHours: 44, basicSalary: 8000,
    bankName: 'POSB', bankCode: '7171', bankAccount: '4455667788', bankBranchCode: '101',
    isManager: true,
  },
  {
    fullName: 'Nurul Huda Binte Razak', preferredName: 'Nurul',
    nric: 'T9590123I', nricType: 'NRIC', nationality: 'Singaporean', citizenshipStatus: 'SC',
    dob: '1995-03-07', gender: 'FEMALE', race: 'Malay', religion: 'Islam', maritalStatus: 'SINGLE',
    personalEmail: 'nurul.huda@gmail.com', workEmail: 'nurul.huda@vorkhive.sg', personalPhone: '+65 8111 2222',
    homeAddress: 'Blk 89, Punggol Dr, #03-45, S828089',
    department: 'Operations', designation: 'Operations Executive', costCentre: 'OPS-001',
    employmentType: 'FULL_TIME', startDate: '2024-02-01', confirmationDate: '2024-08-01',
    noticePeriodDays: 30, weeklyHours: 44, basicSalary: 3800,
    bankName: 'OCBC Bank', bankCode: '7339', bankAccount: '5566778899', bankBranchCode: '501',
    isManager: false,
  },
  // ── Sales ──
  {
    fullName: 'Brandon Lee Kai Xian', preferredName: 'Brandon',
    nric: 'S8701234J', nricType: 'NRIC', nationality: 'Singaporean', citizenshipStatus: 'SC',
    dob: '1987-10-15', gender: 'MALE', race: 'Chinese', religion: 'Christian', maritalStatus: 'MARRIED',
    personalEmail: 'brandon.lee@gmail.com', workEmail: 'brandon.lee@vorkhive.sg', personalPhone: '+65 8222 3333',
    homeAddress: 'Blk 22, Serangoon North Ave 4, #09-12, S554022',
    department: 'Sales', designation: 'Sales Manager', costCentre: 'SAL-001',
    employmentType: 'FULL_TIME', startDate: '2020-05-04', confirmationDate: '2020-11-04',
    noticePeriodDays: 60, weeklyHours: 44, basicSalary: 7500,
    bankName: 'DBS Bank', bankCode: '7171', bankAccount: '6677889901', bankBranchCode: '001',
    isManager: true,
  },
  {
    fullName: 'Jasmine Wong Hui Ling', preferredName: 'Jasmine',
    nric: 'T9612345K', nricType: 'NRIC', nationality: 'Singaporean', citizenshipStatus: 'SC',
    dob: '1996-01-20', gender: 'FEMALE', race: 'Chinese', religion: 'Buddhist', maritalStatus: 'SINGLE',
    personalEmail: 'jasmine.wong@gmail.com', workEmail: 'jasmine.wong@vorkhive.sg', personalPhone: '+65 8333 4444',
    homeAddress: 'Blk 33, Sengkang Square, #15-03, S545033',
    department: 'Sales', designation: 'Sales Executive', costCentre: 'SAL-001',
    employmentType: 'FULL_TIME', startDate: '2024-04-15', confirmationDate: '2024-10-15',
    noticePeriodDays: 30, weeklyHours: 44, basicSalary: 3500,
    bankName: 'UOB', bankCode: '7375', bankAccount: '7788990011', bankBranchCode: '001',
    isManager: false,
  },
  // ── Marketing ──
  {
    fullName: 'Sophia Tan Yi Xin',  preferredName: 'Sophia',
    nric: 'F1234567L', nricType: 'FIN', nationality: 'Chinese', citizenshipStatus: 'PR_YR3_PLUS',
    dob: '1989-07-08', gender: 'FEMALE', race: 'Chinese', religion: null, maritalStatus: 'MARRIED',
    personalEmail: 'sophia.tan@gmail.com', workEmail: 'sophia.tan@vorkhive.sg', personalPhone: '+65 8444 5555',
    homeAddress: 'Blk 77, Toa Payoh Ctrl, #20-01, S310077',
    department: 'Marketing', designation: 'Marketing Manager', costCentre: 'MKT-001',
    employmentType: 'FULL_TIME', startDate: '2020-08-17', confirmationDate: '2021-02-17',
    noticePeriodDays: 60, weeklyHours: 44, basicSalary: 7200,
    bankName: 'POSB', bankCode: '7171', bankAccount: '8899001122', bankBranchCode: '101',
    isManager: true, cpfPrYear: 3,
  },
  {
    fullName: 'Ethan Goh Zi Hao',   preferredName: 'Ethan',
    nric: 'T0023456M', nricType: 'NRIC', nationality: 'Singaporean', citizenshipStatus: 'SC',
    dob: '2000-09-25', gender: 'MALE', race: 'Chinese', religion: 'Freethinker', maritalStatus: 'SINGLE',
    personalEmail: 'ethan.goh@gmail.com', workEmail: 'ethan.goh@vorkhive.sg', personalPhone: '+65 8555 6666',
    homeAddress: 'Blk 55, Clementi Ave 2, #07-22, S120055',
    department: 'Marketing', designation: 'Marketing Executive', costCentre: 'MKT-001',
    employmentType: 'FULL_TIME', startDate: '2024-07-01', confirmationDate: '2025-01-01',
    noticePeriodDays: 30, weeklyHours: 44, basicSalary: 3200,
    bankName: 'DBS Bank', bankCode: '7171', bankAccount: '9900112233', bankBranchCode: '001',
    isManager: false,
  },
  // ── Legal / Contract ──
  {
    fullName: 'Ravi Chandrasekaran', preferredName: 'Ravi',
    nric: 'G9801234N', nricType: 'FIN', nationality: 'Indian', citizenshipStatus: 'FOREIGNER',
    passType: 'S_PASS', passNumber: 'SP987654B', passExpiryDate: '2025-11-30', passIssuedDate: '2023-12-01',
    dob: '1998-04-14', gender: 'MALE', race: 'Indian', religion: 'Hindu', maritalStatus: 'SINGLE',
    personalEmail: 'ravi.chan@gmail.com', workEmail: 'ravi.chandrasekaran@vorkhive.sg', personalPhone: '+91 98765 43210',
    homeAddress: 'Blk 99, Geylang Rd, #02-05, S389099',
    department: 'Engineering', designation: 'QA Engineer', costCentre: 'ENG-001',
    employmentType: 'CONTRACT', startDate: '2023-12-01', confirmationDate: null,
    noticePeriodDays: 14, weeklyHours: 44, basicSalary: 4200,
    bankName: 'OCBC Bank', bankCode: '7339', bankAccount: '1023456789', bankBranchCode: '501',
    isManager: false,
  },
];

// ── Seed Functions ─────────────────────────────────────────────────────────────

async function seedEmployees() {
  const empDb  = dbClient('hrms_employee');
  const authDb = dbClient('hrms_auth');
  await empDb.connect();
  await authDb.connect();

  try {
    // Dev seed only. Set SEED_EMPLOYEE_PASSWORD (or fall back to a dev literal
     // only outside production). Same password for every seeded employee is
     // acceptable in dev fixtures; production loads come via the invite flow.
    const isProd = process.env.NODE_ENV === 'production';
    const defaultPass = process.env.SEED_EMPLOYEE_PASSWORD ?? (isProd ? null : '***REMOVED***');
    if (!defaultPass) {
      throw new Error('SEED_EMPLOYEE_PASSWORD is required when NODE_ENV=production');
    }
    const passwordHash = await bcrypt.hash(defaultPass, 12);

    // Build reporting manager index (managers seeded first)
    const managerIds = {};

    let empNum = 1;
    for (const e of EMPLOYEES) {
      const empId   = uuidv4();
      const authId  = uuidv4();
      const empCode = `EMP-${String(empNum).padStart(4, '0')}`;

      // Encrypt sensitive fields
      const nricEnc    = encrypt(e.nric);
      const salaryEnc  = encrypt(String(e.basicSalary));
      const bankEnc    = encrypt(e.bankAccount);
      const addrEnc    = encrypt(e.homeAddress);

      // Assign reporting manager — first manager in the same dept, or null for managers
      let reportingManagerId = null;
      if (!e.isManager) {
        reportingManagerId = managerIds[e.department] || null;
      }

      await empDb.query(
        `INSERT INTO employees (
          id, "employeeCode", "fullName", "preferredName",
          "nricEncrypted", "nricType", nationality, "citizenshipStatus",
          "dateOfBirth", gender, race, religion, "maritalStatus",
          "personalEmail", "workEmail", "personalPhone",
          "homeAddressEncrypted",
          department, designation, "costCentre",
          "employmentType", "startDate", "confirmationDate",
          "noticePeriodDays", "weeklyHours",
          "basicSalaryEncrypted", "salaryBasis",
          "bankName", "bankCode", "bankAccountEncrypted", "bankBranchCode",
          "passType", "passNumber", "passExpiryDate", "passIssuedDate",
          "cpfPrYear", "reportingManagerId",
          "isActive", "createdAt", "updatedAt"
        ) VALUES (
          $1,$2,$3,$4,
          $5,$6,$7,$8,
          $9,$10,$11,$12,$13,
          $14,$15,$16,
          $17,
          $18,$19,$20,
          $21,$22,$23,
          $24,$25,
          $26,'MONTHLY',
          $27,$28,$29,$30,
          $31,$32,$33,$34,
          $35,$36,
          true,NOW(),NOW()
        )`,
        [
          empId, empCode, e.fullName, e.preferredName || null,
          nricEnc, e.nricType || 'NRIC', e.nationality, e.citizenshipStatus,
          new Date(e.dob), e.gender, e.race || null, e.religion || null, e.maritalStatus,
          e.personalEmail || null, e.workEmail, e.personalPhone || null,
          addrEnc,
          e.department, e.designation, e.costCentre || null,
          e.employmentType, new Date(e.startDate), e.confirmationDate ? new Date(e.confirmationDate) : null,
          e.noticePeriodDays, e.weeklyHours,
          salaryEnc,
          e.bankName || null, e.bankCode || null, bankEnc, e.bankBranchCode || null,
          e.passType || null, e.passNumber || null,
          e.passExpiryDate ? new Date(e.passExpiryDate) : null,
          e.passIssuedDate ? new Date(e.passIssuedDate) : null,
          e.cpfPrYear || null, reportingManagerId,
        ]
      );

      // Track managers for reporting relationships
      if (e.isManager) managerIds[e.department] = empId;

      // Create auth user
      const roleId = e.isManager ? MANAGER_ROLE_ID : EMPLOYEE_ROLE_ID;
      const existsRes = await authDb.query(`SELECT id FROM users WHERE email = $1`, [e.workEmail]);
      if (existsRes.rows.length === 0) {
        await authDb.query(
          `INSERT INTO users (id, email, "passwordHash", name, "roleId", "employeeId", "isActive", "mfaEnabled", "failedLogins", "createdAt", "updatedAt")
           VALUES ($1,$2,$3,$4,$5,$6,true,false,0,NOW(),NOW())`,
          [authId, e.workEmail, passwordHash, e.fullName, roleId, empId]
        );
      }

      // Salary history record
      await empDb.query(
        `INSERT INTO salary_history (id, "employeeId", "effectiveDate", "basicSalaryEnc", "changeReason", "createdAt")
         VALUES ($1,$2,$3,$4,'Initial salary on hire',NOW())`,
        [uuidv4(), empId, new Date(e.startDate), salaryEnc]
      );

      console.log(`  ✅ ${empCode} ${e.fullName} (${e.department} — ${e.designation})`);
      empNum++;
    }

    console.log(`\n✅ ${EMPLOYEES.length} employees seeded successfully`);
    console.log('   Default login password: $SEED_EMPLOYEE_PASSWORD (dev fallback if unset)\n');

  } finally {
    await empDb.end();
    await authDb.end();
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🌱 Employee Seed Script');
  console.log(`   Connecting to postgres at ${HOST}:${PORT}\n`);

  // Check if already seeded
  const checkDb = dbClient('hrms_employee');
  await checkDb.connect();
  const { rows } = await checkDb.query(`SELECT COUNT(*) FROM employees`);
  await checkDb.end();

  if (parseInt(rows[0].count) > 0) {
    console.log(`ℹ️  Employees already exist (${rows[0].count} records) — skipping`);
    console.log('   To re-seed, truncate the employees table first.\n');
    return;
  }

  await seedEmployees();
}

main().catch(err => {
  console.error('\n❌ Seed failed:', err.message);
  console.error('   Make sure docker-compose is running (docker-compose up -d)');
  process.exit(1);
});
