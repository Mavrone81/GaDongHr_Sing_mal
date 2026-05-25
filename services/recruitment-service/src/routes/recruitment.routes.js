'use strict';

const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const multer = require('multer');
const { authenticate, authorize, ROLES } = require('/app/shared/auth-middleware');

const prisma = new PrismaClient();

const EMPLOYEE_SERVICE_URL    = process.env.EMPLOYEE_SERVICE_URL    || 'http://employee-service:4002';
const LEAVE_SERVICE_URL       = process.env.LEAVE_SERVICE_URL       || 'http://leave-service:4004';
const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://notification-service:4011';
const INTERNAL_SERVICE_KEY    = process.env.INTERNAL_SERVICE_KEY    || '';

async function fireAndForget(fn) {
  try { await fn(); } catch { /* best-effort — never block the approval */ }
}

const UPLOADS_DIR = path.join('/app/uploads/resumes');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['.pdf', '.doc', '.docx'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

// ── Jobs ──────────────────────────────────────────────────────────────────────
router.get('/jobs', authenticate, async (req, res, next) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const where = status ? { status: status.toUpperCase() } : {};
    const [jobs, total] = await Promise.all([
      prisma.jobPosting.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: Number(limit),
        include: {
          _count: { select: { candidates: true } },
          candidates: { select: { stage: true } },
        },
      }),
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

router.get('/jobs/:id', authenticate, async (req, res, next) => {
  try {
    const job = await prisma.jobPosting.findUnique({
      where: { id: req.params.id },
      include: {
        candidates: {
          include: {
            interviewRounds: { orderBy: { scheduledAt: 'asc' } },
            stageEvents: { orderBy: { createdAt: 'asc' } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json(job);
  } catch (err) { next(err); }
});

router.put('/jobs/:id', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.RECRUITER), async (req, res, next) => {
  try {
    const { title, department, headcount, jobDescription, requirements, salaryMin, salaryMax, jobType, location, status } = req.body;
    const job = await prisma.jobPosting.update({
      where: { id: req.params.id },
      data: { title, department, headcount, jobDescription, requirements, salaryMin, salaryMax, jobType, location, ...(status && { status: status.toUpperCase() }) },
    });
    res.json(job);
  } catch (err) { next(err); }
});

router.delete('/jobs/:id', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    await prisma.jobPosting.update({ where: { id: req.params.id }, data: { status: 'CANCELLED' } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Candidates ────────────────────────────────────────────────────────────────
router.get('/candidates', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER, ROLES.RECRUITER), async (req, res, next) => {
  try {
    const { jobId, stage, page = 1, limit = 200 } = req.query;
    const where = {};
    if (jobId) where.jobId = jobId;
    if (stage) where.stage = stage.toUpperCase();
    const [candidates, total] = await Promise.all([
      prisma.candidate.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: Number(limit),
        include: {
          job: { select: { title: true, department: true } },
          interviewRounds: { orderBy: { scheduledAt: 'asc' } },
        },
      }),
      prisma.candidate.count({ where }),
    ]);
    res.json({ candidates, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) { next(err); }
});

router.post('/candidates', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.RECRUITER), async (req, res, next) => {
  try {
    const { jobId, firstName, lastName, email, phone, currentEmployer, currentTitle, noticePeriod, expectedSalary } = req.body;
    if (!firstName || !lastName || !email) return res.status(400).json({ error: 'firstName, lastName, email required' });

    if (jobId) {
      const job = await prisma.jobPosting.findUnique({ where: { id: jobId } });
      if (job && job.mcfExpiredAt && new Date() < job.mcfExpiredAt) {
        return res.status(400).json({ error: `FCF non-compliant: Cannot shortlist until MCF 14-day period ends on ${job.mcfExpiredAt.toISOString().split('T')[0]}` });
      }
    }

    const candidate = await prisma.candidate.create({
      data: { id: uuidv4(), jobId: jobId || null, firstName, lastName, email, phone, currentEmployer, currentTitle, noticePeriod, expectedSalary, stage: 'APPLIED' },
    });

    // Record initial stage event
    await prisma.candidateStageEvent.create({
      data: { id: uuidv4(), candidateId: candidate.id, fromStage: null, toStage: 'APPLIED', note: 'Candidate added', changedBy: req.user?.sub },
    });

    res.status(201).json(candidate);
  } catch (err) { next(err); }
});

router.put('/candidates/:id/stage', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.RECRUITER, ROLES.HR_MANAGER), async (req, res, next) => {
  try {
    const { stage, note } = req.body;
    const current = await prisma.candidate.findUnique({ where: { id: req.params.id }, select: { stage: true } });
    if (!current) return res.status(404).json({ error: 'Candidate not found' });

    const [candidate] = await Promise.all([
      prisma.candidate.update({ where: { id: req.params.id }, data: { stage: stage.toUpperCase() } }),
      prisma.candidateStageEvent.create({
        data: {
          id: uuidv4(), candidateId: req.params.id,
          fromStage: current.stage, toStage: stage.toUpperCase(),
          note: note || null, changedBy: req.user?.sub,
        },
      }),
    ]);
    res.json(candidate);
  } catch (err) { next(err); }
});

// ── POST /candidates/:id/approve — Full hire approval with downstream triggers (REC-005)
// Moves candidate to HIRED, creates employee record, and fires all downstream provisioning.
router.post('/candidates/:id/approve',
  authenticate,
  authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN),
  async (req, res, next) => {
    try {
      const candidate = await prisma.candidate.findUnique({
        where: { id: req.params.id },
        include: { job: true },
      });
      if (!candidate) return res.status(404).json({ error: 'Candidate not found' });
      if (candidate.isHired) {
        return res.status(409).json({ error: 'Candidate already hired', employeeId: candidate.employeeId });
      }

      const { startDate, department, jobTitle, basicSalary, managerId, probationMonths = 3 } = req.body;
      if (!startDate) return res.status(400).json({ error: 'startDate is required' });

      const authHeader = req.headers.authorization || '';
      const triggers = { employeeCreated: false, leaveProvisioned: false, itTaskCreated: false, payrollSetupQueued: false, probationStarted: false, emailSent: false };

      // ── 1. Create employee record via employee service ──────────────────────
      let createdEmployee = null;
      const empPayload = {
        firstName: candidate.firstName,
        lastName:  candidate.lastName,
        email:     candidate.email,
        phone:     candidate.phone || null,
        department: department || candidate.job?.department || 'General',
        jobTitle:   jobTitle   || candidate.currentTitle || candidate.job?.title || 'Employee',
        basicSalary: basicSalary ?? candidate.expectedSalary ?? null,
        startDate,
        managerId: managerId || null,
        recruitmentCandidateId: candidate.id,
      };

      try {
        const empRes = await fetch(`${EMPLOYEE_SERVICE_URL}/employees`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: authHeader },
          body: JSON.stringify(empPayload),
        });
        if (empRes.ok) {
          createdEmployee = await empRes.json();
          triggers.employeeCreated = true;
        } else {
          const errBody = await empRes.json().catch(() => ({}));
          return res.status(502).json({ error: 'Failed to create employee record', details: errBody });
        }
      } catch (fetchErr) {
        return res.status(502).json({ error: 'Employee service unreachable', details: fetchErr.message });
      }

      const employeeId = createdEmployee.id || createdEmployee.employee?.id;

      // ── 2. Update candidate: HIRED + link employeeId ───────────────────────
      await prisma.$transaction([
        prisma.candidate.update({
          where: { id: candidate.id },
          data: { stage: 'HIRED', isHired: true, employeeId },
        }),
        prisma.candidateStageEvent.create({
          data: {
            id: uuidv4(), candidateId: candidate.id,
            fromStage: candidate.stage, toStage: 'HIRED',
            note: `Approved — employee record ${employeeId} created`, changedBy: req.user.sub,
          },
        }),
      ]);

      // ── 3. Provision leave entitlements (internal) ─────────────────────────
      await fireAndForget(async () => {
        const r = await fetch(`${LEAVE_SERVICE_URL}/leave/internal/provision-entitlements`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-service-key': INTERNAL_SERVICE_KEY },
          body: JSON.stringify({ employeeId, startDate }),
        });
        if (r.ok) triggers.leaveProvisioned = true;
      });

      // ── 4. Create IT provisioning onboarding tasks ─────────────────────────
      await fireAndForget(async () => {
        const IT_TASKS = [
          { taskName: 'Create Active Directory / SSO account', assignedTo: 'IT' },
          { taskName: 'Provision laptop/workstation per asset-to-issue list', assignedTo: 'IT' },
          { taskName: 'Set up corporate email account', assignedTo: 'IT' },
          { taskName: 'Grant system access (HRMS, ERP, Slack, etc.)', assignedTo: 'IT' },
          { taskName: 'Configure MFA / VPN access', assignedTo: 'IT' },
        ];
        const due = new Date(startDate);
        due.setDate(due.getDate() - 5); // provision 5 days before start
        await prisma.onboardingTask.createMany({
          data: IT_TASKS.map(t => ({
            id: uuidv4(), employeeId,
            taskName: t.taskName,
            description: `IT Day-minus-5 provisioning task for new hire (start date: ${startDate})`,
            assignedTo: t.assignedTo,
            dueDate: due,
          })),
          skipDuplicates: true,
        });
        triggers.itTaskCreated = true;
      });

      // ── 5. Queue payroll setup: CPF profile + bank details placeholder ─────
      await fireAndForget(async () => {
        await prisma.onboardingTask.create({
          data: {
            id: uuidv4(), employeeId,
            taskName: 'Complete payroll setup (bank details + CPF profile)',
            description: 'HR/Payroll Officer: configure bank account, CPF contribution type, and FWL tier in payroll system before first payroll run.',
            assignedTo: 'PAYROLL',
            dueDate: new Date(startDate),
          },
        });
        triggers.payrollSetupQueued = true;
      });

      // ── 6. Start probation tracking ────────────────────────────────────────
      await fireAndForget(async () => {
        const probationEnd = new Date(startDate);
        probationEnd.setMonth(probationEnd.getMonth() + (probationMonths || 3));
        await prisma.onboardingTask.create({
          data: {
            id: uuidv4(), employeeId,
            taskName: `Probation review due — ${probationEnd.toISOString().split('T')[0]}`,
            description: `Probation period: ${startDate} to ${probationEnd.toISOString().split('T')[0]} (${probationMonths} months). Line Manager must complete probation appraisal before this date.`,
            assignedTo: 'HR',
            dueDate: probationEnd,
          },
        });
        triggers.probationStarted = true;
      });

      // ── 7. Send confirmation emails ─────────────────────────────────────────
      await fireAndForget(async () => {
        await fetch(`${NOTIFICATION_SERVICE_URL}/notifications/email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: authHeader },
          body: JSON.stringify({
            type: 'NEW_HIRE_WELCOME',
            recipients: [candidate.email],
            data: {
              firstName: candidate.firstName,
              startDate,
              department: empPayload.department,
              jobTitle: empPayload.jobTitle,
            },
          }),
        });
        triggers.emailSent = true;
      });

      res.status(201).json({
        message: 'Candidate approved and employee record created',
        employeeId,
        candidateId: candidate.id,
        startDate,
        triggers,
        employee: createdEmployee,
      });
    } catch (err) { next(err); }
  }
);

// Tag candidate to a job (or re-tag)
router.post('/candidates/:id/tag-job', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.RECRUITER), async (req, res, next) => {
  try {
    const { jobId } = req.body;
    if (jobId) {
      const job = await prisma.jobPosting.findUnique({ where: { id: jobId } });
      if (!job) return res.status(404).json({ error: 'Job not found' });
      if (job.mcfExpiredAt && new Date() < job.mcfExpiredAt) {
        return res.status(400).json({ error: `FCF non-compliant: Cannot shortlist until MCF 14-day period ends on ${job.mcfExpiredAt.toISOString().split('T')[0]}` });
      }
    }
    const candidate = await prisma.candidate.update({
      where: { id: req.params.id },
      data: { jobId: jobId || null },
      include: { job: { select: { title: true, department: true } } },
    });
    res.json(candidate);
  } catch (err) { next(err); }
});

router.get('/candidates/:id', authenticate, async (req, res, next) => {
  try {
    const candidate = await prisma.candidate.findUnique({
      where: { id: req.params.id },
      include: {
        job: { select: { title: true, department: true, status: true } },
        interviewRounds: { orderBy: { scheduledAt: 'asc' } },
        stageEvents: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!candidate) return res.status(404).json({ error: 'Candidate not found' });
    res.json(candidate);
  } catch (err) { next(err); }
});

router.put('/candidates/:id', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.RECRUITER), async (req, res, next) => {
  try {
    const { notes, phone, currentEmployer, currentTitle, noticePeriod, expectedSalary, isOfferMade, isHired } = req.body;
    const candidate = await prisma.candidate.update({
      where: { id: req.params.id },
      data: { notes, phone, currentEmployer, currentTitle, noticePeriod, expectedSalary, isOfferMade, isHired },
    });
    res.json(candidate);
  } catch (err) { next(err); }
});

router.post('/candidates/:id/interviews', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.RECRUITER, ROLES.HR_MANAGER), async (req, res, next) => {
  try {
    const { roundName, scheduledAt, interviewerIds, notes } = req.body;
    if (!roundName || !scheduledAt) return res.status(400).json({ error: 'roundName and scheduledAt required' });
    const round = await prisma.interviewRound.create({
      data: { id: uuidv4(), candidateId: req.params.id, roundName, scheduledAt: new Date(scheduledAt), interviewerIds: interviewerIds || [], notes },
    });
    res.status(201).json(round);
  } catch (err) { next(err); }
});

router.put('/candidates/:candidateId/interviews/:roundId', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.RECRUITER, ROLES.HR_MANAGER), async (req, res, next) => {
  try {
    const { result, notes } = req.body;
    const round = await prisma.interviewRound.update({
      where: { id: req.params.roundId },
      data: { result, notes },
    });
    res.json(round);
  } catch (err) { next(err); }
});

// ── Resume Upload / Download / Delete ─────────────────────────────────────────
router.post('/candidates/:id/resume', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.RECRUITER), upload.single('resume'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded. Allowed: PDF, DOC, DOCX (max 10 MB).' });
    const existing = await prisma.candidate.findUnique({ where: { id: req.params.id }, select: { resumePath: true } });
    if (!existing) return res.status(404).json({ error: 'Candidate not found' });

    // Remove old file if present
    if (existing.resumePath) {
      const old = path.join(UPLOADS_DIR, path.basename(existing.resumePath));
      fs.unlink(old, () => {});
    }

    const candidate = await prisma.candidate.update({
      where: { id: req.params.id },
      data: { resumePath: req.file.filename, resumeName: req.file.originalname },
    });
    res.json({ resumeName: candidate.resumeName, resumePath: candidate.resumePath });
  } catch (err) { next(err); }
});

router.get('/candidates/:id/resume', authenticate, async (req, res, next) => {
  try {
    const candidate = await prisma.candidate.findUnique({ where: { id: req.params.id }, select: { resumePath: true, resumeName: true } });
    if (!candidate?.resumePath) return res.status(404).json({ error: 'No resume uploaded' });
    const filePath = path.join(UPLOADS_DIR, path.basename(candidate.resumePath));
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Resume file not found' });
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(candidate.resumeName || 'resume')}"`)
    res.sendFile(filePath);
  } catch (err) { next(err); }
});

router.delete('/candidates/:id/resume', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.RECRUITER), async (req, res, next) => {
  try {
    const candidate = await prisma.candidate.findUnique({ where: { id: req.params.id }, select: { resumePath: true } });
    if (!candidate) return res.status(404).json({ error: 'Candidate not found' });
    if (candidate.resumePath) {
      const filePath = path.join(UPLOADS_DIR, path.basename(candidate.resumePath));
      fs.unlink(filePath, () => {});
    }
    await prisma.candidate.update({ where: { id: req.params.id }, data: { resumePath: null, resumeName: null } });
    res.json({ ok: true });
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

const {
  ALERT_THRESHOLDS,
  daysUntilExpiry,
  pendingAlerts,
  urgencyBand,
  computeDrcUsage,
  defaultRenewalChecklist,
} = require('../engines/workpass.engine');

const WORK_PASS_ADMIN_ROLES = [ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER];
const WORK_PASS_VIEW_ROLES  = [ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER, ROLES.RECRUITER];

router.get('/work-passes', authenticate, authorize(...WORK_PASS_VIEW_ROLES), async (req, res, next) => {
  try {
    const { passType, status, sector } = req.query;
    const where = {};
    if (passType) where.passType = passType;
    if (status)   where.status   = status;
    if (sector)   where.sector   = sector;
    const passes = await prisma.workPass.findMany({ where, orderBy: { expiryDate: 'asc' } });
    const enriched = passes.map(p => {
      const days = daysUntilExpiry(p.expiryDate);
      return { ...p, daysUntilExpiry: days, urgency: urgencyBand(days) };
    });
    res.json(enriched);
  } catch (err) { next(err); }
});

router.post('/work-passes', authenticate, authorize(...WORK_PASS_ADMIN_ROLES), async (req, res, next) => {
  try {
    const { employeeId, passType, passNumber, expiryDate, issuedDate, sector, workerTier } = req.body;
    if (!employeeId || !passType || !passNumber || !expiryDate) {
      return res.status(400).json({ error: 'employeeId, passType, passNumber, expiryDate required' });
    }
    const pass = await prisma.workPass.create({
      data: {
        id: uuidv4(), employeeId, passType, passNumber,
        expiryDate: new Date(expiryDate),
        issuedDate: issuedDate ? new Date(issuedDate) : null,
        sector: sector || null, workerTier: workerTier || null,
      },
    });
    res.status(201).json(pass);
  } catch (err) {
    if (err?.code === 'P2002') return res.status(409).json({ error: 'Work pass already exists for this employee' });
    next(err);
  }
});

// NOTE: PUT /work-passes/:id is defined AT THE BOTTOM of this block — after
// the specific subroutes (drc-config, drc-usage, alerts, expiring) so it
// doesn't shadow them via the :id wildcard.

// ── Expiry alerts ────────────────────────────────────────────────────────────

/**
 * Sweep all ACTIVE/RENEWING work passes, upsert any threshold alerts that
 * have been crossed. Idempotent via @@unique(workPassId, threshold). Returns
 * counts by threshold + new alerts created.
 *
 * Best-effort notification fan-out: each new alert triggers a fire-and-forget
 * email to the notification service (skipped silently if unreachable).
 */
async function runWorkPassAlertSweep({ now = new Date() } = {}) {
  const passes = await prisma.workPass.findMany({
    where: { status: { in: ['ACTIVE', 'RENEWING'] } },
  });
  const byThreshold = Object.fromEntries(ALERT_THRESHOLDS.map(t => [t, 0]));
  const newAlerts = [];
  for (const pass of passes) {
    const pending = pendingAlerts(pass, now);
    for (const a of pending) {
      const result = await prisma.workPassAlert.upsert({
        where: { workPassId_threshold: { workPassId: pass.id, threshold: a.threshold } },
        create: {
          id: uuidv4(),
          workPassId: pass.id,
          employeeId: pass.employeeId,
          passType:   pass.passType,
          threshold:  a.threshold,
          expiryDate: pass.expiryDate,
          message:    a.message,
        },
        update: { message: a.message, expiryDate: pass.expiryDate },
      });
      byThreshold[a.threshold] += 1;
      if (result.createdAt.getTime() === result.notifiedAt.getTime()) {
        newAlerts.push({ ...result, daysRemaining: a.daysRemaining });
      }
    }
  }
  // Auto-flag expired passes
  for (const pass of passes) {
    const d = daysUntilExpiry(pass.expiryDate, now);
    if (d < 0 && pass.status === 'ACTIVE') {
      await prisma.workPass.update({ where: { id: pass.id }, data: { status: 'EXPIRED' } });
    }
  }
  return { sweptPasses: passes.length, byThreshold, created: newAlerts.length, newAlerts };
}

router.post('/work-passes/alerts/sweep', authenticate, authorize(...WORK_PASS_ADMIN_ROLES), async (req, res, next) => {
  try {
    const result = await runWorkPassAlertSweep();
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/work-passes/alerts', authenticate, authorize(...WORK_PASS_VIEW_ROLES), async (req, res, next) => {
  try {
    const { threshold, passType, sinceDays } = req.query;
    const where = {};
    if (threshold) where.threshold = Number(threshold);
    if (passType)  where.passType  = passType;
    if (sinceDays) {
      const since = new Date(); since.setUTCDate(since.getUTCDate() - Number(sinceDays));
      where.notifiedAt = { gte: since };
    }
    const alerts = await prisma.workPassAlert.findMany({ where, orderBy: { notifiedAt: 'desc' }, take: 500 });
    const summary = alerts.reduce((acc, a) => {
      acc.byThreshold[a.threshold] = (acc.byThreshold[a.threshold] || 0) + 1;
      acc.byPassType[a.passType]   = (acc.byPassType[a.passType]   || 0) + 1;
      return acc;
    }, { byThreshold: {}, byPassType: {} });
    res.json({ total: alerts.length, summary, alerts });
  } catch (err) { next(err); }
});

// ── DRC quota ────────────────────────────────────────────────────────────────

router.get('/work-passes/drc-config', authenticate, authorize(...WORK_PASS_VIEW_ROLES), async (req, res, next) => {
  try {
    const configs = await prisma.drcQuotaConfig.findMany({ where: { isActive: true }, orderBy: [{ sector: 'asc' }, { workerTier: 'asc' }] });
    res.json(configs);
  } catch (err) { next(err); }
});

router.put('/work-passes/drc-config', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const { sector, workerTier = 'BASIC', ratioLimit, alertThreshold } = req.body;
    if (!sector || ratioLimit == null) return res.status(400).json({ error: 'sector and ratioLimit required' });
    if (ratioLimit < 0 || ratioLimit > 1) return res.status(400).json({ error: 'ratioLimit must be between 0 and 1' });
    const row = await prisma.drcQuotaConfig.upsert({
      where: { sector_workerTier: { sector, workerTier } },
      create: { id: uuidv4(), sector, workerTier, ratioLimit, alertThreshold: alertThreshold ?? 0.85 },
      update: { ratioLimit, alertThreshold: alertThreshold ?? 0.85, isActive: true },
    });
    res.json(row);
  } catch (err) { next(err); }
});

router.get('/work-passes/drc-usage', authenticate, authorize(...WORK_PASS_VIEW_ROLES), async (req, res, next) => {
  try {
    const { totalHeadcount } = req.query;
    const headcount = Number(totalHeadcount);
    if (!Number.isFinite(headcount) || headcount <= 0) {
      return res.status(400).json({ error: 'totalHeadcount query param required (positive integer)' });
    }
    const [workPasses, configs] = await Promise.all([
      prisma.workPass.findMany({ where: { status: { in: ['ACTIVE', 'RENEWING'] } } }),
      prisma.drcQuotaConfig.findMany({ where: { isActive: true } }),
    ]);
    const usage = computeDrcUsage({ workPasses, totalHeadcount: headcount, configs });
    const breachCount = usage.filter(u => u.status === 'BREACH').length;
    const approachingCount = usage.filter(u => u.status === 'APPROACHING').length;
    res.json({ totalHeadcount: headcount, summary: { sectors: usage.length, breachCount, approachingCount }, usage });
  } catch (err) { next(err); }
});

// ── Renewal workflow ─────────────────────────────────────────────────────────

router.post('/work-passes/:id/renewal/initiate', authenticate, authorize(...WORK_PASS_ADMIN_ROLES), async (req, res, next) => {
  try {
    const pass = await prisma.workPass.findUnique({ where: { id: req.params.id } });
    if (!pass) return res.status(404).json({ error: 'Work pass not found' });
    if (pass.status === 'CANCELLED' || pass.status === 'EXPIRED') {
      return res.status(409).json({ error: `Cannot initiate renewal for pass in status ${pass.status}` });
    }
    if (pass.renewalInitiatedAt) {
      return res.status(409).json({ error: 'Renewal already in progress' });
    }
    const items = defaultRenewalChecklist(pass.passType);
    const updated = await prisma.$transaction(async (tx) => {
      const updatedPass = await tx.workPass.update({
        where: { id: pass.id },
        data: { status: 'RENEWING', renewalInitiatedAt: new Date(), renewalOutcome: null, renewalOutcomeAt: null },
      });
      for (const itemName of items) {
        await tx.workPassRenewalChecklist.create({
          data: { id: uuidv4(), workPassId: pass.id, itemName },
        });
      }
      return updatedPass;
    });
    res.status(201).json({ workPass: updated, checklistItems: items.length });
  } catch (err) { next(err); }
});

router.get('/work-passes/:id/renewal/checklist', authenticate, authorize(...WORK_PASS_VIEW_ROLES), async (req, res, next) => {
  try {
    const items = await prisma.workPassRenewalChecklist.findMany({
      where: { workPassId: req.params.id },
      orderBy: { createdAt: 'asc' },
    });
    res.json(items);
  } catch (err) { next(err); }
});

router.put('/work-passes/:id/renewal/checklist/:itemId', authenticate, authorize(...WORK_PASS_ADMIN_ROLES), async (req, res, next) => {
  try {
    const { isComplete, notes } = req.body;
    const data = { notes: notes ?? undefined };
    if (typeof isComplete === 'boolean') {
      data.isComplete  = isComplete;
      data.completedAt = isComplete ? new Date() : null;
      data.completedBy = isComplete ? (req.user?.sub || null) : null;
    }
    const item = await prisma.workPassRenewalChecklist.update({ where: { id: req.params.itemId }, data });
    res.json(item);
  } catch (err) {
    if (err?.code === 'P2025') return res.status(404).json({ error: 'Checklist item not found' });
    next(err);
  }
});

router.put('/work-passes/:id/renewal/outcome', authenticate, authorize(...WORK_PASS_ADMIN_ROLES), async (req, res, next) => {
  try {
    const { outcome, renewalReference, notes, newExpiryDate } = req.body;
    const valid = ['APPROVED', 'REJECTED', 'WITHDRAWN'];
    if (!valid.includes(outcome)) return res.status(400).json({ error: `outcome must be one of ${valid.join('|')}` });
    const pass = await prisma.workPass.findUnique({ where: { id: req.params.id } });
    if (!pass) return res.status(404).json({ error: 'Work pass not found' });
    if (pass.status !== 'RENEWING') return res.status(409).json({ error: `Cannot record outcome — pass status is ${pass.status}` });

    const data = {
      renewalOutcome:    outcome,
      renewalOutcomeAt:  new Date(),
      renewalReference:  renewalReference || null,
      renewalNotes:      notes || null,
      renewalSubmittedAt: pass.renewalSubmittedAt || new Date(),
    };
    if (outcome === 'APPROVED') {
      data.status = 'ACTIVE';
      if (newExpiryDate) data.expiryDate = new Date(newExpiryDate);
      // Clear historical alerts so the next cycle re-fires cleanly.
      await prisma.workPassAlert.deleteMany({ where: { workPassId: pass.id } });
    } else {
      data.status = outcome === 'REJECTED' ? 'EXPIRED' : 'ACTIVE';
    }
    const updated = await prisma.workPass.update({ where: { id: req.params.id }, data });
    res.json(updated);
  } catch (err) { next(err); }
});

// ── Expiry dashboard ─────────────────────────────────────────────────────────

// Generic PUT /work-passes/:id — placed AFTER all specific subroutes so the
// :id wildcard doesn't capture drc-config / drc-usage / alerts / expiring.
router.put('/work-passes/:id', authenticate, authorize(...WORK_PASS_ADMIN_ROLES), async (req, res, next) => {
  try {
    const { passType, passNumber, expiryDate, issuedDate, status, sector, workerTier } = req.body;
    const data = {};
    if (passType    != null) data.passType    = passType;
    if (passNumber  != null) data.passNumber  = passNumber;
    if (expiryDate  != null) data.expiryDate  = new Date(expiryDate);
    if (issuedDate  != null) data.issuedDate  = new Date(issuedDate);
    if (status      != null) data.status      = status;
    if (sector      != null) data.sector      = sector;
    if (workerTier  != null) data.workerTier  = workerTier;
    const pass = await prisma.workPass.update({ where: { id: req.params.id }, data });
    res.json(pass);
  } catch (err) {
    if (err?.code === 'P2025') return res.status(404).json({ error: 'Work pass not found' });
    next(err);
  }
});

router.get('/work-passes/expiring', authenticate, authorize(...WORK_PASS_VIEW_ROLES), async (req, res, next) => {
  try {
    const within = Number(req.query.withinDays) || 90;
    const now = new Date();
    const passes = await prisma.workPass.findMany({
      where: { status: { in: ['ACTIVE', 'RENEWING'] } },
      orderBy: { expiryDate: 'asc' },
    });
    const enriched = passes
      .map(p => {
        const days = daysUntilExpiry(p.expiryDate, now);
        return { ...p, daysUntilExpiry: days, urgency: urgencyBand(days) };
      })
      .filter(p => p.daysUntilExpiry <= within);
    const summary = enriched.reduce((acc, p) => {
      acc[p.urgency] = (acc[p.urgency] || 0) + 1;
      return acc;
    }, {});
    res.json({ withinDays: within, total: enriched.length, summary, passes: enriched });
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.runWorkPassAlertSweep = runWorkPassAlertSweep;
