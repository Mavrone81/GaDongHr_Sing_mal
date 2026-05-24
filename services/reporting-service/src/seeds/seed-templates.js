'use strict';
/**
 * RPT-003 Phase 2 — pre-built workforce analytics seed templates.
 * Idempotent: skips any template whose id already exists.
 */

const SEED_TEMPLATES = [
  {
    id: 'seed-headcount-by-dept',
    name: 'Active Headcount by Department',
    description: 'Live employee count per department (active employees only)',
    category: 'WORKFORCE',
    isShared: true,
    ownerId: 'system',
    definition: {
      dataSource: 'employees',
      filters: [{ field: 'isActive', op: 'eq', value: true }],
      groupBy: 'department',
      aggregations: [{ op: 'count', as: 'headcount' }],
      sortBy: [{ field: 'headcount', dir: 'desc' }],
    },
  },
  {
    id: 'seed-attrition-analysis',
    name: 'Attrition Analysis',
    description: 'All terminated employees with department, employment type, and exit dates',
    category: 'WORKFORCE',
    isShared: true,
    ownerId: 'system',
    definition: {
      dataSource: 'employees',
      filters: [{ field: 'isActive', op: 'eq', value: false }],
      fields: [
        { key: 'employeeCode', label: 'Code' },
        { key: 'fullName', label: 'Full Name' },
        { key: 'department', label: 'Department' },
        { key: 'employmentType', label: 'Employment Type' },
        { key: 'startDate', label: 'Start Date' },
        { key: 'endDate', label: 'End Date' },
        { key: 'nationality', label: 'Nationality' },
      ],
      sortBy: [{ field: 'endDate', dir: 'desc' }],
    },
  },
  {
    id: 'seed-leave-usage-by-type',
    name: 'Leave Usage by Type',
    description: 'Approved leave days grouped by leave type',
    category: 'LEAVE',
    isShared: true,
    ownerId: 'system',
    definition: {
      dataSource: 'leaveApplications',
      filters: [{ field: 'status', op: 'eq', value: 'APPROVED' }],
      groupBy: 'leaveTypeName',
      aggregations: [
        { op: 'count', as: 'applications' },
        { field: 'totalDays', op: 'sum', as: 'totalDays' },
        { field: 'totalDays', op: 'avg', as: 'avgDays' },
      ],
      sortBy: [{ field: 'totalDays', dir: 'desc' }],
    },
  },
  {
    id: 'seed-claims-by-category',
    name: 'Claims Spend by Category',
    description: 'Approved and paid expense claims grouped by category',
    category: 'FINANCIAL',
    isShared: true,
    ownerId: 'system',
    definition: {
      dataSource: 'claims',
      filters: [{ field: 'status', op: 'in', value: ['APPROVED', 'PAID'] }],
      groupBy: 'category',
      aggregations: [
        { op: 'count', as: 'claimCount' },
        { field: 'amount', op: 'sum', as: 'totalAmount' },
        { field: 'gstAmount', op: 'sum', as: 'totalGst' },
      ],
      sortBy: [{ field: 'totalAmount', dir: 'desc' }],
    },
  },
];

async function seedTemplates(prisma) {
  let seeded = 0;
  for (const tpl of SEED_TEMPLATES) {
    const exists = await prisma.reportTemplate.findUnique({ where: { id: tpl.id } });
    if (!exists) {
      await prisma.reportTemplate.create({ data: tpl });
      seeded++;
    }
  }
  if (seeded > 0) console.log(`[reporting] Seeded ${seeded} pre-built template(s).`);
  return seeded;
}

module.exports = { seedTemplates, SEED_TEMPLATES };
