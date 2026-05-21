'use strict';

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Seeding RBAC...');

  // ── 1. Permissions ────────────────────────────────────────────────────────
  const permissions = [
    // AUTH
    { code: 'user:manage',        name: 'Manage Users',           description: 'Create, update, and deactivate user accounts',               module: 'AUTH' },
    { code: 'role:manage',        name: 'Manage Roles',           description: 'Create and customise roles and permission sets',              module: 'AUTH' },
    { code: 'settings:manage',    name: 'Manage Settings',        description: 'Configure org settings, SSO, MFA policy, and data purge',    module: 'AUTH' },

    // EMPLOYEE
    { code: 'employee:view',      name: 'View Employees',         description: 'View basic employee profiles and org chart',                  module: 'EMPLOYEE' },
    { code: 'employee:manage',    name: 'Manage Employees',       description: 'Create, update, and terminate employee records',              module: 'EMPLOYEE' },
    { code: 'employee:sensitive', name: 'View Sensitive Data',    description: 'View salaries, bank details, NRIC, and payroll data',         module: 'EMPLOYEE' },
    { code: 'document:manage',    name: 'Manage Documents',       description: 'Upload and delete employee documents and contracts',          module: 'EMPLOYEE' },

    // LEAVE
    { code: 'leave:view',         name: 'View Leaves',            description: 'View team and organisation leave applications',               module: 'LEAVE' },
    { code: 'leave:approve',      name: 'Approve Leaves',         description: 'Approve or reject leave requests',                           module: 'LEAVE' },

    // PAYROLL
    { code: 'payroll:view',       name: 'View Payroll',           description: 'View payroll runs, payslips, and history',                   module: 'PAYROLL' },
    { code: 'payroll:run',        name: 'Process Payroll',        description: 'Run, compute, approve, and finalise payroll cycles',         module: 'PAYROLL' },

    // CLAIMS
    { code: 'claims:view',        name: 'View Claims',            description: 'View expense claim submissions across the organisation',      module: 'CLAIMS' },
    { code: 'claims:approve',     name: 'Approve Claims',         description: 'Approve or reject expense claims',                           module: 'CLAIMS' },

    // ATTENDANCE
    { code: 'attendance:view',    name: 'View Attendance',        description: 'View clock-in/out records and overtime',                     module: 'ATTENDANCE' },
    { code: 'attendance:manage',  name: 'Manage Attendance',      description: 'Correct attendance records and manage work locations',       module: 'ATTENDANCE' },
    { code: 'roster:view',        name: 'View Roster',            description: 'View shift schedules and project assignments',               module: 'ATTENDANCE' },
    { code: 'roster:manage',      name: 'Manage Roster',          description: 'Create and edit shifts, patterns, and rosters',             module: 'ATTENDANCE' },

    // RECRUITMENT
    { code: 'recruitment:view',   name: 'View Recruitment',       description: 'View job postings and candidate pipeline',                   module: 'RECRUITMENT' },
    { code: 'recruitment:manage', name: 'Manage Recruitment',     description: 'Post jobs, manage candidates, interviews, and onboard',     module: 'RECRUITMENT' },

    // ASSET
    { code: 'asset:view',         name: 'View Assets',            description: 'View asset inventory and assignment history',                module: 'ASSET' },
    { code: 'asset:manage',       name: 'Manage Assets',          description: 'Create assets and manage assignments and returns',           module: 'ASSET' },

    // OFFBOARDING
    { code: 'offboarding:manage', name: 'Manage Offboarding',     description: 'Initiate offboarding, manage checklists, and trigger IR21', module: 'OFFBOARDING' },

    // REPORTING
    { code: 'report:view',        name: 'View Reports',           description: 'Access headcount, leave utilisation, and operational reports', module: 'REPORTING' },
    { code: 'report:financial',   name: 'View Financial Reports', description: 'Access payroll summary, CPF submission, and bank GIRO files', module: 'REPORTING' },
  ];

  for (const p of permissions) {
    await prisma.permission.upsert({ where: { code: p.code }, update: p, create: p });
  }
  console.log(`- Upserted ${permissions.length} permissions`);

  // ── 2. Role definitions ───────────────────────────────────────────────────
  const ALL = permissions.map(p => p.code);

  const roles = [
    {
      name: 'SUPER_ADMIN',
      description: 'Full system access — all modules and settings',
      isSystem: true,
      perms: ALL,
    },
    {
      name: 'IT_ADMIN',
      description: 'User management, system settings, SSO, MFA, and IT asset oversight',
      isSystem: true,
      perms: [
        'user:manage', 'role:manage', 'settings:manage',
        'employee:view',
        'asset:view', 'asset:manage',
        'report:view',
      ],
    },
    {
      name: 'ADMIN',
      description: 'General administrative access for HR-adjacent staff who do not need full HR data',
      isSystem: true,
      perms: [
        'employee:view', 'employee:manage',
        'leave:view', 'leave:approve',
        'claims:view',
        'attendance:view', 'roster:view', 'roster:manage',
        'report:view',
      ],
    },
    {
      name: 'HR_ADMIN',
      description: 'Full HR operations — employees, leave, payroll reports, claims, recruitment, and offboarding',
      isSystem: true,
      perms: [
        'employee:view', 'employee:manage', 'employee:sensitive', 'document:manage',
        'leave:view', 'leave:approve',
        'payroll:view',
        'claims:view', 'claims:approve',
        'attendance:view', 'attendance:manage', 'roster:view', 'roster:manage',
        'recruitment:view', 'recruitment:manage',
        'asset:view',
        'offboarding:manage',
        'report:view', 'report:financial',
      ],
    },
    {
      name: 'HR_MANAGER',
      description: 'HR operations — employees, leave, claims, attendance, and recruitment (no payroll or sensitive data)',
      isSystem: true,
      perms: [
        'employee:view', 'employee:manage', 'document:manage',
        'leave:view', 'leave:approve',
        'claims:view', 'claims:approve',
        'attendance:view', 'attendance:manage', 'roster:view', 'roster:manage',
        'recruitment:view', 'recruitment:manage',
        'asset:view',
        'report:view',
      ],
    },
    {
      name: 'PAYROLL_OFFICER',
      description: 'Full payroll cycle, CPF, bank GIRO, and employee financial data',
      isSystem: true,
      perms: [
        'employee:view', 'employee:sensitive',
        'payroll:view', 'payroll:run',
        'attendance:view', 'roster:view',
        'report:view', 'report:financial',
      ],
    },
    {
      name: 'FINANCE_ADMIN',
      description: 'Claims approval, payroll visibility, and financial reporting',
      isSystem: true,
      perms: [
        'employee:view',
        'claims:view', 'claims:approve',
        'payroll:view',
        'asset:view',
        'report:view', 'report:financial',
      ],
    },
    {
      name: 'LINE_MANAGER',
      description: 'Team lead — approve leave and claims, manage roster for direct reports',
      isSystem: true,
      perms: [
        'employee:view',
        'leave:view', 'leave:approve',
        'claims:view', 'claims:approve',
        'attendance:view', 'roster:view', 'roster:manage',
        'asset:view',
      ],
    },
    {
      name: 'RECRUITER',
      description: 'End-to-end recruitment — job postings, candidates, interviews, and onboarding',
      isSystem: true,
      perms: [
        'employee:view',
        'recruitment:view', 'recruitment:manage',
      ],
    },
    {
      name: 'EMPLOYEE',
      description: 'Standard employee — self-service leave, claims, attendance, and asset visibility',
      isSystem: true,
      perms: [
        'employee:view',
        'leave:view',
        'claims:view',
        'attendance:view',
        'asset:view',
      ],
    },
  ];

  for (const r of roles) {
    const role = await prisma.role.upsert({
      where: { name: r.name },
      update: { description: r.description, isSystem: r.isSystem },
      create: { name: r.name, description: r.description, isSystem: r.isSystem },
    });

    // Rebuild permission links cleanly
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });

    for (const pCode of r.perms) {
      const p = await prisma.permission.findUnique({ where: { code: pCode } });
      if (!p) { console.error(`  ✗ Permission not found: ${pCode} (role: ${r.name})`); continue; }
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: p.id } });
    }
    console.log(`  ✓ ${r.name} — ${r.perms.length} permissions`);
  }

  // ── 3. Ensure admin accounts have SUPER_ADMIN ─────────────────────────────
  const superAdminRole = await prisma.role.findUnique({ where: { name: 'SUPER_ADMIN' } });
  if (superAdminRole) {
    await prisma.user.updateMany({ where: { roleId: null }, data: { roleId: superAdminRole.id } });
  }

  console.log('RBAC seeding complete.');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
