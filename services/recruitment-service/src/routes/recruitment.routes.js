'use strict';

const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize, ROLES } = require('/app/shared/auth-middleware');

const prisma = new PrismaClient();

// ── Jobs ──────────────────────────────────────────────────────────────────────
router.get('/jobs', authenticate, async (req, res, next) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const where = status ? { status: status.toUpperCase() } : {};
    const [jobs, total] = await Promise.all([
      prisma.jobPosting.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: Number(limit), include: { _count: { select: { candidates: true } } } }),
      prisma.jobPosting.count({ where }),
    ]);
    res.json({ jobs, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) { next(err); }
});

router.post('/jobs', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.RECRUITER), async (req, res, next) => {
  try {
    const { title, department, headcount, jobDescription, requirements, salaryMin, salaryMax, jobType, location } = req.body;
    if (!title || !department || !jobDescription) return res.status(400).json({ error: 'title, department, jobDescription required' });
    const job = await prisma.jobPosting.create({
      data: { id: uuidv4(), title, department, headcount: headcount || 1, jobDescription, requirements, salaryMin, salaryMax, jobType: jobType || 'FULL_TIME', location, status: 'DRAFT', postedById: req.user.sub },
    });
    res.status(201).json(job);
  } catch (err) { next(err); }
});

// FCF Compliance: confirm MyCareersFuture 14-day advertisement
router.post('/jobs/:id/fcf-compliance', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.RECRUITER), async (req, res, next) => {
  try {
    const { mcfJobId, mcfPostedAt } = req.body;
    const postedDate = new Date(mcfPostedAt);
    const expiry = new Date(postedDate);
    expiry.setDate(expiry.getDate() + 14);

    const job = await prisma.jobPosting.update({
      where: { id: req.params.id },
      data: { mcfJobId, mcfPostedAt: postedDate, mcfExpiredAt: expiry, fcfCompliant: false, status: 'OPEN' },
    });
    res.json({ message: 'MCF posting recorded. FCF 14-day period ends on: ' + expiry.toISOString().split('T')[0], job });
  } catch (err) { next(err); }
});

// ── Candidates ────────────────────────────────────────────────────────────────
router.get('/candidates', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER, ROLES.RECRUITER), async (req, res, next) => {
  try {
    const { jobId, stage, page = 1, limit = 20 } = req.query;
    const where = {};
    if (jobId) where.jobId = jobId;
    if (stage) where.stage = stage.toUpperCase();
    const [candidates, total] = await Promise.all([
      prisma.candidate.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: Number(limit), include: { job: { select: { title: true } } } }),
      prisma.candidate.count({ where }),
    ]);
    res.json({ candidates, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) { next(err); }
});

router.post('/candidates', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.RECRUITER), async (req, res, next) => {
  try {
    const { jobId, firstName, lastName, email, phone, currentEmployer, currentTitle, noticePeriod, expectedSalary } = req.body;
    if (!jobId || !firstName || !lastName || !email) return res.status(400).json({ error: 'jobId, firstName, lastName, email required' });

    // FCF check: cannot move candidates before 14-day MCF window
    const job = await prisma.jobPosting.findUnique({ where: { id: jobId } });
    if (job && job.mcfExpiredAt && new Date() < job.mcfExpiredAt) {
      return res.status(400).json({ error: `FCF non-compliant: Cannot shortlist until MCF 14-day period ends on ${job.mcfExpiredAt.toISOString().split('T')[0]}` });
    }

    const candidate = await prisma.candidate.create({
      data: { id: uuidv4(), jobId, firstName, lastName, email, phone, currentEmployer, currentTitle, noticePeriod, expectedSalary, stage: 'APPLIED' },
    });
    res.status(201).json(candidate);
  } catch (err) { next(err); }
});

router.put('/candidates/:id/stage', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.RECRUITER, ROLES.HR_MANAGER), async (req, res, next) => {
  try {
    const { stage } = req.body;
    const candidate = await prisma.candidate.update({ where: { id: req.params.id }, data: { stage: stage.toUpperCase() } });
    res.json(candidate);
  } catch (err) { next(err); }
});

// ── Onboarding Tasks ──────────────────────────────────────────────────────────
router.post('/onboarding/:employeeId/start', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const defaultTasks = [
      'Sign employment contract', 'Submit NRIC/FIN copy', 'Complete personal particulars form',
      'Bank account details submission', 'IT equipment provisioning', 'Email account setup',
      'Building access card', 'Safety & security briefing', 'Company policy acknowledgement',
      'Meet reporting manager', 'System access provisioned',
    ];
    const tasks = await prisma.onboardingTask.createMany({
      data: defaultTasks.map(taskName => ({ id: uuidv4(), employeeId: req.params.employeeId, taskName, dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) })),
      skipDuplicates: true,
    });
    res.status(201).json({ message: 'Onboarding tasks created', count: tasks.count });
  } catch (err) { next(err); }
});

router.get('/onboarding/:employeeId', authenticate, async (req, res, next) => {
  try {
    const tasks = await prisma.onboardingTask.findMany({ where: { employeeId: req.params.employeeId }, orderBy: { createdAt: 'asc' } });
    res.json(tasks);
  } catch (err) { next(err); }
});

router.put('/onboarding/:employeeId/tasks/:taskId', authenticate, async (req, res, next) => {
  try {
    const task = await prisma.onboardingTask.update({ where: { id: req.params.taskId }, data: { isDone: true, completedAt: new Date() } });
    res.json(task);
  } catch (err) { next(err); }
});

// ── Work Passes ────────────────────────────────────────────────────────────────
router.get('/work-passes', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const passes = await prisma.workPass.findMany({ orderBy: { expiryDate: 'asc' } });
    res.json(passes);
  } catch (err) { next(err); }
});

module.exports = router;
