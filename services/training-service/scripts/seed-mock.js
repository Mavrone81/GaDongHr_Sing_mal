'use strict';
// Run: node scripts/seed-mock.js
// Requires DATABASE_URL env pointing at hrms_training
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { v4: uuidv4 } = require('uuid');

const prisma = new PrismaClient();

const PROGRAMS = [
  {
    title: 'Workplace Safety & Health (WSH) Essentials',
    description: 'Mandatory WSH training covering hazard identification, PPE usage, and emergency procedures.',
    category: 'SAFETY', status: 'PUBLISHED', durationMins: 120, passingScore: 75, isMandatory: true,
    materials: [
      { title: 'WSH Act Overview', type: 'DOCUMENT', url: null, orderIndex: 0, durationMins: 20 },
      { title: 'Hazard Identification Video', type: 'VIDEO', url: 'https://example.com/hazard-id.mp4', orderIndex: 1, durationMins: 30 },
      { title: 'WSH Quiz', type: 'QUIZ', url: null, orderIndex: 2, durationMins: 15 },
    ],
  },
  {
    title: 'Personal Data Protection Act (PDPA) Compliance',
    description: 'Understand PDPA obligations, data handling procedures, and breach reporting requirements.',
    category: 'COMPLIANCE', status: 'PUBLISHED', durationMins: 90, passingScore: 80, isMandatory: true,
    materials: [
      { title: 'PDPA Overview', type: 'DOCUMENT', url: null, orderIndex: 0, durationMins: 25 },
      { title: 'Data Handling Best Practices', type: 'VIDEO', url: 'https://example.com/pdpa.mp4', orderIndex: 1, durationMins: 20 },
      { title: 'PDPA Assessment', type: 'QUIZ', url: null, orderIndex: 2, durationMins: 15 },
    ],
  },
  {
    title: 'Leadership Essentials for New Managers',
    description: 'Foundations of people management — setting expectations, giving feedback, and running 1:1s.',
    category: 'LEADERSHIP', status: 'PUBLISHED', durationMins: 180, passingScore: null, isMandatory: false,
    materials: [
      { title: 'The Manager Mindset', type: 'VIDEO', url: 'https://example.com/manager-mindset.mp4', orderIndex: 0, durationMins: 45 },
      { title: 'Running Effective 1:1s', type: 'DOCUMENT', url: null, orderIndex: 1, durationMins: 20 },
      { title: 'Feedback Frameworks', type: 'LINK', url: 'https://example.com/feedback', orderIndex: 2, durationMins: null },
    ],
  },
  {
    title: 'Excel & Data Analytics for HR',
    description: 'Pivot tables, VLOOKUP, and HR dashboard creation using real workforce data.',
    category: 'TECHNICAL', status: 'PUBLISHED', durationMins: 240, passingScore: 70, isMandatory: false,
    materials: [
      { title: 'Excel Fundamentals', type: 'VIDEO', url: 'https://example.com/excel-basics.mp4', orderIndex: 0, durationMins: 60 },
      { title: 'Pivot Tables for HR Analytics', type: 'DOCUMENT', url: null, orderIndex: 1, durationMins: 30 },
      { title: 'HR Dashboard Template', type: 'LINK', url: 'https://example.com/hr-dashboard', orderIndex: 2, durationMins: null },
      { title: 'Excel Skills Assessment', type: 'QUIZ', url: null, orderIndex: 3, durationMins: 30 },
    ],
  },
  {
    title: 'New Employee Onboarding',
    description: 'Company culture, values, org structure, and essential tools walkthrough for new joiners.',
    category: 'ONBOARDING', status: 'PUBLISHED', durationMins: 60, passingScore: null, isMandatory: true,
    materials: [
      { title: 'Welcome to VorkHive', type: 'VIDEO', url: 'https://example.com/welcome.mp4', orderIndex: 0, durationMins: 15 },
      { title: 'Employee Handbook', type: 'DOCUMENT', url: null, orderIndex: 1, durationMins: 20 },
      { title: 'IT & Tools Setup Guide', type: 'LINK', url: 'https://example.com/it-setup', orderIndex: 2, durationMins: null },
    ],
  },
  {
    title: 'Effective Communication & Presentation Skills',
    description: 'Build confidence in presenting ideas, handling Q&A, and written communication at work.',
    category: 'SOFT_SKILLS', status: 'PUBLISHED', durationMins: 150, passingScore: null, isMandatory: false,
    materials: [
      { title: 'Structuring Your Message', type: 'VIDEO', url: 'https://example.com/comms.mp4', orderIndex: 0, durationMins: 40 },
      { title: 'Presentation Techniques', type: 'DOCUMENT', url: null, orderIndex: 1, durationMins: 25 },
    ],
  },
  {
    title: 'Anti-Money Laundering (AML) Awareness',
    description: 'Recognise red flags, reporting obligations, and MAS Notice 626 requirements. Draft stage.',
    category: 'COMPLIANCE', status: 'DRAFT', durationMins: 60, passingScore: 80, isMandatory: false,
    materials: [],
  },
];

async function main() {
  console.log('Seeding training programs…');

  const createdBy = 'seed-admin';

  for (const prog of PROGRAMS) {
    const { materials, ...programData } = prog;
    const program = await prisma.trainingProgram.upsert({
      where: { id: uuidv4() },
      update: {},
      create: {
        id: uuidv4(),
        ...programData,
        createdBy,
      },
    });
    // simpler: just create (idempotency handled by clearing first)
    for (const mat of materials) {
      await prisma.trainingMaterial.create({
        data: { id: uuidv4(), programId: program.id, ...mat },
      });
    }
    console.log(`  ✓ ${program.title} (${program.status})`);
  }

  console.log('\nDone. Seed complete.');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
