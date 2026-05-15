'use strict';

const { PrismaClient } = require('@prisma/client');
const { v4: uuidv4 } = require('uuid');

const prisma = new PrismaClient();

const HR_USER_ID = 'd39e53b8-d00d-441b-b20c-3d2ea36940dc';

const jobs = [
  {
    id: uuidv4(),
    title: 'Senior Software Engineer',
    department: 'Engineering',
    headcount: 2,
    jobDescription: 'Design and build scalable backend services using Node.js and PostgreSQL. Lead technical discussions and mentor junior engineers.',
    requirements: '5+ years of backend experience, strong proficiency in Node.js, PostgreSQL, and Docker. Experience with microservices architecture.',
    salaryMin: 7000,
    salaryMax: 10000,
    jobType: 'FULL_TIME',
    location: 'Singapore (Hybrid)',
    mcfJobId: 'MCF-2024-001234',
    mcfPostedAt: new Date('2026-04-01'),
    mcfExpiredAt: new Date('2026-04-15'),
    fcfCompliant: true,
    status: 'OPEN',
    postedById: HR_USER_ID,
  },
  {
    id: uuidv4(),
    title: 'HR Business Partner',
    department: 'Human Resources',
    headcount: 1,
    jobDescription: 'Partner with business leaders to develop and implement HR strategies. Manage the full employee lifecycle including recruitment, onboarding, and performance reviews.',
    requirements: '4+ years of HR generalist experience. Strong knowledge of Singapore employment law and MOM regulations. IHRP certification preferred.',
    salaryMin: 6000,
    salaryMax: 8500,
    jobType: 'FULL_TIME',
    location: 'Singapore (On-site)',
    mcfJobId: 'MCF-2024-001235',
    mcfPostedAt: new Date('2026-04-05'),
    mcfExpiredAt: new Date('2026-04-19'),
    fcfCompliant: true,
    status: 'OPEN',
    postedById: HR_USER_ID,
  },
  {
    id: uuidv4(),
    title: 'Marketing Executive',
    department: 'Marketing',
    headcount: 1,
    jobDescription: 'Plan and execute digital marketing campaigns across SEA markets. Manage social media presence, content calendar, and performance reporting.',
    requirements: '2-3 years of digital marketing experience. Proficiency with Google Ads, Meta Business Suite, and analytics tools. Strong written English.',
    salaryMin: 3500,
    salaryMax: 5000,
    jobType: 'FULL_TIME',
    location: 'Singapore (Hybrid)',
    status: 'OPEN',
    fcfCompliant: false,
    postedById: HR_USER_ID,
  },
  {
    id: uuidv4(),
    title: 'Finance Analyst',
    department: 'Finance',
    headcount: 1,
    jobDescription: 'Support month-end closing, prepare financial statements, and conduct variance analysis. Assist with budgeting and forecasting cycles.',
    requirements: 'Degree in Accountancy or Finance. CPA/ACCA qualified or pursuing. 2+ years of financial analysis experience. Proficiency in Excel and SAP.',
    salaryMin: 4500,
    salaryMax: 6500,
    jobType: 'FULL_TIME',
    location: 'Singapore (On-site)',
    status: 'FILLED',
    fcfCompliant: true,
    mcfJobId: 'MCF-2024-001100',
    mcfPostedAt: new Date('2026-02-01'),
    mcfExpiredAt: new Date('2026-02-15'),
    postedById: HR_USER_ID,
  },
  {
    id: uuidv4(),
    title: 'DevOps Engineer',
    department: 'Engineering',
    headcount: 1,
    jobDescription: 'Own and improve our CI/CD pipelines, Kubernetes clusters, and cloud infrastructure on AWS. Drive SRE practices across engineering teams.',
    requirements: '3+ years in DevOps or SRE. Strong hands-on Kubernetes, Terraform, and AWS experience. Experience with monitoring stacks (Prometheus, Grafana).',
    salaryMin: 7500,
    salaryMax: 11000,
    jobType: 'FULL_TIME',
    location: 'Singapore (Hybrid)',
    status: 'OPEN',
    fcfCompliant: false,
    postedById: HR_USER_ID,
  },
  {
    id: uuidv4(),
    title: 'Operations Intern',
    department: 'Operations',
    headcount: 2,
    jobDescription: 'Support operations team with process documentation, data entry, vendor coordination, and ad-hoc project support.',
    requirements: 'Diploma or pursuing a degree in Business, Operations, or related field. Highly organised with strong attention to detail.',
    salaryMin: 1000,
    salaryMax: 1500,
    jobType: 'CONTRACT',
    location: 'Singapore (On-site)',
    status: 'OPEN',
    fcfCompliant: false,
    postedById: HR_USER_ID,
  },
];

const candidateTemplates = [
  // Senior Software Engineer candidates
  { firstName: 'Ethan', lastName: 'Chua', email: 'ethan.chua@gmail.com', phone: '+6591234001', currentEmployer: 'Grab', currentTitle: 'Backend Engineer', noticePeriod: 30, expectedSalary: 8500, stage: 'INTERVIEW_2', jobIndex: 0 },
  { firstName: 'Mei Ling', lastName: 'Yap', email: 'meiling.yap@yahoo.com', phone: '+6591234002', currentEmployer: 'Sea Group', currentTitle: 'Software Engineer', noticePeriod: 60, expectedSalary: 9000, stage: 'OFFER', jobIndex: 0 },
  { firstName: 'Ravi', lastName: 'Shankar', email: 'ravi.s@hotmail.com', phone: '+6591234003', currentEmployer: 'DBS Bank', currentTitle: 'Associate Engineer', noticePeriod: 30, expectedSalary: 7500, stage: 'SCREENING', jobIndex: 0 },
  { firstName: 'Zhang', lastName: 'Wei', email: 'zhangwei.dev@gmail.com', phone: '+6591234004', currentEmployer: 'Shopee', currentTitle: 'Senior Developer', noticePeriod: 45, expectedSalary: 10000, stage: 'REJECTED', jobIndex: 0 },
  { firstName: 'Aisha', lastName: 'Binte Rahman', email: 'aisha.rahman@outlook.com', phone: '+6591234005', currentEmployer: 'ST Engineering', currentTitle: 'Software Engineer II', noticePeriod: 30, expectedSalary: 7800, stage: 'APPLIED', jobIndex: 0 },

  // HR Business Partner candidates
  { firstName: 'Cheryl', lastName: 'Tan', email: 'cheryl.tan.hr@gmail.com', phone: '+6591234011', currentEmployer: 'Singtel', currentTitle: 'HR Generalist', noticePeriod: 30, expectedSalary: 7000, stage: 'INTERVIEW_1', jobIndex: 1 },
  { firstName: 'Farah', lastName: 'Binte Aziz', email: 'farah.aziz@yahoo.com.sg', phone: '+6591234012', currentEmployer: 'Changi Airport Group', currentTitle: 'HR Executive', noticePeriod: 60, expectedSalary: 6500, stage: 'SCREENING', jobIndex: 1 },
  { firstName: 'Lim', lastName: 'Jing Wen', email: 'limjingwen@gmail.com', phone: '+6591234013', currentEmployer: 'NTUC FairPrice', currentTitle: 'HRBP', noticePeriod: 30, expectedSalary: 8000, stage: 'APPLIED', jobIndex: 1 },

  // Marketing Executive candidates
  { firstName: 'Sophie', lastName: 'Koh', email: 'sophie.koh.mkt@gmail.com', phone: '+6591234021', currentEmployer: 'MediaCorp', currentTitle: 'Digital Marketing Exec', noticePeriod: 14, expectedSalary: 4500, stage: 'OFFER', jobIndex: 2 },
  { firstName: 'Bryan', lastName: 'Ng', email: 'bryan.ng.mkt@gmail.com', phone: '+6591234022', currentEmployer: 'Freelance', currentTitle: 'Content Creator', noticePeriod: 0, expectedSalary: 4000, stage: 'INTERVIEW_1', jobIndex: 2 },

  // Finance Analyst candidates (role filled)
  { firstName: 'Grace', lastName: 'Lee', email: 'grace.lee.fin@gmail.com', phone: '+6591234031', currentEmployer: 'KPMG', currentTitle: 'Audit Associate', noticePeriod: 30, expectedSalary: 5800, stage: 'HIRED', jobIndex: 3 },
  { firstName: 'Marcus', lastName: 'Teo', email: 'marcus.teo@outlook.com', phone: '+6591234032', currentEmployer: 'Deloitte', currentTitle: 'Financial Analyst', noticePeriod: 60, expectedSalary: 6000, stage: 'REJECTED', jobIndex: 3 },

  // DevOps Engineer candidates
  { firstName: 'Darren', lastName: 'Foo', email: 'darren.foo.devops@gmail.com', phone: '+6591234041', currentEmployer: 'AWS', currentTitle: 'Cloud Engineer', noticePeriod: 30, expectedSalary: 10500, stage: 'ASSESSMENT', jobIndex: 4 },
  { firstName: 'Nisha', lastName: 'Pillai', email: 'nisha.pillai.ops@gmail.com', phone: '+6591234042', currentEmployer: 'GovTech', currentTitle: 'Infrastructure Engineer', noticePeriod: 45, expectedSalary: 9000, stage: 'INTERVIEW_1', jobIndex: 4 },
  { firstName: 'Kevin', lastName: 'Ong', email: 'kevin.ong.devops@yahoo.com', phone: '+6591234043', currentEmployer: 'Accenture', currentTitle: 'DevOps Consultant', noticePeriod: 60, expectedSalary: 9500, stage: 'APPLIED', jobIndex: 4 },

  // Operations Intern candidates
  { firstName: 'Tiffany', lastName: 'Woo', email: 'tiffany.woo@nus.edu.sg', phone: '+6591234051', currentEmployer: null, currentTitle: 'Student', noticePeriod: 0, expectedSalary: 1200, stage: 'SCREENING', jobIndex: 5 },
  { firstName: 'Haziq', lastName: 'Bin Hamid', email: 'haziq.hamid@np.edu.sg', phone: '+6591234052', currentEmployer: null, currentTitle: 'Student', noticePeriod: 0, expectedSalary: 1100, stage: 'APPLIED', jobIndex: 5 },
];

async function main() {
  console.log('Seeding Recruitment data...\n');

  console.log('Creating job postings...');
  const createdJobs = [];
  for (const job of jobs) {
    const created = await prisma.jobPosting.upsert({
      where: { id: job.id },
      update: {},
      create: job,
    });
    createdJobs.push(created);
    console.log(`  ✓ [${created.status}] ${created.title} (${created.department})`);
  }

  console.log('\nCreating candidates...');
  for (const tmpl of candidateTemplates) {
    const job = createdJobs[tmpl.jobIndex];
    const { jobIndex, ...fields } = tmpl;
    await prisma.candidate.create({
      data: {
        id: uuidv4(),
        jobId: job.id,
        ...fields,
      },
    });
    console.log(`  ✓ ${fields.firstName} ${fields.lastName} → ${job.title} [${fields.stage}]`);
  }

  const jobCount = createdJobs.length;
  const candCount = candidateTemplates.length;
  console.log(`\nRecruitment seeding complete. ${jobCount} jobs, ${candCount} candidates.`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
