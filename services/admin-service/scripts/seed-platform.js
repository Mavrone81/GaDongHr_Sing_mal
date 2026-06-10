'use strict';
// Idempotent: seed the module catalog + the initial platform admin.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const MODULES = [
  { code: 'employee', name: 'Employee / Core HR', isCore: true },
  { code: 'auth', name: 'Authentication', isCore: true },
  { code: 'payroll', name: 'Payroll' },
  { code: 'leave', name: 'Leave' },
  { code: 'claims', name: 'Claims & Expenses' },
  { code: 'attendance', name: 'Attendance' },
  { code: 'recruitment', name: 'Recruitment' },
  { code: 'performance', name: 'Performance' },
  { code: 'training', name: 'Training' },
  { code: 'offboarding', name: 'Offboarding' },
  { code: 'asset', name: 'Assets' },
  { code: 'benefits', name: 'Benefits' },
  { code: 'loans', name: 'Loans' },
  { code: 'survey', name: 'Surveys' },
  { code: 'hr-case', name: 'HR Cases' },
  { code: 'support', name: 'Support' },
  { code: 'reporting', name: 'Reporting' },
  { code: 'notification', name: 'Notifications' },
  { code: 'esign', name: 'E-Sign' },
];

(async () => {
  try {
    for (const m of MODULES) {
      await prisma.module.upsert({ where: { code: m.code }, update: { name: m.name, isCore: !!m.isCore }, create: { code: m.code, name: m.name, isCore: !!m.isCore } });
    }
    const email = (process.env.PLATFORM_ADMIN_EMAIL || '').toLowerCase().trim();
    const pw = process.env.PLATFORM_ADMIN_PASSWORD || '';
    if (email && pw.length >= 12) {
      const existing = await prisma.platformAdmin.findUnique({ where: { email } });
      if (!existing) {
        await prisma.platformAdmin.create({ data: { email, passwordHash: await bcrypt.hash(pw, 12), name: 'Platform Owner', role: 'SUPER_ADMIN' } });
        console.log('[seed-platform] created platform SUPER_ADMIN:', email, '(enrol MFA on first login)');
      } else {
        console.log('[seed-platform] platform admin exists:', email);
      }
    } else {
      console.log('[seed-platform] PLATFORM_ADMIN_EMAIL/PASSWORD (>=12 chars) not set — skipping admin seed');
    }
    console.log('[seed-platform] modules ensured:', MODULES.length);
    await prisma.$disconnect();
  } catch (e) {
    console.error('[seed-platform] FAILED:', e.message);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  }
})();
