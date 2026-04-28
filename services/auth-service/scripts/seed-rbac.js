'use strict';

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Seeding RBAC...');

  // 1. Create Permissions
  const permissions = [
    // Auth & Users
    { code: 'user:manage', name: 'Manage Users', description: 'Create, update, and deactivate user accounts', module: 'AUTH' },
    { code: 'role:manage', name: 'Manage Roles', description: 'Create and customize roles and permissions', module: 'AUTH' },
    
    // Employee
    { code: 'employee:view', name: 'View Employees', description: 'View basic employee profiles', module: 'EMPLOYEE' },
    { code: 'employee:manage', name: 'Manage Employees', description: 'Create and update employee records', module: 'EMPLOYEE' },
    { code: 'employee:sensitive', name: 'View Sensitive Data', description: 'View salaries, bank details, and personal info', module: 'EMPLOYEE' },
    
    // Payroll
    { code: 'payroll:view', name: 'View Payroll', description: 'View payroll records and history', module: 'PAYROLL' },
    { code: 'payroll:run', name: 'Process Payroll', description: 'Run monthly payroll cycles', module: 'PAYROLL' },
    
    // Leave & Claims
    { code: 'leave:view', name: 'View Leaves', description: 'View leave applications', module: 'LEAVE' },
    { code: 'leave:approve', name: 'Approve Leaves', description: 'Approve or reject leave requests', module: 'LEAVE' },
    { code: 'claims:view', name: 'View Claims', description: 'View expense claims', module: 'CLAIMS' },
    { code: 'claims:approve', name: 'Approve Claims', description: 'Approve or reject expense claims', module: 'CLAIMS' },
    
    // Attendance
    { code: 'attendance:view', name: 'View Attendance', description: 'View clock-in/out records', module: 'ATTENDANCE' },
    { code: 'attendance:manage', name: 'Manage Shifts', description: 'Manage employee shifts and overtime', module: 'ATTENDANCE' },
    
    // Recruitment
    { code: 'recruitment:manage', name: 'Manage Recruitment', description: 'Manage job postings and candidates', module: 'RECRUITMENT' },
    
    // Reports
    { code: 'report:view', name: 'View Reports', description: 'Access standard system reports', module: 'REPORTING' },
    { code: 'report:financial', name: 'View Financial Reports', description: 'Access payroll summary and CPF reports', module: 'REPORTING' },
  ];

  for (const p of permissions) {
    await prisma.permission.upsert({
      where: { code: p.code },
      update: p,
      create: p,
    });
  }
  console.log(`- Created ${permissions.length} permissions`);

  // 2. Create System Roles
  const roles = [
    { name: 'SUPER_ADMIN', description: 'System owner with full access', isSystem: true, perms: permissions.map(p => p.code) },
    { name: 'ADMIN', description: 'General administrative access', isSystem: true, perms: ['employee:view', 'employee:manage', 'leave:view', 'leave:approve', 'attendance:view', 'claims:view', 'report:view'] },
    { name: 'HR_ADMIN', description: 'Full HR management access', isSystem: true, perms: ['employee:view', 'employee:manage', 'employee:sensitive', 'leave:view', 'leave:approve', 'attendance:view', 'attendance:manage', 'report:view'] },
    { name: 'PAYROLL_OFFICER', description: 'Payroll processing access', isSystem: true, perms: ['employee:view', 'employee:sensitive', 'payroll:view', 'payroll:run', 'report:financial'] },
    { name: 'EMPLOYEE', description: 'Standard employee access', isSystem: true, perms: ['employee:view', 'leave:view', 'claims:view', 'attendance:view'] },
  ];

  for (const r of roles) {
    const role = await prisma.role.upsert({
      where: { name: r.name },
      update: { description: r.description, isSystem: r.isSystem },
      create: { name: r.name, description: r.description, isSystem: r.isSystem },
    });

    // Link permissions
    for (const pCode of r.perms) {
      const p = await prisma.permission.findUnique({ where: { code: pCode } });
      if (!p) {
        console.error(`Permission not found for code: ${pCode} in role: ${r.name}`);
        continue; 
      }
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: p.id } },
        update: {},
        create: { roleId: role.id, permissionId: p.id },
      });
    }
  }
  console.log(`- Created ${roles.length} system roles`);

  // 3. Assign SUPER_ADMIN role to existing admin users if any
  const superAdminRole = await prisma.role.findUnique({ where: { name: 'SUPER_ADMIN' } });
  if (superAdminRole) {
    await prisma.user.updateMany({
      where: { roleId: null },
      data: { roleId: superAdminRole.id },
    });
    console.log('- Assigned SUPER_ADMIN role to unmounted users');
  }

  console.log('RBAC Seeding complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
