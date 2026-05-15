#!/usr/bin/env node
'use strict';

/**
 * Recruitment Seed Script
 * Populates: job_postings, candidates, interview_rounds,
 *            candidate_stage_events, onboarding_tasks, work_passes
 * Run from repo root: node scripts/seed-recruitment.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { Client } = require('pg');
const { v4: uuidv4 } = require('uuid');

const HOST = process.env.POSTGRES_HOST === 'postgres' ? 'localhost' : (process.env.POSTGRES_HOST || 'localhost');
const PORT = parseInt(process.env.POSTGRES_PORT) || 5432;
const USER = process.env.POSTGRES_USER || 'hrms';
const PASS = process.env.POSTGRES_PASSWORD || 'hrms_secret_2025';

function dbClient(database) {
  return new Client({ host: HOST, port: PORT, user: USER, password: PASS, database });
}

function daysAgo(n)   { const d = new Date(); d.setDate(d.getDate() - n); return d; }
function daysAhead(n) { const d = new Date(); d.setDate(d.getDate() + n); return d; }

// ── Known user IDs (from hrms_auth) ───────────────────────────────────────────
const ADMIN_ID    = '7ea49cc5-39a3-4061-8909-748d30b807e8';
const HR_MGR_ID   = '42f9f056-2a4e-456e-9ffb-08c024694beb'; // rachel.ong
const ENG_MGR_ID  = '362cefd5-17d6-49cb-9c72-09105af959c5'; // weijing.lim
const FIN_MGR_ID  = 'a1d3fb32-d99e-4aa9-93ab-081472717ffd'; // david.chen
const OPS_MGR_ID  = '54ab8333-8cf9-4862-b874-3be20300a5a1'; // james.koh
const SAL_MGR_ID  = '4d449fbb-c121-41cb-b025-3f112dced370'; // brandon.lee
const MKT_MGR_ID  = '37ceabfe-4799-4a3d-9566-346a5dd7201e'; // sophia.tan

// ── Job Postings ──────────────────────────────────────────────────────────────
// 10 postings: OPEN (active pipeline), FILLED, DRAFT, CANCELLED
const JOB_POSTINGS = [
  {
    id: uuidv4(),
    title: 'Full Stack Engineer',
    department: 'Engineering',
    headcount: 2,
    jobDescription: 'We are looking for a Full Stack Engineer to join our growing Engineering team. You will work on building and maintaining our core HRMS platform using Node.js, React, and PostgreSQL.',
    requirements: '3+ years full-stack experience. Proficiency in Node.js and React. Experience with PostgreSQL and RESTful APIs. Good understanding of CI/CD pipelines.',
    salaryMin: 5500, salaryMax: 8000,
    jobType: 'FULL_TIME',
    location: 'Singapore (Hybrid)',
    mcfJobId: 'MCF-2025-001234',
    mcfPostedAt: daysAgo(30),
    mcfExpiredAt: daysAhead(60),
    fcfCompliant: true,
    status: 'OPEN',
    postedById: ENG_MGR_ID,
    createdAt: daysAgo(32),
    label: 'fullstack_eng',
  },
  {
    id: uuidv4(),
    title: 'Senior DevOps Engineer',
    department: 'Engineering',
    headcount: 1,
    jobDescription: 'Seeking a Senior DevOps Engineer to own our cloud infrastructure on AWS, automate deployments, and ensure high availability of our services.',
    requirements: '5+ years DevOps/SRE experience. Strong knowledge of AWS, Docker, Kubernetes. Experience with Terraform. Familiarity with monitoring tools (Grafana, Prometheus).',
    salaryMin: 8000, salaryMax: 11000,
    jobType: 'FULL_TIME',
    location: 'Singapore (On-site)',
    mcfJobId: 'MCF-2025-001235',
    mcfPostedAt: daysAgo(20),
    mcfExpiredAt: daysAhead(70),
    fcfCompliant: true,
    status: 'OPEN',
    postedById: ENG_MGR_ID,
    createdAt: daysAgo(22),
    label: 'devops_sr',
  },
  {
    id: uuidv4(),
    title: 'HR Executive',
    department: 'Human Resources',
    headcount: 1,
    jobDescription: 'Join our HR team to support end-to-end HR operations including recruitment, onboarding, payroll support, and employee engagement programmes.',
    requirements: 'Diploma or Degree in HR Management or related field. 1–2 years HR experience preferred. Knowledge of Singapore Employment Act. Proficient in Microsoft Office.',
    salaryMin: 3500, salaryMax: 4800,
    jobType: 'FULL_TIME',
    location: 'Singapore (On-site)',
    mcfJobId: 'MCF-2025-001240',
    mcfPostedAt: daysAgo(15),
    mcfExpiredAt: daysAhead(75),
    fcfCompliant: true,
    status: 'OPEN',
    postedById: HR_MGR_ID,
    createdAt: daysAgo(17),
    label: 'hr_exec',
  },
  {
    id: uuidv4(),
    title: 'Financial Analyst',
    department: 'Finance',
    headcount: 1,
    jobDescription: 'We are hiring a Financial Analyst to support budgeting, forecasting, financial modelling, and month-end close activities.',
    requirements: 'Degree in Accountancy, Finance, or related. CPA/ACCA preferred. 2–4 years experience in finance or audit. Strong Excel and data analysis skills.',
    salaryMin: 4500, salaryMax: 6500,
    jobType: 'FULL_TIME',
    location: 'Singapore (Hybrid)',
    mcfJobId: 'MCF-2025-001248',
    mcfPostedAt: daysAgo(10),
    mcfExpiredAt: daysAhead(80),
    fcfCompliant: true,
    status: 'OPEN',
    postedById: FIN_MGR_ID,
    createdAt: daysAgo(12),
    label: 'fin_analyst',
  },
  {
    id: uuidv4(),
    title: 'Operations Coordinator',
    department: 'Operations',
    headcount: 2,
    jobDescription: 'Coordinate day-to-day operational activities, liaise with vendors, manage scheduling, and support the Operations Manager in process improvement initiatives.',
    requirements: 'Diploma or Degree in Business, Supply Chain, or Operations. 1–3 years relevant experience. Strong organisational and communication skills.',
    salaryMin: 3000, salaryMax: 4200,
    jobType: 'FULL_TIME',
    location: 'Singapore (On-site)',
    mcfJobId: null,
    mcfPostedAt: null,
    mcfExpiredAt: null,
    fcfCompliant: false,
    status: 'DRAFT',
    postedById: OPS_MGR_ID,
    createdAt: daysAgo(5),
    label: 'ops_coord',
  },
  {
    id: uuidv4(),
    title: 'Senior Sales Manager',
    department: 'Sales',
    headcount: 1,
    jobDescription: 'Lead the enterprise sales team, develop client relationships, drive revenue growth, and mentor junior sales staff.',
    requirements: '7+ years B2B sales experience. Proven track record of meeting/exceeding targets. Strong negotiation and stakeholder management skills.',
    salaryMin: 9000, salaryMax: 13000,
    jobType: 'FULL_TIME',
    location: 'Singapore (Hybrid)',
    mcfJobId: 'MCF-2025-001260',
    mcfPostedAt: daysAgo(45),
    mcfExpiredAt: daysAgo(5),
    fcfCompliant: true,
    status: 'FILLED',
    postedById: SAL_MGR_ID,
    createdAt: daysAgo(48),
    label: 'sr_sales_mgr',
  },
  {
    id: uuidv4(),
    title: 'Digital Marketing Specialist',
    department: 'Marketing',
    headcount: 1,
    jobDescription: 'Plan and execute digital marketing campaigns across SEO, SEM, social media, and email. Analyse campaign performance and optimise ROI.',
    requirements: 'Degree in Marketing, Communications, or related. 2–4 years digital marketing experience. Google Ads & Analytics certified preferred. Strong analytical mindset.',
    salaryMin: 4000, salaryMax: 6000,
    jobType: 'FULL_TIME',
    location: 'Singapore (Hybrid)',
    mcfJobId: 'MCF-2025-001268',
    mcfPostedAt: daysAgo(25),
    mcfExpiredAt: daysAhead(65),
    fcfCompliant: true,
    status: 'OPEN',
    postedById: MKT_MGR_ID,
    createdAt: daysAgo(27),
    label: 'digital_mkt',
  },
  {
    id: uuidv4(),
    title: 'Payroll Administrator',
    department: 'Human Resources',
    headcount: 1,
    jobDescription: 'Process monthly payroll for all employees, ensure CPF and statutory compliance, handle IR8A submissions and payroll queries.',
    requirements: 'Diploma in Accounting or Business. 2+ years payroll experience in Singapore. Knowledge of CPF rules, SDL, and IRAS reporting. Familiarity with payroll software.',
    salaryMin: 3800, salaryMax: 5200,
    jobType: 'FULL_TIME',
    location: 'Singapore (On-site)',
    mcfJobId: null,
    mcfPostedAt: null,
    mcfExpiredAt: null,
    fcfCompliant: false,
    status: 'DRAFT',
    postedById: HR_MGR_ID,
    createdAt: daysAgo(3),
    label: 'payroll_admin',
  },
  {
    id: uuidv4(),
    title: 'Junior Software Engineer (Intern)',
    department: 'Engineering',
    headcount: 2,
    jobDescription: 'Internship opportunity for final-year students to work on real-world HRMS features under senior engineer mentorship.',
    requirements: 'Pursuing Degree in Computer Science or related. Basic knowledge of JavaScript or Python. Eagerness to learn. Available for 6-month full-time internship.',
    salaryMin: 1200, salaryMax: 1800,
    jobType: 'FULL_TIME',
    location: 'Singapore (Hybrid)',
    mcfJobId: 'MCF-2025-001290',
    mcfPostedAt: daysAgo(8),
    mcfExpiredAt: daysAhead(82),
    fcfCompliant: true,
    status: 'OPEN',
    postedById: ENG_MGR_ID,
    createdAt: daysAgo(10),
    label: 'intern_eng',
  },
  {
    id: uuidv4(),
    title: 'Legal Counsel',
    department: 'Legal',
    headcount: 1,
    jobDescription: 'Provide legal advice on employment law, contracts, compliance, and corporate governance matters.',
    requirements: 'LLB degree. Admitted to the Singapore Bar. 4+ years in employment/corporate law. In-house experience preferred.',
    salaryMin: 10000, salaryMax: 15000,
    jobType: 'FULL_TIME',
    location: 'Singapore (On-site)',
    mcfJobId: null,
    mcfPostedAt: null,
    mcfExpiredAt: null,
    fcfCompliant: false,
    status: 'CANCELLED',
    postedById: ADMIN_ID,
    createdAt: daysAgo(60),
    label: 'legal_counsel',
  },
];

// ── Candidates per job (keyed by job label) ────────────────────────────────────
function buildCandidates(jobMap) {
  const all = [];

  // ── Full Stack Engineer (OPEN) — active pipeline, all stages represented
  const fsId = jobMap['fullstack_eng'];
  all.push(
    { id: uuidv4(), jobId: fsId, firstName: 'Darren', lastName: 'Chua', email: 'darren.chua@email.com', phone: '+65 9101 0001', currentEmployer: 'TechCorp Pte Ltd', currentTitle: 'Software Developer', noticePeriod: 30, expectedSalary: 7200, stage: 'OFFER', notes: 'Strong technical assessment. Offered $7,000. Awaiting acceptance.', createdAt: daysAgo(28), interviews: [{ roundName: 'Phone Screen', scheduledAt: daysAgo(25), result: 'PASS', notes: 'Good communication, relevant React/Node experience.' }, { roundName: 'Technical Interview', scheduledAt: daysAgo(18), result: 'PASS', notes: 'Solved all coding problems. Strong system design answers.' }, { roundName: 'Final Interview (Hiring Manager)', scheduledAt: daysAgo(8), result: 'PASS', notes: 'Culture fit confirmed. Headcount approved.' }] },
    { id: uuidv4(), jobId: fsId, firstName: 'Michelle', lastName: 'Phua', email: 'michelle.phua@email.com', phone: '+65 9202 0002', currentEmployer: 'Startup SG', currentTitle: 'Junior Developer', noticePeriod: 14, expectedSalary: 6000, stage: 'INTERVIEW_2', notes: 'Cleared phone screen and first technical round. Scheduled for panel interview.', createdAt: daysAgo(22), interviews: [{ roundName: 'Phone Screen', scheduledAt: daysAgo(20), result: 'PASS', notes: 'Enthusiastic, strong portfolio.' }, { roundName: 'Technical Interview', scheduledAt: daysAgo(12), result: 'PASS', notes: 'Good problem-solving skills.' }, { roundName: 'Panel Interview', scheduledAt: daysAhead(3), result: 'PENDING', notes: null }] },
    { id: uuidv4(), jobId: fsId, firstName: 'Kevin', lastName: 'Ng', email: 'kevin.ng@email.com', phone: '+65 9303 0003', currentEmployer: 'Bank of SG', currentTitle: 'Associate Engineer', noticePeriod: 60, expectedSalary: 8500, stage: 'REJECTED', notes: 'Expected salary above budget. Did not pass technical round.', createdAt: daysAgo(26), interviews: [{ roundName: 'Phone Screen', scheduledAt: daysAgo(24), result: 'PASS', notes: 'Overqualified for some aspects.' }, { roundName: 'Technical Interview', scheduledAt: daysAgo(16), result: 'FAIL', notes: 'Weak on React fundamentals. Not aligned with role.' }] },
    { id: uuidv4(), jobId: fsId, firstName: 'Aiyana', lastName: 'Sharma', email: 'aiyana.sharma@email.com', phone: '+65 9404 0004', currentEmployer: null, currentTitle: null, noticePeriod: 0, expectedSalary: 6500, stage: 'SCREENING', notes: 'Fresh grad with strong GitHub portfolio. Shortlisted for phone screen.', createdAt: daysAgo(5), interviews: [] },
    { id: uuidv4(), jobId: fsId, firstName: 'Joel', lastName: 'Lim', email: 'joel.lim@email.com', phone: '+65 9505 0005', currentEmployer: 'Agency XYZ', currentTitle: 'Web Developer', noticePeriod: 30, expectedSalary: 7000, stage: 'APPLIED', notes: null, createdAt: daysAgo(3), interviews: [] }
  );

  // ── Senior DevOps Engineer (OPEN)
  const devopsId = jobMap['devops_sr'];
  all.push(
    { id: uuidv4(), jobId: devopsId, firstName: 'Samuel', lastName: 'Ho', email: 'samuel.ho@email.com', phone: '+65 9101 1001', currentEmployer: 'CloudBase Pte Ltd', currentTitle: 'DevOps Lead', noticePeriod: 60, expectedSalary: 10500, stage: 'INTERVIEW_2', notes: 'Strong AWS and Kubernetes background. On final round.', createdAt: daysAgo(18), interviews: [{ roundName: 'HR Screen', scheduledAt: daysAgo(16), result: 'PASS', notes: 'Good culture fit, realistic salary expectation.' }, { roundName: 'Technical Deep Dive', scheduledAt: daysAgo(10), result: 'PASS', notes: 'Excellent Terraform and k8s knowledge.' }, { roundName: 'CTO Interview', scheduledAt: daysAhead(2), result: 'PENDING', notes: null }] },
    { id: uuidv4(), jobId: devopsId, firstName: 'Harish', lastName: 'Pillai', email: 'harish.pillai@email.com', phone: '+65 9202 1002', currentEmployer: 'NetSol', currentTitle: 'Systems Engineer', noticePeriod: 30, expectedSalary: 9200, stage: 'INTERVIEW_1', notes: 'Good foundation but lacks Kubernetes depth. Proceed cautiously.', createdAt: daysAgo(14), interviews: [{ roundName: 'HR Screen', scheduledAt: daysAgo(12), result: 'PASS', notes: 'Motivated, willing to upskill.' }, { roundName: 'Technical Interview', scheduledAt: daysAhead(5), result: 'PENDING', notes: null }] },
    { id: uuidv4(), jobId: devopsId, firstName: 'Li Wei', lastName: 'Chen', email: 'liwei.chen@email.com', phone: '+65 9303 1003', currentEmployer: 'SG Tech', currentTitle: 'Senior SRE', noticePeriod: 60, expectedSalary: 12000, stage: 'REJECTED', notes: 'Salary expectation significantly above budget.', createdAt: daysAgo(19), interviews: [{ roundName: 'HR Screen', scheduledAt: daysAgo(17), result: 'FAIL', notes: 'Salary mismatch — expects $12K, budget up to $11K.' }] },
    { id: uuidv4(), jobId: devopsId, firstName: 'Natasha', lastName: 'Kuznetsova', email: 'natasha.k@email.com', phone: '+65 9404 1004', currentEmployer: 'FinServe', currentTitle: 'Platform Engineer', noticePeriod: 30, expectedSalary: 10000, stage: 'SCREENING', notes: 'Resume shortlisted. Scheduling phone screen.', createdAt: daysAgo(6), interviews: [] }
  );

  // ── HR Executive (OPEN)
  const hrExecId = jobMap['hr_exec'];
  all.push(
    { id: uuidv4(), jobId: hrExecId, firstName: 'Liyana', lastName: 'Binte Hamid', email: 'liyana.hamid@email.com', phone: '+65 9101 2001', currentEmployer: 'RetailCo', currentTitle: 'HR Coordinator', noticePeriod: 30, expectedSalary: 4200, stage: 'OFFER', notes: 'Excellent candidate. Offered $4,200. Verbal acceptance received.', createdAt: daysAgo(13), interviews: [{ roundName: 'Phone Screen', scheduledAt: daysAgo(11), result: 'PASS', notes: 'Warm personality, solid EA knowledge.' }, { roundName: 'Face-to-Face Interview', scheduledAt: daysAgo(6), result: 'PASS', notes: 'Rachel confirmed strong fit. Proceeding to offer.' }] },
    { id: uuidv4(), jobId: hrExecId, firstName: 'Grace', lastName: 'Teo', email: 'grace.teo@email.com', phone: '+65 9202 2002', currentEmployer: 'ManPower SG', currentTitle: 'Recruiter', noticePeriod: 14, expectedSalary: 4000, stage: 'INTERVIEW_1', notes: 'Recruiter background — assessing HR generalist adaptability.', createdAt: daysAgo(9), interviews: [{ roundName: 'Phone Screen', scheduledAt: daysAgo(7), result: 'PASS', notes: 'Strong communication, eager to transition to HR ops.' }, { roundName: 'Face-to-Face Interview', scheduledAt: daysAhead(2), result: 'PENDING', notes: null }] },
    { id: uuidv4(), jobId: hrExecId, firstName: 'Bernadette', lastName: 'Lim', email: 'bernadette.lim@email.com', phone: '+65 9303 2003', currentEmployer: null, currentTitle: null, noticePeriod: 0, expectedSalary: 3800, stage: 'APPLIED', notes: 'Fresh grad from SIM. Reviewing application.', createdAt: daysAgo(2), interviews: [] }
  );

  // ── Financial Analyst (OPEN)
  const finId = jobMap['fin_analyst'];
  all.push(
    { id: uuidv4(), jobId: finId, firstName: 'Aaron', lastName: 'Yeo', email: 'aaron.yeo@email.com', phone: '+65 9101 3001', currentEmployer: 'Big4 Audit', currentTitle: 'Senior Associate', noticePeriod: 60, expectedSalary: 6200, stage: 'INTERVIEW_2', notes: 'Big4 background. Strong modelling skills. Final round scheduled.', createdAt: daysAgo(10), interviews: [{ roundName: 'HR Screen', scheduledAt: daysAgo(8), result: 'PASS', notes: 'Professional, ACCA qualified.' }, { roundName: 'Technical Case Study', scheduledAt: daysAgo(4), result: 'PASS', notes: 'Presented a solid DCF model. David impressed.' }, { roundName: 'CFO Interview', scheduledAt: daysAhead(4), result: 'PENDING', notes: null }] },
    { id: uuidv4(), jobId: finId, firstName: 'Mei Ling', lastName: 'Tan', email: 'meiling.tan@email.com', phone: '+65 9202 3002', currentEmployer: 'CorpFin SG', currentTitle: 'Financial Analyst', noticePeriod: 30, expectedSalary: 5800, stage: 'SCREENING', notes: 'Resume reviewed. Relevant experience. Phone screen pending.', createdAt: daysAgo(4), interviews: [] },
    { id: uuidv4(), jobId: finId, firstName: 'Rajesh', lastName: 'Kumar', email: 'rajesh.kumar@email.com', phone: '+65 9303 3003', currentEmployer: 'InvestBank', currentTitle: 'Equity Analyst', noticePeriod: 60, expectedSalary: 8000, stage: 'REJECTED', notes: 'Strong analyst background but salary expectations exceed budget and role scope.', createdAt: daysAgo(9), interviews: [{ roundName: 'HR Screen', scheduledAt: daysAgo(7), result: 'FAIL', notes: 'Salary mismatch. Candidate declined to negotiate.' }] }
  );

  // ── Digital Marketing Specialist (OPEN)
  const mktId = jobMap['digital_mkt'];
  all.push(
    { id: uuidv4(), jobId: mktId, firstName: 'Charmaine', lastName: 'Ng', email: 'charmaine.ng@email.com', phone: '+65 9101 4001', currentEmployer: 'MediaWorks', currentTitle: 'Digital Marketing Executive', noticePeriod: 30, expectedSalary: 5500, stage: 'INTERVIEW_1', notes: 'Google certified, strong SEM background. First interview scheduled.', createdAt: daysAgo(8), interviews: [{ roundName: 'HR Screen', scheduledAt: daysAgo(6), result: 'PASS', notes: 'Articulate, data-driven approach.' }, { roundName: 'Portfolio Review', scheduledAt: daysAhead(3), result: 'PENDING', notes: null }] },
    { id: uuidv4(), jobId: mktId, firstName: 'Dylan', lastName: 'Seah', email: 'dylan.seah@email.com', phone: '+65 9202 4002', currentEmployer: 'BrandHub', currentTitle: 'Social Media Manager', noticePeriod: 14, expectedSalary: 4500, stage: 'SCREENING', notes: 'Strong social media track record. Lacks SEM experience.', createdAt: daysAgo(5), interviews: [] },
    { id: uuidv4(), jobId: mktId, firstName: 'Fiona', lastName: 'Low', email: 'fiona.low@email.com', phone: '+65 9303 4003', currentEmployer: null, currentTitle: null, noticePeriod: 0, expectedSalary: 4200, stage: 'APPLIED', notes: null, createdAt: daysAgo(2), interviews: [] }
  );

  // ── Intern Engineering (OPEN) — simple pipeline
  const internId = jobMap['intern_eng'];
  all.push(
    { id: uuidv4(), jobId: internId, firstName: 'Zachary', lastName: 'Tan', email: 'zachary.tan.nus@gmail.com', phone: '+65 9101 5001', currentEmployer: null, currentTitle: null, noticePeriod: 0, expectedSalary: 1600, stage: 'INTERVIEW_1', notes: 'NUS Year 3 CS. Strong Python. Available Jan 2026.', createdAt: daysAgo(7), interviews: [{ roundName: 'Technical Phone Screen', scheduledAt: daysAgo(5), result: 'PASS', notes: 'Good fundamentals, quick learner.' }, { roundName: 'Team Interview', scheduledAt: daysAhead(6), result: 'PENDING', notes: null }] },
    { id: uuidv4(), jobId: internId, firstName: 'Isabella', lastName: 'Koh', email: 'isabella.koh.ntu@gmail.com', phone: '+65 9202 5002', currentEmployer: null, currentTitle: null, noticePeriod: 0, expectedSalary: 1500, stage: 'APPLIED', notes: 'NTU Year 4. Specialisation in AI/ML.', createdAt: daysAgo(3), interviews: [] },
    { id: uuidv4(), jobId: internId, firstName: 'Reuben', lastName: 'Chew', email: 'reuben.chew@smu.edu.sg', phone: '+65 9303 5003', currentEmployer: null, currentTitle: null, noticePeriod: 0, expectedSalary: 1400, stage: 'SCREENING', notes: 'SMU IS student. Good hackathon experience.', createdAt: daysAgo(5), interviews: [] }
  );

  // ── Senior Sales Manager (FILLED) — one hired candidate
  const srSalesId = jobMap['sr_sales_mgr'];
  all.push(
    { id: uuidv4(), jobId: srSalesId, firstName: 'Vincent', lastName: 'Lau', email: 'vincent.lau@email.com', phone: '+65 9101 6001', currentEmployer: 'EnterpriseX', currentTitle: 'Sales Director', noticePeriod: 60, expectedSalary: 12000, stage: 'HIRED', isHired: true, notes: 'Joined on 15 Apr 2025. Excellent leadership profile.', createdAt: daysAgo(45), interviews: [{ roundName: 'HR Screen', scheduledAt: daysAgo(43), result: 'PASS', notes: 'Very strong background.' }, { roundName: 'Sales Case Presentation', scheduledAt: daysAgo(36), result: 'PASS', notes: 'Compelling GTM strategy presented.' }, { roundName: 'CEO Interview', scheduledAt: daysAgo(28), result: 'PASS', notes: 'Exceptional leadership. Approved.' }] },
    { id: uuidv4(), jobId: srSalesId, firstName: 'Patricia', lastName: 'Wee', email: 'patricia.wee@email.com', phone: '+65 9202 6002', currentEmployer: 'SalesPro', currentTitle: 'Regional Manager', noticePeriod: 30, expectedSalary: 11000, stage: 'REJECTED', notes: 'Good candidate but second to Vincent. Informed of decision.', createdAt: daysAgo(40), interviews: [{ roundName: 'HR Screen', scheduledAt: daysAgo(38), result: 'PASS', notes: null }, { roundName: 'Sales Case Presentation', scheduledAt: daysAgo(30), result: 'PASS', notes: 'Good but not as strategic as top candidate.' }, { roundName: 'CEO Interview', scheduledAt: daysAgo(22), result: 'FAIL', notes: 'Did not demonstrate leadership depth required.' }] }
  );

  return all;
}

// ── Seed Functions ─────────────────────────────────────────────────────────────

async function seedRecruitment() {
  const db = dbClient('hrms_recruitment');
  await db.connect();

  try {
    // ── Job Postings ──
    const jobMap = {};
    let jobCount = 0;
    for (const job of JOB_POSTINGS) {
      const exists = await db.query(`SELECT id FROM job_postings WHERE title = $1 AND department = $2 LIMIT 1`, [job.title, job.department]);
      if (exists.rows.length > 0) {
        jobMap[job.label] = exists.rows[0].id;
        continue;
      }
      await db.query(
        `INSERT INTO job_postings
          (id, title, department, headcount, "jobDescription", requirements,
           "salaryMin", "salaryMax", "jobType", location,
           "mcfJobId", "mcfPostedAt", "mcfExpiredAt", "fcfCompliant",
           status, "postedById", "createdAt", "updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17)`,
        [
          job.id, job.title, job.department, job.headcount, job.jobDescription, job.requirements,
          job.salaryMin, job.salaryMax, job.jobType, job.location,
          job.mcfJobId, job.mcfPostedAt, job.mcfExpiredAt, job.fcfCompliant,
          job.status, job.postedById, job.createdAt,
        ]
      );
      jobMap[job.label] = job.id;
      jobCount++;
    }
    console.log(`  ✅ ${jobCount} job postings seeded`);

    // ── Candidates + Interviews + Stage Events ──
    const candidates = buildCandidates(jobMap);
    let candCount = 0, ivCount = 0, stageCount = 0;

    for (const c of candidates) {
      const exists = await db.query(`SELECT id FROM candidates WHERE email = $1 LIMIT 1`, [c.email]);
      if (exists.rows.length > 0) continue;

      await db.query(
        `INSERT INTO candidates
          (id, "jobId", "firstName", "lastName", email, phone,
           "currentEmployer", "currentTitle", "noticePeriod", "expectedSalary",
           stage, "isOfferMade", "isHired", notes, "createdAt", "updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15)`,
        [
          c.id, c.jobId, c.firstName, c.lastName, c.email, c.phone || null,
          c.currentEmployer || null, c.currentTitle || null, c.noticePeriod ?? null, c.expectedSalary ?? null,
          c.stage,
          ['OFFER', 'HIRED'].includes(c.stage),
          c.isHired || false,
          c.notes || null,
          c.createdAt,
        ]
      );
      candCount++;

      // Stage event — APPLIED baseline
      const stageEventId = uuidv4();
      await db.query(
        `INSERT INTO candidate_stage_events (id, "candidateId", "fromStage", "toStage", note, "changedBy", "createdAt")
         VALUES ($1,$2,NULL,'APPLIED','Application received',NULL,$3)`,
        [stageEventId, c.id, c.createdAt]
      );
      stageCount++;

      // Additional stage event if not APPLIED
      if (c.stage !== 'APPLIED') {
        await db.query(
          `INSERT INTO candidate_stage_events (id, "candidateId", "fromStage", "toStage", note, "changedBy", "createdAt")
           VALUES ($1,$2,'APPLIED',$3,$4,$5,$6)`,
          [uuidv4(), c.id, c.stage,
           `Moved to ${c.stage.replace(/_/g, ' ')}`, HR_MGR_ID,
           new Date(c.createdAt.getTime() + 24 * 60 * 60 * 1000)]
        );
        stageCount++;
      }

      // Interview Rounds
      for (const iv of (c.interviews || [])) {
        await db.query(
          `INSERT INTO interview_rounds
            (id, "candidateId", "roundName", "scheduledAt", "interviewerIds", notes, result, "createdAt")
           VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
          [
            uuidv4(), c.id, iv.roundName, iv.scheduledAt,
            [ENG_MGR_ID, HR_MGR_ID],
            iv.notes || null,
            iv.result || 'PENDING',
          ]
        );
        ivCount++;
      }
    }
    console.log(`  ✅ ${candCount} candidates seeded`);
    console.log(`  ✅ ${ivCount} interview rounds seeded`);
    console.log(`  ✅ ${stageCount} stage events seeded`);

    // ── Onboarding Tasks — for existing employees (recently hired) ────────────
    const empDb = dbClient('hrms_employee');
    await empDb.connect();
    const { rows: recentEmps } = await empDb.query(
      `SELECT id, "fullName", "workEmail" FROM employees ORDER BY "startDate" DESC LIMIT 8`
    );
    await empDb.end();

    const TASK_TEMPLATES = [
      { taskName: 'Complete Personal Data Form', description: 'Submit signed personal data consent form to HR.' },
      { taskName: 'IT Equipment Setup', description: 'Collect laptop, access card, and set up corporate email account.' },
      { taskName: 'Sign Employment Contract', description: 'Review and sign the employment contract and NDA.' },
      { taskName: 'MAS e-Learning (Compliance)', description: 'Complete mandatory compliance e-learning modules on MAS portal.' },
      { taskName: 'Benefits Enrolment', description: 'Enrol in medical insurance and other company benefits.' },
      { taskName: 'Buddy Introduction', description: 'Meet assigned buddy for office tour and team introduction.' },
      { taskName: 'HR Induction Session', description: 'Attend HR induction covering company policies and procedures.' },
      { taskName: 'Role-specific Onboarding', description: 'Complete department-specific onboarding checklist with direct manager.' },
    ];

    let taskCount = 0;
    for (const emp of recentEmps) {
      const existing = await db.query(`SELECT COUNT(*) FROM onboarding_tasks WHERE "employeeId" = $1`, [emp.id]);
      if (parseInt(existing.rows[0].count) > 0) continue;

      for (let i = 0; i < TASK_TEMPLATES.length; i++) {
        const tmpl = TASK_TEMPLATES[i];
        const isDone = i < 4; // First 4 tasks completed
        await db.query(
          `INSERT INTO onboarding_tasks
            (id, "employeeId", "taskName", description, "assignedTo", "dueDate", "isDone", "completedAt", "createdAt")
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
          [
            uuidv4(), emp.id, tmpl.taskName, tmpl.description,
            HR_MGR_ID,
            daysAhead(7 - i),
            isDone,
            isDone ? daysAgo(Math.floor(Math.random() * 5) + 1) : null,
          ]
        );
        taskCount++;
      }
    }
    console.log(`  ✅ ${taskCount} onboarding tasks seeded (for ${recentEmps.length} employees)`);

    // ── Work Passes — for foreign employees ──────────────────────────────────
    const empDb2 = dbClient('hrms_employee');
    await empDb2.connect();
    const { rows: foreignEmps } = await empDb2.query(
      `SELECT id, "fullName", "passType", "passNumber", "passExpiryDate", "passIssuedDate"
       FROM employees WHERE "citizenshipStatus" = 'FOREIGNER' AND "passType" IS NOT NULL`
    );
    await empDb2.end();

    let wpCount = 0;
    for (const emp of foreignEmps) {
      const exists = await db.query(`SELECT id FROM work_passes WHERE "employeeId" = $1`, [emp.id]);
      if (exists.rows.length > 0) continue;
      await db.query(
        `INSERT INTO work_passes (id, "employeeId", "passType", "passNumber", "expiryDate", "issuedDate", status, "createdAt", "updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())`,
        [
          uuidv4(), emp.id,
          emp.passType, emp.passNumber,
          emp.passExpiryDate, emp.passIssuedDate,
          new Date(emp.passExpiryDate) < new Date() ? 'EXPIRED' : 'ACTIVE',
        ]
      );
      wpCount++;
    }
    console.log(`  ✅ ${wpCount} work pass records seeded`);

  } finally {
    await db.end();
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🌱 Recruitment Seed Script');
  console.log(`   Connecting to postgres at ${HOST}:${PORT}\n`);

  const checkDb = dbClient('hrms_recruitment');
  await checkDb.connect();
  const { rows } = await checkDb.query(`SELECT COUNT(*) FROM job_postings`);
  await checkDb.end();

  if (parseInt(rows[0].count) > 0) {
    console.log(`ℹ️  Recruitment data already exists (${rows[0].count} job postings) — skipping`);
    console.log('   To re-seed, truncate the tables first.\n');
    return;
  }

  await seedRecruitment();
  console.log('\n✅ Recruitment seed complete!\n');
}

main().catch(err => {
  console.error('\n❌ Seed failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
