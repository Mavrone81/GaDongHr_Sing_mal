'use strict';

const { PrismaClient } = require('@prisma/client');
const { v4: uuidv4 } = require('uuid');
const prisma = new PrismaClient();

// Real employee IDs from hrms_employee
const EMPLOYEES = [
  { id: 'bbb912ee-9826-4751-b10e-c8694df914c1', name: 'Wei Jing Lim',            dept: 'Engineering' },
  { id: 'fc456639-850a-4110-a08d-58805bffd4e9', name: 'Priya Nair',               dept: 'Engineering' },
  { id: '1940c5e5-d363-481e-8098-03f60eb07058', name: 'Ahmad Fadzillah',          dept: 'Engineering' },
  { id: '41d03b61-2d98-411a-bce9-ba2f2e6d8057', name: 'Marcus Tan',               dept: 'Engineering' },
  { id: '5a866a6e-cd7e-4191-8173-8ef399c4f1cb', name: 'Rachel Ong',               dept: 'Human Resources' },
  { id: '93aecbe9-be6a-45bd-a3b4-89d24e1466bb', name: 'Siti Aminah Binte Yusof', dept: 'Human Resources' },
  { id: 'be987544-dd90-411a-b72c-8178cee8ad1d', name: 'David Chen Weiming',       dept: 'Finance' },
  { id: '04944233-bbd2-4e46-aae3-4b2b29fc2546', name: 'Kavitha Subramaniam',      dept: 'Finance' },
  { id: 'c3897387-e6a3-443a-a60f-3baa8a3557cb', name: 'James Koh Boon Huat',      dept: 'Operations' },
  { id: '4b0923b0-9c58-4282-99d7-cce93aaa84e0', name: 'Nurul Huda Binte Razak',   dept: 'Operations' },
  { id: '3f88bb2b-adce-4cb7-83ba-57b2a3744948', name: 'Brandon Lee Kai Xian',     dept: 'Sales' },
  { id: 'e3f82d55-2759-4570-9e89-7f467dbfac5f', name: 'Jasmine Wong Hui Ling',    dept: 'Sales' },
];

// Managers per dept (first employee in each dept acts as manager for seed purposes)
const MANAGER_MAP = {
  Engineering:      'bbb912ee-9826-4751-b10e-c8694df914c1',
  'Human Resources':'5a866a6e-cd7e-4191-8173-8ef399c4f1cb',
  Finance:          'be987544-dd90-411a-b72c-8178cee8ad1d',
  Operations:       'c3897387-e6a3-443a-a60f-3baa8a3557cb',
  Sales:            '3f88bb2b-adce-4cb7-83ba-57b2a3744948',
};

const ADMIN_ID = 'admin-seed';

async function main() {
  console.log('Seeding performance mock data…\n');

  // ── 1. Review Cycles ────────────────────────────────────────────────────────
  const cycles = await Promise.all([
    prisma.reviewCycle.upsert({
      where: { id: 'cycle-annual-2025' },
      create: {
        id: 'cycle-annual-2025',
        name: 'Annual Performance Review FY2025',
        type: 'ANNUAL',
        startDate: new Date('2025-01-01'),
        endDate: new Date('2025-12-31'),
        currentPhase: 'COMPLETED',
        status: 'COMPLETED',
        description: 'Full-year performance review covering all departments.',
        createdBy: ADMIN_ID,
      },
      update: {},
    }),
    prisma.reviewCycle.upsert({
      where: { id: 'cycle-midyear-2026' },
      create: {
        id: 'cycle-midyear-2026',
        name: 'Mid-Year Check-In H1 2026',
        type: 'MID_YEAR',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-06-30'),
        currentPhase: 'MANAGER_REVIEW',
        status: 'ACTIVE',
        description: 'H1 check-in — goal alignment and mid-cycle feedback.',
        createdBy: ADMIN_ID,
      },
      update: {},
    }),
    prisma.reviewCycle.upsert({
      where: { id: 'cycle-probation-q1' },
      create: {
        id: 'cycle-probation-q1',
        name: 'Probation Review Q1 2026',
        type: 'PROBATION',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-03-31'),
        currentPhase: 'CALIBRATION',
        status: 'ACTIVE',
        description: 'End-of-probation review for Q1 joiners.',
        createdBy: ADMIN_ID,
      },
      update: {},
    }),
    prisma.reviewCycle.upsert({
      where: { id: 'cycle-annual-2026' },
      create: {
        id: 'cycle-annual-2026',
        name: 'Annual Performance Review FY2026',
        type: 'ANNUAL',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        currentPhase: 'GOAL_SETTING',
        status: 'DRAFT',
        description: 'Full-year review — currently in goal-setting phase.',
        createdBy: ADMIN_ID,
      },
      update: {},
    }),
  ]);
  console.log(`✓ ${cycles.length} review cycles`);

  // ── 2. Appraisals for Mid-Year 2026 (MANAGER_REVIEW phase) ─────────────────
  const midYearAppraisals = [
    // Fully completed: self + manager + finalised
    { emp: EMPLOYEES[0], selfScore: 4.5, managerScore: 4.0, overallScore: 4.25, status: 'FINALISED',
      selfComments: 'Led the migration to microservices architecture, reducing deployment time by 40%. Mentored 2 junior engineers.',
      strengths: 'Technical depth, ownership mindset, communication with stakeholders.',
      improvements: 'Could delegate more effectively to scale impact.',
      managerComments: 'Wei Jing consistently delivers high-quality work and elevates the team. Ready for a senior role.' },
    // Self submitted, manager pending
    { emp: EMPLOYEES[1], selfScore: 3.5, managerScore: null, overallScore: null, status: 'SELF_SUBMITTED',
      selfComments: 'Delivered 3 major features on time. Improved test coverage from 48% to 72% in my squad.',
      strengths: 'Detail-oriented, strong test discipline.',
      improvements: 'Want to develop stronger product sense and speak up more in cross-functional meetings.',
      managerComments: null },
    // Self submitted, manager pending
    { emp: EMPLOYEES[2], selfScore: 4.0, managerScore: null, overallScore: null, status: 'SELF_SUBMITTED',
      selfComments: 'Resolved critical production incidents with minimal downtime. Built internal tooling that saved 3h/week.',
      strengths: 'Problem-solving, reliability under pressure.',
      improvements: 'Documentation and knowledge sharing could be more consistent.',
      managerComments: null },
    // Pending
    { emp: EMPLOYEES[3], selfScore: null, managerScore: null, overallScore: null, status: 'PENDING',
      selfComments: null, strengths: null, improvements: null, managerComments: null },
    // HR finalised
    { emp: EMPLOYEES[4], selfScore: 5.0, managerScore: 4.5, overallScore: 4.75, status: 'FINALISED',
      selfComments: 'Revamped onboarding process, cutting time-to-productivity for new hires from 3 weeks to 10 days.',
      strengths: 'Empathy, process design, stakeholder management.',
      improvements: 'Building deeper analytics capability to measure HR initiatives.',
      managerComments: 'Rachel is one of the strongest performers I\'ve managed. Her onboarding revamp had measurable company-wide impact.' },
    // Self submitted
    { emp: EMPLOYEES[5], selfScore: 3.0, managerScore: null, overallScore: null, status: 'SELF_SUBMITTED',
      selfComments: 'Handled full recruitment cycle for 8 roles. Maintained employee satisfaction scores.',
      strengths: 'Relationship building, consistent follow-through.',
      improvements: 'Want to leverage data more in HR decisions.',
      managerComments: null },
    // Finalised
    { emp: EMPLOYEES[6], selfScore: 4.0, managerScore: 3.5, overallScore: 3.75, status: 'FINALISED',
      selfComments: 'Closed audit with zero critical findings. Improved month-end close time by 2 days.',
      strengths: 'Precision, regulatory knowledge, stakeholder confidence.',
      improvements: 'Adopting more automation for recurring reconciliations.',
      managerComments: 'David is thorough and dependable. A clear asset during audit season.' },
    // Pending
    { emp: EMPLOYEES[7], selfScore: null, managerScore: null, overallScore: null, status: 'PENDING',
      selfComments: null, strengths: null, improvements: null, managerComments: null },
    // Manager submitted
    { emp: EMPLOYEES[8], selfScore: 3.5, managerScore: 4.0, overallScore: 3.75, status: 'MANAGER_SUBMITTED',
      selfComments: 'Reduced SLA breach rate from 12% to 3% through better workload planning and team rota.',
      strengths: 'Operational discipline, team coordination.',
      improvements: 'Could contribute more to strategic planning sessions.',
      managerComments: 'James has driven real operational improvements. Recommend calibration at 3.75.' },
    // Self submitted
    { emp: EMPLOYEES[9], selfScore: 4.0, managerScore: null, overallScore: null, status: 'SELF_SUBMITTED',
      selfComments: 'Managed vendor relationships and renegotiated 2 contracts saving $18K annually.',
      strengths: 'Negotiation, follow-through, vendor relationships.',
      improvements: 'Want to develop people management skills.',
      managerComments: null },
    // Finalised
    { emp: EMPLOYEES[10], selfScore: 4.5, managerScore: 4.5, overallScore: 4.5, status: 'FINALISED',
      selfComments: 'Exceeded Q1-Q2 targets by 22%. Opened 4 new enterprise accounts.',
      strengths: 'Hustle, relationship depth with enterprise clients, pipeline management.',
      improvements: 'Need to improve forecasting accuracy.',
      managerComments: 'Brandon is top of the leaderboard and a great cultural ambassador for the sales team.' },
    // Pending
    { emp: EMPLOYEES[11], selfScore: null, managerScore: null, overallScore: null, status: 'PENDING',
      selfComments: null, strengths: null, improvements: null, managerComments: null },
  ];

  for (const a of midYearAppraisals) {
    const managerId = MANAGER_MAP[a.emp.dept];
    await prisma.appraisal.upsert({
      where: { cycleId_employeeId: { cycleId: 'cycle-midyear-2026', employeeId: a.emp.id } },
      create: {
        id: uuidv4(),
        cycleId: 'cycle-midyear-2026',
        employeeId: a.emp.id,
        managerId,
        selfScore: a.selfScore,
        managerScore: a.managerScore,
        overallScore: a.overallScore,
        selfComments: a.selfComments,
        managerComments: a.managerComments,
        strengths: a.strengths,
        improvements: a.improvements,
        status: a.status,
        selfSubmittedAt: a.selfScore ? new Date('2026-04-15') : null,
        managerSubmittedAt: a.managerScore ? new Date('2026-04-22') : null,
        finalisedAt: a.status === 'FINALISED' ? new Date('2026-04-30') : null,
      },
      update: {},
    });
  }
  console.log(`✓ ${midYearAppraisals.length} appraisals (Mid-Year 2026)`);

  // ── 3. Goals ─────────────────────────────────────────────────────────────────
  const goals = [
    { empId: EMPLOYEES[0].id, title: 'Complete AWS Solutions Architect certification', category: 'DEVELOPMENT', progress: 70, status: 'ACTIVE', targetDate: '2026-08-31', description: 'Study and pass the AWS SAA-C03 exam.' },
    { empId: EMPLOYEES[0].id, title: 'Reduce P1 incident response time to < 15 min', category: 'PERFORMANCE', progress: 100, status: 'ACHIEVED', targetDate: '2026-06-30', description: 'Implement runbooks and on-call improvements.' },
    { empId: EMPLOYEES[1].id, title: 'Achieve 80% test coverage on payment service', category: 'PERFORMANCE', progress: 72, status: 'ACTIVE', targetDate: '2026-07-31', description: 'Expand unit and integration test coverage.' },
    { empId: EMPLOYEES[1].id, title: 'Present at internal tech talk', category: 'DEVELOPMENT', progress: 0, status: 'ACTIVE', targetDate: '2026-09-30', description: 'Share learnings on observability tooling.' },
    { empId: EMPLOYEES[2].id, title: 'Publish internal runbooks for top-5 incidents', category: 'ORGANIZATIONAL', progress: 60, status: 'ACTIVE', targetDate: '2026-06-30', description: 'Document resolution steps for recurring issues.' },
    { empId: EMPLOYEES[4].id, title: 'Reduce new-hire time-to-productivity to 10 days', category: 'PERFORMANCE', progress: 100, status: 'ACHIEVED', targetDate: '2026-03-31', description: 'Redesign onboarding process with buddy system.' },
    { empId: EMPLOYEES[4].id, title: 'Launch employee engagement survey', category: 'ORGANIZATIONAL', progress: 45, status: 'ACTIVE', targetDate: '2026-09-30', description: 'Design, distribute and analyse bi-annual survey.' },
    { empId: EMPLOYEES[6].id, title: 'Automate month-end reconciliation', category: 'PERFORMANCE', progress: 35, status: 'ACTIVE', targetDate: '2026-10-31', description: 'Build Excel macros or Python scripts to cut manual effort.' },
    { empId: EMPLOYEES[6].id, title: 'Zero audit findings in external audit', category: 'PERFORMANCE', progress: 100, status: 'ACHIEVED', targetDate: '2026-04-30', description: 'Maintain documentation and controls to pass with zero critical findings.' },
    { empId: EMPLOYEES[8].id, title: 'Reduce SLA breach rate to < 5%', category: 'PERFORMANCE', progress: 100, status: 'ACHIEVED', targetDate: '2026-05-31', description: 'Redesign workload allocation and escalation playbook.' },
    { empId: EMPLOYEES[9].id, title: 'Renegotiate 3 vendor contracts', category: 'PERFORMANCE', progress: 67, status: 'ACTIVE', targetDate: '2026-07-31', description: 'Benchmark market rates and renegotiate for savings.' },
    { empId: EMPLOYEES[10].id, title: 'Exceed H1 sales target by 20%', category: 'PERFORMANCE', progress: 100, status: 'ACHIEVED', targetDate: '2026-06-30', description: 'Focus on enterprise upsell and 3 new logo deals.' },
    { empId: EMPLOYEES[10].id, title: 'Build pipeline forecasting model', category: 'DEVELOPMENT', progress: 20, status: 'ACTIVE', targetDate: '2026-12-31', description: 'Use CRM data to build a 90-day forecast model.' },
    { empId: EMPLOYEES[11].id, title: 'Complete sales certification (Sandler)', category: 'DEVELOPMENT', progress: 50, status: 'ACTIVE', targetDate: '2026-09-30', description: 'Complete Sandler Sales training programme.' },
    { empId: EMPLOYEES[3].id, title: 'Migrate legacy auth service to OAuth 2.0', category: 'ORGANIZATIONAL', progress: 25, status: 'ACTIVE', targetDate: '2026-11-30', description: 'Technical lead for auth modernisation project.' },
  ];

  for (const g of goals) {
    await prisma.goal.create({
      data: {
        id: uuidv4(),
        employeeId: g.empId,
        cycleId: 'cycle-midyear-2026',
        title: g.title,
        description: g.description,
        targetDate: new Date(g.targetDate),
        progress: g.progress,
        status: g.status,
        category: g.category,
      },
    });
  }
  console.log(`✓ ${goals.length} goals`);

  // ── 4. PIPs ───────────────────────────────────────────────────────────────────
  const pips = [
    {
      id: 'pip-001',
      employeeId: EMPLOYEES[3].id,
      managerId: MANAGER_MAP['Engineering'],
      startDate: new Date('2026-03-01'),
      endDate: new Date('2026-06-01'),
      objectives: '1. Deliver assigned sprint tasks with < 15% carry-over for 3 consecutive sprints.\n2. Attend all daily standups and retrospectives without unexcused absence.\n3. Proactively communicate blockers within 24 hours of identification.\n4. Complete internal code review training module by 31 Mar 2026.',
      progressNotes: 'Week 1-2: Marcus attended all standups. Sprint 1 carry-over was 20% — above target but improving.\nWeek 3-4: Sprint 2 carry-over down to 12%. Code review module completed on 28 Mar. Good progress.',
      status: 'ACTIVE',
    },
    {
      id: 'pip-002',
      employeeId: EMPLOYEES[7].id,
      managerId: MANAGER_MAP['Finance'],
      startDate: new Date('2026-01-15'),
      endDate: new Date('2026-04-15'),
      objectives: '1. Submit all monthly reports by the 5th working day of the following month, with zero revisions.\n2. Reduce reconciliation errors to 0 per quarter.\n3. Complete the Advanced Excel certification by 28 Feb 2026.',
      progressNotes: 'Jan report submitted on time — 2 minor revisions needed. Feb report: on time, 0 revisions. Excel certification passed 25 Feb.\nMar report: on time with 0 revisions. All objectives met ahead of schedule.',
      status: 'COMPLETED',
    },
  ];

  for (const p of pips) {
    await prisma.pipRecord.upsert({
      where: { id: p.id },
      create: { ...p },
      update: {},
    });
  }
  console.log(`✓ ${pips.length} PIP records`);

  console.log('\nSeed complete.');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
