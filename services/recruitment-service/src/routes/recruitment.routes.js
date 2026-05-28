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
    const { mcfJobId, mcfPostedAt, fcfNotes } = req.body;
    const postedDate = new Date(mcfPostedAt);
    const expiry = new Date(postedDate);
    expiry.setDate(expiry.getDate() + 14);
    const job = await prisma.jobPosting.update({
      where: { id: req.params.id },
      data: { mcfJobId, mcfPostedAt: postedDate, mcfExpiredAt: expiry, fcfCompliant: false, fcfNotes: fcfNotes || null, status: 'OPEN' },
    });
    res.json({ message: 'MCF posting recorded. FCF 14-day period ends on: ' + expiry.toISOString().split('T')[0], job });
  } catch (err) { next(err); }
});

// REC-002: status check for a single job — used by recruiters before submitting work-pass apps
router.get('/jobs/:id/fcf-status', authenticate, async (req, res, next) => {
  try {
    const job = await prisma.jobPosting.findUnique({ where: { id: req.params.id } });
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const { evaluateFcfStatus } = require('../engines/fcf.engine');
    const fcf = evaluateFcfStatus(job);
    res.json({ jobId: job.id, title: job.title, mcfPostedAt: job.mcfPostedAt, mcfExpiredAt: job.mcfExpiredAt, fcfExempt: job.fcfExempt, fcfExemptReason: job.fcfExemptReason, ...fcf });
  } catch (err) { next(err); }
});

// REC-002: mark / unmark a job FCF-exempt with mandatory justification.
router.put('/jobs/:id/fcf-exempt', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const { EXEMPT_REASONS } = require('../engines/fcf.engine');
    const { fcfExempt, fcfExemptReason, fcfExemptNote } = req.body;
    if (fcfExempt !== false && fcfExempt !== true) {
      return res.status(400).json({ error: 'fcfExempt must be boolean' });
    }
    if (fcfExempt) {
      if (!fcfExemptReason || !EXEMPT_REASONS.includes(fcfExemptReason)) {
        return res.status(400).json({ error: `fcfExemptReason required (one of ${EXEMPT_REASONS.join('|')})` });
      }
      if (!fcfExemptNote || !String(fcfExemptNote).trim()) {
        return res.status(400).json({ error: 'fcfExemptNote (justification) is required when granting exemption' });
      }
    }
    const data = fcfExempt
      ? { fcfExempt: true, fcfExemptReason, fcfExemptNote, fcfExemptBy: req.user?.sub || null, fcfExemptAt: new Date() }
      : { fcfExempt: false, fcfExemptReason: null, fcfExemptNote: null, fcfExemptBy: null, fcfExemptAt: null };
    const job = await prisma.jobPosting.update({ where: { id: req.params.id }, data });
    res.json(job);
  } catch (err) {
    if (err?.code === 'P2025') return res.status(404).json({ error: 'Job not found' });
    next(err);
  }
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

      // REC-002: FCF gate — block hire if the job's MCF 14-day window hasn't
      // elapsed AND the job isn't FCF-exempt. Override possible via
      // `fcfOverride: true` body flag (Super Admin only — audited downstream).
      if (candidate.job) {
        const { evaluateFcfStatus } = require('../engines/fcf.engine');
        const fcf = evaluateFcfStatus(candidate.job);
        if (fcf.blocksHire) {
          const override = req.body?.fcfOverride === true && req.user?.role === 'SUPER_ADMIN';
          if (!override) {
            return res.status(409).json({
              error: 'FCF compliance gate: cannot hire this candidate yet',
              fcfStatus: fcf.status,
              daysRemaining: fcf.daysRemaining,
              mcfDaysRequired: fcf.mcfDaysRequired,
              hint: fcf.status === 'NOT_POSTED'
                ? 'Post the job on MyCareersFuture first (POST /jobs/:id/fcf-compliance), or mark the job FCF-exempt with justification (PUT /jobs/:id/fcf-exempt).'
                : `Wait ${fcf.daysRemaining} more day(s) for the 14-day MCF advertising window to elapse.`,
            });
          }
        }
      }

      const { startDate, department, jobTitle, basicSalary, managerId, probationMonths = 3 } = req.body;
      if (!startDate) return res.status(400).json({ error: 'startDate is required' });

      const authHeader = req.headers.authorization || '';
      const triggers = { employeeCreated: false, leaveProvisioned: false, itTaskCreated: false, payrollSetupQueued: false, probationStarted: false, emailSent: false, acknowledgementsQueued: false };

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

      // ── 7. Queue mandatory policy acknowledgements ──────────────────────────
      // Creates one PENDING PolicyAcknowledgement row per active required doc.
      // skipDuplicates guards against re-running approve on a mis-hire edge case.
      await fireAndForget(async () => {
        const docs = await prisma.policyDocument.findMany({ where: { isActive: true, isRequired: true } });
        if (docs.length) {
          await prisma.policyAcknowledgement.createMany({
            data: docs.map(d => ({ id: uuidv4(), employeeId, documentId: d.id })),
            skipDuplicates: true,
          });
        }
        triggers.acknowledgementsQueued = true;
      });

      // ── 8. Send confirmation emails ─────────────────────────────────────────
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
    // `isHired` and `isOfferMade` are workflow state, not editable attributes.
    // They are mutated only by the hire-approval pipeline at
    // POST /candidates/:id/approve, which enforces the FCF 14-day MyCareersFuture
    // gate, creates the Employee record, provisions leave entitlements, IT/payroll
    // onboarding tasks and policy acknowledgements. Allowing them here would let
    // a RECRUITER bypass the entire MOM compliance path with a single PUT.
    const { notes, phone, currentEmployer, currentTitle, noticePeriod, expectedSalary } = req.body;
    const candidate = await prisma.candidate.update({
      where: { id: req.params.id },
      data: { notes, phone, currentEmployer, currentTitle, noticePeriod, expectedSalary },
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

// ── REC-002 FCF audit + report ────────────────────────────────────────────────

// PATCH /candidates/:id/audit — capture nationality, shortlisting/hiring/rejection notes
router.patch('/candidates/:id/audit', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.RECRUITER), async (req, res, next) => {
  try {
    const { nationality, citizenStatus, shortlistingNotes, hiringRationale, rejectionReason } = req.body;
    const data = {};
    if (nationality        != null) data.nationality        = nationality;
    if (citizenStatus      != null) {
      const valid = ['CITIZEN', 'PR', 'FOREIGNER'];
      if (!valid.includes(citizenStatus)) return res.status(400).json({ error: `citizenStatus must be one of ${valid.join('|')}` });
      data.citizenStatus = citizenStatus;
    }
    if (shortlistingNotes  != null) data.shortlistingNotes  = shortlistingNotes;
    if (hiringRationale    != null) data.hiringRationale    = hiringRationale;
    if (rejectionReason    != null) data.rejectionReason    = rejectionReason;
    if (!Object.keys(data).length) return res.status(400).json({ error: 'no audit fields supplied' });
    const candidate = await prisma.candidate.update({ where: { id: req.params.id }, data });
    res.json(candidate);
  } catch (err) {
    if (err?.code === 'P2025') return res.status(404).json({ error: 'Candidate not found' });
    next(err);
  }
});

// GET /recruitment/fcf-report?from=YYYY-MM-DD&to=YYYY-MM-DD&jobId=
// Full FCF compliance report — one row per job with posting status, days
// advertised, nationality breakdown, hiring decisions + rationale, rejection
// audit. Plus dashboard summary (totalJobs, byStatus, complianceViolations).
router.get('/fcf-report', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER, ROLES.RECRUITER), async (req, res, next) => {
  try {
    const { from, to, jobId } = req.query;
    const where = {};
    if (jobId) where.id = jobId;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from + 'T00:00:00.000Z');
      if (to)   where.createdAt.lte = new Date(to   + 'T23:59:59.999Z');
    }
    const jobs = await prisma.jobPosting.findMany({ where, orderBy: { createdAt: 'desc' }, take: 500 });
    const jobIds = jobs.map(j => j.id);
    const candidates = jobIds.length
      ? await prisma.candidate.findMany({ where: { jobId: { in: jobIds } } })
      : [];
    const byJob = {};
    for (const c of candidates) {
      if (!c.jobId) continue;
      (byJob[c.jobId] ||= []).push(c);
    }
    const { buildFcfReport } = require('../engines/fcf.engine');
    const report = buildFcfReport(jobs, byJob);
    res.json({ generatedAt: new Date().toISOString(), filters: { from: from || null, to: to || null, jobId: jobId || null }, ...report });
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

// ── Policy Documents (REC-004) ─────────────────────────────────────────────────
// NOTE: These static routes MUST be defined before GET /onboarding/:employeeId
// so that Express doesn't treat "policy-documents" as an employeeId.

const { REQUIRED_DOCS, computeAckSummary } = require('../engines/acknowledgement.engine');

// GET /onboarding/policy-documents — list active policy documents
router.get('/onboarding/policy-documents', authenticate, async (req, res, next) => {
  try {
    const { includeInactive } = req.query;
    const where = includeInactive === 'true' ? {} : { isActive: true };
    const docs = await prisma.policyDocument.findMany({ where, orderBy: { createdAt: 'asc' } });
    res.json(docs);
  } catch (err) { next(err); }
});

// POST /onboarding/policy-documents/seed — idempotent seed of 4 default docs
router.post('/onboarding/policy-documents/seed',
  authenticate,
  authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN),
  async (req, res, next) => {
    try {
      let created = 0, skipped = 0;
      for (const doc of REQUIRED_DOCS) {
        const existing = await prisma.policyDocument.findUnique({ where: { code: doc.code } });
        if (existing) { skipped++; continue; }
        await prisma.policyDocument.create({
          data: { id: uuidv4(), ...doc, createdBy: req.user.sub },
        });
        created++;
      }
      res.status(201).json({ created, skipped, total: REQUIRED_DOCS.length });
    } catch (err) { next(err); }
  }
);

// POST /onboarding/policy-documents — create a policy document
router.post('/onboarding/policy-documents',
  authenticate,
  authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN),
  async (req, res, next) => {
    try {
      const { code, title, description, documentUrl, documentHash, version, isRequired } = req.body;
      if (!code || !title) return res.status(400).json({ error: 'code and title are required' });
      const doc = await prisma.policyDocument.create({
        data: {
          id: uuidv4(), code: code.toUpperCase(), title, description: description || null,
          documentUrl: documentUrl || null, documentHash: documentHash || null,
          version: version || '1.0',
          isRequired: isRequired !== false,
          createdBy: req.user.sub,
        },
      });
      res.status(201).json(doc);
    } catch (err) {
      if (err?.code === 'P2002') return res.status(409).json({ error: 'A document with this code already exists' });
      next(err);
    }
  }
);

// PUT /onboarding/policy-documents/:docId — update a policy document
router.put('/onboarding/policy-documents/:docId',
  authenticate,
  authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN),
  async (req, res, next) => {
    try {
      const { title, description, documentUrl, documentHash, version, isRequired, isActive } = req.body;
      const data = { updatedBy: req.user.sub };
      if (title          != null) data.title         = title;
      if (description    != null) data.description   = description;
      if (documentUrl    != null) data.documentUrl   = documentUrl;
      if (documentHash   != null) data.documentHash  = documentHash;
      if (version        != null) data.version       = version;
      if (isRequired     != null) data.isRequired    = isRequired;
      if (isActive       != null) data.isActive      = isActive;
      const doc = await prisma.policyDocument.update({ where: { id: req.params.docId }, data });
      res.json(doc);
    } catch (err) {
      if (err?.code === 'P2025') return res.status(404).json({ error: 'Policy document not found' });
      next(err);
    }
  }
);

// ── (existing) Onboarding task list ───────────────────────────────────────────

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

// ── HR Buddy Assignment ────────────────────────────────────────────────────────

// Fetch employee profile from employee-service (fail-soft: returns null on error)
async function fetchEmployee(employeeId, authHeader) {
  try {
    const r = await fetch(`${EMPLOYEE_SERVICE_URL}/employees/${employeeId}`, {
      headers: { Authorization: authHeader || '', 'x-internal-service-key': INTERNAL_SERVICE_KEY },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// POST /onboarding/:employeeId/buddy — HR Admin assigns a buddy to a new hire
router.post('/onboarding/:employeeId/buddy', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const { employeeId } = req.params;
    const { buddyId, note } = req.body;

    if (!buddyId) return res.status(400).json({ error: 'buddyId is required' });
    if (buddyId === employeeId) return res.status(400).json({ error: 'Buddy cannot be the same person as the new hire' });

    const authHeader = req.headers.authorization || '';

    // Enrich with names (best-effort — assignment proceeds even if service is down)
    const [buddyEmp, newHireEmp] = await Promise.all([
      fetchEmployee(buddyId, authHeader),
      fetchEmployee(employeeId, authHeader),
    ]);

    const buddyName   = buddyEmp   ? `${buddyEmp.firstName || ''} ${buddyEmp.lastName || ''}`.trim()   : null;
    const newHireName = newHireEmp ? `${newHireEmp.firstName || ''} ${newHireEmp.lastName || ''}`.trim() : null;
    const startDate   = newHireEmp?.startDate ? new Date(newHireEmp.startDate) : null;

    // Upsert — HR can reassign the buddy at any time
    const existing = await prisma.buddyAssignment.findUnique({ where: { employeeId } });
    let assignment;
    if (existing) {
      assignment = await prisma.buddyAssignment.update({
        where: { employeeId },
        data: { buddyId, buddyName, newHireName, startDate, assignedBy: req.user.sub, assignedAt: new Date(), note: note || null },
      });
    } else {
      assignment = await prisma.buddyAssignment.create({
        data: { id: uuidv4(), employeeId, buddyId, buddyName, newHireName, startDate, assignedBy: req.user.sub, note: note || null },
      });
    }

    // Fire-and-forget: create an onboarding task so the buddy meeting appears in the new hire's checklist
    fireAndForget(async () => {
      const dueDate = startDate
        ? new Date(startDate.getTime() + 3 * 24 * 60 * 60 * 1000)  // 3 days after start
        : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await prisma.onboardingTask.create({
        data: {
          id: uuidv4(),
          employeeId,
          taskName: `HR Buddy introduction${buddyName ? ` with ${buddyName}` : ''}`,
          description: `Your HR Buddy${buddyName ? ` (${buddyName})` : ''} will meet with you to help you settle in. Reach out to them with any questions.`,
          assignedTo: buddyId,
          dueDate,
        },
      });
    });

    // Fire-and-forget: notify the buddy via notification-service
    fireAndForget(async () => {
      const buddyEmail = buddyEmp?.email;
      if (buddyEmail) {
        await fetch(`${NOTIFICATION_SERVICE_URL}/notifications/email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: authHeader },
          body: JSON.stringify({
            type: 'BUDDY_ASSIGNED',
            recipients: [buddyEmail],
            data: {
              buddyName,
              newHireName: newHireName || 'a new team member',
              startDate: startDate ? startDate.toISOString().slice(0, 10) : null,
              note: note || null,
            },
          }),
        });
      }
    });

    res.status(201).json({ assignment, triggers: { taskCreated: true, notificationSent: !!buddyEmp?.email } });
  } catch (err) { next(err); }
});

// GET /onboarding/:employeeId/buddy — retrieve buddy assignment for a new hire
router.get('/onboarding/:employeeId/buddy', authenticate, async (req, res, next) => {
  try {
    const assignment = await prisma.buddyAssignment.findUnique({ where: { employeeId: req.params.employeeId } });
    if (!assignment) return res.status(404).json({ error: 'No buddy assigned for this employee' });
    res.json(assignment);
  } catch (err) { next(err); }
});

// DELETE /onboarding/:employeeId/buddy — remove buddy assignment (HR Admin only)
router.delete('/onboarding/:employeeId/buddy', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const existing = await prisma.buddyAssignment.findUnique({ where: { employeeId: req.params.employeeId } });
    if (!existing) return res.status(404).json({ error: 'No buddy assignment found' });
    await prisma.buddyAssignment.delete({ where: { employeeId: req.params.employeeId } });
    res.status(204).send();
  } catch (err) { next(err); }
});

// ── Policy Acknowledgements (REC-004) ─────────────────────────────────────────

// GET /onboarding/acknowledgements/pending — HR dashboard: employees with
// at least one PENDING acknowledgement, grouped by employeeId.
router.get('/onboarding/acknowledgements/pending',
  authenticate,
  authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER),
  async (req, res, next) => {
    try {
      const pending = await prisma.policyAcknowledgement.findMany({
        where: { status: 'PENDING' },
        include: { document: { select: { code: true, title: true } } },
        orderBy: { createdAt: 'asc' },
      });
      // Group by employeeId
      const byEmployee = {};
      for (const ack of pending) {
        if (!byEmployee[ack.employeeId]) byEmployee[ack.employeeId] = [];
        byEmployee[ack.employeeId].push({ documentId: ack.documentId, code: ack.document.code, title: ack.document.title, createdAt: ack.createdAt });
      }
      const employees = Object.entries(byEmployee).map(([employeeId, docs]) => ({ employeeId, pendingCount: docs.length, pendingDocuments: docs }));
      res.json({ totalEmployees: employees.length, totalPending: pending.length, employees });
    } catch (err) { next(err); }
  }
);

// GET /onboarding/:employeeId/acknowledgements — list all ack records for one employee
router.get('/onboarding/:employeeId/acknowledgements', authenticate, async (req, res, next) => {
  try {
    const acks = await prisma.policyAcknowledgement.findMany({
      where: { employeeId: req.params.employeeId },
      include: { document: { select: { code: true, title: true, description: true, version: true, documentUrl: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const summary = computeAckSummary(acks);
    res.json({ employeeId: req.params.employeeId, summary, acknowledgements: acks });
  } catch (err) { next(err); }
});

// POST /onboarding/:employeeId/acknowledgements/:docId — employee acknowledges a document.
// Captures IP and document hash at time of acknowledgement.
router.post('/onboarding/:employeeId/acknowledgements/:docId', authenticate, async (req, res, next) => {
  try {
    const { employeeId, docId } = req.params;

    const existing = await prisma.policyAcknowledgement.findUnique({
      where: { employeeId_documentId: { employeeId, documentId: docId } },
      include: { document: true },
    });
    if (!existing) return res.status(404).json({ error: 'Acknowledgement record not found — document may not be assigned to this employee' });
    if (existing.status === 'ACKNOWLEDGED') {
      return res.status(409).json({ error: 'Already acknowledged', acknowledgedAt: existing.acknowledgedAt });
    }

    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip || null;
    const ack = await prisma.policyAcknowledgement.update({
      where: { employeeId_documentId: { employeeId, documentId: docId } },
      data: {
        status: 'ACKNOWLEDGED',
        acknowledgedAt: new Date(),
        ipAddress: ip,
        documentHash: existing.document.documentHash || null,
      },
      include: { document: { select: { code: true, title: true, version: true } } },
    });
    res.json(ack);
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

// ── Onboarding Incomplete Alert Sweep (REC-004) ───────────────────────────────

/**
 * Sweep: find employees whose start date is `daysAhead` days from now (default 3)
 * and who still have incomplete onboarding tasks. Fires an HR notification for each.
 * Returns { targetDate, checked, alerted, skipped }.
 */
async function runOnboardingAlertSweep(daysAhead = 3, authHeader = '') {
  // Target date = today + daysAhead (UTC date string YYYY-MM-DD)
  const ref = new Date();
  ref.setUTCDate(ref.getUTCDate() + daysAhead);
  const targetDateStr = ref.toISOString().slice(0, 10);

  // Fetch employee list from employee-service
  const empRes = await fetch(`${EMPLOYEE_SERVICE_URL}/employees?limit=2000`, {
    headers: {
      'x-internal-service-key': INTERNAL_SERVICE_KEY,
      Authorization: authHeader,
    },
  });
  if (!empRes.ok) throw new Error(`employee-service responded ${empRes.status}`);
  const body = await empRes.json();
  // Normalise: accept { employees: [] } or plain array
  const allEmployees = Array.isArray(body) ? body : (body.employees || body.data || []);

  // Keep only those whose startDate matches the target
  const upcoming = allEmployees.filter(e => e.startDate && String(e.startDate).slice(0, 10) === targetDateStr);

  let alerted = 0, skipped = 0;
  for (const emp of upcoming) {
    const tasks = await prisma.onboardingTask.findMany({ where: { employeeId: emp.id } });
    const incomplete = tasks.filter(t => !t.isDone);

    if (incomplete.length === 0) { skipped++; continue; }

    const empName = `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || emp.id;
    await fireAndForget(async () => {
      await fetch(`${NOTIFICATION_SERVICE_URL}/notifications/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-service-key': INTERNAL_SERVICE_KEY, Authorization: authHeader },
        body: JSON.stringify({
          type: 'ONBOARDING_INCOMPLETE_ALERT',
          roles: ['HR_ADMIN', 'SUPER_ADMIN'],
          data: {
            employeeId: emp.id,
            employeeName: empName,
            startDate: targetDateStr,
            daysUntilStart: daysAhead,
            incompleteTasks: incomplete.length,
            totalTasks: tasks.length,
            pendingTaskNames: incomplete.slice(0, 5).map(t => t.taskName),
          },
        }),
      });
    });
    alerted++;
  }

  return { targetDate: targetDateStr, checked: upcoming.length, alerted, skipped };
}

// POST /recruitment/onboarding/alert-sweep — manual trigger (HR Admin) or internal sweep
router.post('/onboarding/alert-sweep',
  authenticate,
  authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN),
  async (req, res, next) => {
    try {
      const daysAhead = Math.max(1, parseInt(req.body.daysAhead ?? 3, 10) || 3);
      const result = await runOnboardingAlertSweep(daysAhead, req.headers.authorization || '');
      res.json(result);
    } catch (err) { next(err); }
  }
);

// ─── REC-001 Offer Letter PDF + E-Sign ────────────────────────────────────────

const {
  buildOfferLetterData,
  renderOfferLetterHtml,
  buildEsignVariables,
} = require('../engines/offer-letter.engine');

const PDFDocument  = require('pdfkit');
const ESIGN_URL    = process.env.ESIGN_SERVICE_URL || 'http://esign-service:4015';
const COMPANY_NAME = process.env.COMPANY_NAME      || 'The Company';

// POST /recruitment/candidates/:id/offer-letter — generate + optionally dispatch e-sign
router.post('/candidates/:id/offer-letter',
  authenticate,
  authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN),
  async (req, res, next) => {
    try {
      const candidate = await prisma.candidate.findUnique({
        where: { id: req.params.id },
        include: { job: true },
      });
      if (!candidate) return res.status(404).json({ error: 'Candidate not found' });

      // Only candidates at OFFER stage or beyond can receive an offer letter
      const ELIGIBLE = ['OFFER', 'HIRED'];
      if (!ELIGIBLE.includes(candidate.stage)) {
        return res.status(400).json({ error: `Candidate must be at OFFER or HIRED stage (currently ${candidate.stage})` });
      }

      const { startDate, offeredSalary, probationMonths, reportingManager, additionalTerms, expiryDays, sendForEsign = true } = req.body;

      const data = buildOfferLetterData(candidate, candidate.job, {
        startDate, offeredSalary, probationMonths, reportingManager, additionalTerms, expiryDays,
      });

      // Upsert OfferLetter record
      const existing = await prisma.offerLetter.findUnique({ where: { candidateId: candidate.id } });

      let letter;
      if (existing) {
        letter = await prisma.offerLetter.update({
          where: { candidateId: candidate.id },
          data: {
            jobTitle:          data.jobTitle,
            department:        data.department,
            startDate:         data.startDate,
            offeredSalary:     data.offeredSalary,
            probationMonths:   data.probationMonths,
            reportingManager:  data.reportingManager,
            additionalTerms:   data.additionalTerms,
            expiresAt:         data.expiresAt,
            status:            'DRAFT',
            esignRequestId:    null,
            signedAt:          null,
            declinedAt:        null,
          },
        });
      } else {
        letter = await prisma.offerLetter.create({
          data: {
            id:               require('crypto').randomUUID(),
            candidateId:      candidate.id,
            jobTitle:         data.jobTitle,
            department:       data.department,
            startDate:        data.startDate,
            offeredSalary:    data.offeredSalary,
            probationMonths:  data.probationMonths,
            reportingManager: data.reportingManager,
            additionalTerms:  data.additionalTerms,
            expiresAt:        data.expiresAt,
            status:           'DRAFT',
            generatedBy:      req.user.sub,
          },
        });
      }

      // Optionally dispatch to ESV-003 e-sign service
      let esignRequestId = null;
      let esignError     = null;
      if (sendForEsign) {
        try {
          const html      = renderOfferLetterHtml(data, COMPANY_NAME);
          const variables = buildEsignVariables(data, COMPANY_NAME);
          const esignRes  = await fetch(`${ESIGN_URL}/esign/requests`, {
            method:  'POST',
            headers: { Authorization: req.headers.authorization, 'Content-Type': 'application/json' },
            body:    JSON.stringify({
              documentType:  'OFFER_LETTER',
              title:         `Offer Letter — ${data.candidateName} — ${data.jobTitle}`,
              contentHtml:   html,
              variables,
              signatories:   [{ signatoryId: candidate.id, signatoryEmail: candidate.email, name: data.candidateName }],
              dueDate:       data.expiresAt.toISOString(),
            }),
          });
          if (esignRes.ok) {
            const esignData = await esignRes.json();
            esignRequestId = esignData.requestId || esignData.id || null;
            await prisma.offerLetter.update({
              where: { candidateId: candidate.id },
              data: { esignRequestId, status: 'SENT' },
            });
            letter = { ...letter, esignRequestId, status: 'SENT' };
          } else {
            esignError = `E-sign dispatch failed (${esignRes.status})`;
          }
        } catch (e) {
          esignError = e.message;
        }
      }

      res.status(201).json({ offerLetter: letter, esignDispatched: sendForEsign && !esignError, esignError });
    } catch (err) { next(err); }
  }
);

// GET /recruitment/candidates/:id/offer-letter — retrieve current offer letter
router.get('/candidates/:id/offer-letter',
  authenticate,
  authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN),
  async (req, res, next) => {
    try {
      const letter = await prisma.offerLetter.findUnique({ where: { candidateId: req.params.id } });
      if (!letter) return res.status(404).json({ error: 'No offer letter found for this candidate' });
      res.json(letter);
    } catch (err) { next(err); }
  }
);

// GET /recruitment/candidates/:id/offer-letter/pdf — stream PDF
router.get('/candidates/:id/offer-letter/pdf',
  authenticate,
  authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN),
  async (req, res, next) => {
    try {
      const letter = await prisma.offerLetter.findUnique({ where: { candidateId: req.params.id } });
      if (!letter) return res.status(404).json({ error: 'No offer letter found for this candidate' });

      const candidate = await prisma.candidate.findUnique({
        where: { id: req.params.id },
        include: { job: true },
      });
      const data = {
        candidateName:   `${candidate.firstName} ${candidate.lastName}`,
        candidateEmail:  candidate.email,
        jobTitle:        letter.jobTitle,
        department:      letter.department,
        reportingManager: letter.reportingManager,
        startDate:       letter.startDate,
        offeredSalary:   letter.offeredSalary,
        probationMonths: letter.probationMonths,
        additionalTerms: letter.additionalTerms,
        expiresAt:       letter.expiresAt,
        issuedDate:      letter.createdAt,
      };

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="offer-letter-${candidate.firstName}-${candidate.lastName}.pdf"`);

      const doc = new PDFDocument({ size: 'A4', margin: 60 });
      doc.pipe(res);

      const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-SG', { day: 'numeric', month: 'long', year: 'numeric' }) : 'TBD';
      const fmtSalary = (s) => s != null ? `SGD ${Number(s).toLocaleString('en-SG', { minimumFractionDigits: 2 })} per month` : 'As discussed';

      // Header
      doc.fontSize(10).fillColor('#555').text(fmtDate(data.issuedDate), { align: 'right' });
      doc.moveDown(0.5);
      doc.fontSize(10).fillColor('#1a1a1a').text(`Dear ${data.candidateName},`);
      doc.moveDown(0.5);
      doc.fontSize(18).fillColor('#1a1a1a').text('Letter of Offer', { underline: false });
      doc.fontSize(12).fillColor('#333').text(data.jobTitle);
      doc.moveDown(0.5);
      doc.moveTo(60, doc.y).lineTo(535, doc.y).strokeColor('#ddd').stroke();
      doc.moveDown(0.5);

      // Terms table
      const rows = [
        ['Position',         data.jobTitle],
        ['Department',       data.department || '—'],
        ['Reporting To',     data.reportingManager || '—'],
        ['Start Date',       fmtDate(data.startDate)],
        ['Basic Salary',     fmtSalary(data.offeredSalary)],
        ['Probation Period', `${data.probationMonths} month${data.probationMonths !== 1 ? 's' : ''}`],
      ];
      for (const [label, value] of rows) {
        doc.fontSize(10).fillColor('#444').text(label, 60, doc.y, { width: 180, continued: false });
        doc.fontSize(10).fillColor('#1a1a1a').text(value, 250, doc.y - doc.currentLineHeight(), { width: 285 });
        doc.moveDown(0.3);
      }

      if (data.additionalTerms) {
        doc.moveDown(0.5);
        doc.fontSize(10).fillColor('#444').text('Additional Terms:', { underline: true });
        doc.moveDown(0.2);
        doc.fontSize(10).fillColor('#1a1a1a').text(data.additionalTerms);
      }

      doc.moveDown(0.5);
      doc.moveTo(60, doc.y).lineTo(535, doc.y).strokeColor('#ddd').stroke();
      doc.moveDown(0.5);
      doc.fontSize(10).fillColor('#1a1a1a').text(`This offer is valid until ${fmtDate(data.expiresAt)}. Please sign and return this letter to indicate your acceptance.`);
      doc.moveDown(1);
      doc.text('Yours sincerely,');
      doc.moveDown(2);
      doc.text('______________________________');
      doc.text(`Human Resources · ${COMPANY_NAME}`);
      doc.moveDown(1.5);
      doc.moveTo(60, doc.y).lineTo(535, doc.y).strokeColor('#ddd').stroke();
      doc.moveDown(0.5);
      doc.fontSize(10).fillColor('#333').text('Acceptance');
      doc.moveDown(0.3);
      doc.fontSize(10).fillColor('#1a1a1a').text(`I, ${data.candidateName}, accept the above offer of employment.`);
      doc.moveDown(1);
      doc.text('Signature: ______________________________        Date: ______________________________');
      doc.moveDown(1.5);
      doc.fontSize(8).fillColor('#aaa').text(`Issued: ${fmtDate(data.issuedDate)}  ·  Offer expires: ${fmtDate(data.expiresAt)}`);

      doc.end();
    } catch (err) { next(err); }
  }
);

// PUT /recruitment/candidates/:id/offer-letter — update status (SIGNED / DECLINED / REVOKED)
router.put('/candidates/:id/offer-letter',
  authenticate,
  authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN),
  async (req, res, next) => {
    try {
      const { status, declinedReason } = req.body;
      const VALID = ['SIGNED', 'DECLINED', 'REVOKED', 'EXPIRED'];
      if (!VALID.includes(status)) {
        return res.status(400).json({ error: `status must be one of ${VALID.join(', ')}` });
      }

      const existing = await prisma.offerLetter.findUnique({ where: { candidateId: req.params.id } });
      if (!existing) return res.status(404).json({ error: 'No offer letter found for this candidate' });

      const updated = await prisma.offerLetter.update({
        where: { candidateId: req.params.id },
        data: {
          status,
          ...(status === 'SIGNED'   ? { signedAt: new Date() }   : {}),
          ...(status === 'DECLINED' ? { declinedAt: new Date(), declinedReason: declinedReason ?? null } : {}),
        },
      });
      res.json(updated);
    } catch (err) { next(err); }
  }
);

module.exports = router;
module.exports.runWorkPassAlertSweep    = runWorkPassAlertSweep;
module.exports.runOnboardingAlertSweep = runOnboardingAlertSweep;
