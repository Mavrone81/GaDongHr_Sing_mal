'use strict';
// SUP-004 — Self-service FAQ. Employee read endpoints + HR Admin CRUD + seed.

const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize, ROLES } = require('/app/shared/auth-middleware');

const prisma = new PrismaClient();
const ADMIN_ROLES = [ROLES.SUPER_ADMIN, ROLES.HR_ADMIN];

const SEED_FAQS = [
  {
    question: 'How do I apply for annual leave?',
    answer: 'Open the Leave module → click **Apply Leave** → select leave type, dates, and reason → submit. Your supervisor receives the request for approval; you will get a notification when it is approved or rejected. Check the team calendar before submitting to avoid clashing with planned coverage.',
    category: 'LEAVE',
    displayOrder: 1,
  },
  {
    question: 'Where can I view or download my payslip?',
    answer: 'Go to **Self-Service → My Payslips**. Payslips are available from the moment your monthly payroll run is finalised. Click any month to view; use the **Download** button to save a PDF. If your latest payslip is missing or shows incorrect figures, raise a ticket under category PAYROLL with the period and the figure in question.',
    category: 'PAYROLL',
    displayOrder: 2,
  },
  {
    question: 'How do I submit an expense claim with receipts?',
    answer: 'Open **Claims → New Claim**. Pick the category (Meals, Travel, Office Supplies, etc.), enter the date, amount, and vendor, toggle GST if a tax invoice was issued (system computes 9 ÷ 109), upload your receipt (multi-file supported), and submit. Approval is routed to your line manager first, then Finance/HOD if above threshold.',
    category: 'CLAIMS',
    displayOrder: 3,
  },
  {
    question: 'How do I update my personal details (bank account, address, contact)?',
    answer: 'Go to **My Profile → Personal Details**. Editable fields (address, phone, emergency contact, bank account) can be updated directly and take effect immediately for payroll runs not yet locked. Restricted fields (NRIC, citizenship, work-pass details) require HR approval — submit the change and HR will be notified.',
    category: 'GENERAL',
    displayOrder: 4,
  },
  {
    question: 'My leave / claim approval is pending — who do I follow up with?',
    answer: 'Open the application in the relevant module to see the current approver. SLA reminders are sent automatically at the 3-day and 7-day marks. If still pending past 7 days, you may also raise a support ticket under category GENERAL referencing the application ID; HR will escalate.',
    category: 'GENERAL',
    displayOrder: 5,
  },
  {
    question: 'How do I report an IT access issue (locked out, password reset, MFA)?',
    answer: 'Submit a ticket under category IT_ACCESS with: your employee ID, the system you cannot access, exact error message, and your work email. For password resets, use the **Forgot Password** link on the login page first — only file a ticket if that flow fails. For lost MFA devices, contact IT Admin directly so they can disable the old device.',
    category: 'IT_ACCESS',
    displayOrder: 6,
  },
];

// ── EMPLOYEE-FACING ───────────────────────────────────────────────────────────

// GET /support/faqs — list published, optionally filtered/searched
router.get('/faqs', authenticate, async (req, res, next) => {
  try {
    const { category, search } = req.query;
    const where = { isPublished: true };
    if (category) {
      const allowed = ['GENERAL', 'PAYROLL', 'LEAVE', 'CLAIMS', 'IT_ACCESS', 'OTHER'];
      const cat = category.toUpperCase();
      if (!allowed.includes(cat)) return res.status(400).json({ error: `category must be one of: ${allowed.join(', ')}` });
      where.category = cat;
    }
    if (search) {
      const s = String(search).trim();
      if (s) {
        where.OR = [
          { question: { contains: s, mode: 'insensitive' } },
          { answer:   { contains: s, mode: 'insensitive' } },
        ];
      }
    }
    const faqs = await prisma.faqEntry.findMany({
      where,
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    });
    res.json(faqs);
  } catch (err) { next(err); }
});

// GET /support/faqs/:id — single entry, increments viewCount
router.get('/faqs/:id', authenticate, async (req, res, next) => {
  try {
    const faq = await prisma.faqEntry.findUnique({ where: { id: req.params.id } });
    if (!faq) return res.status(404).json({ error: 'FAQ not found' });
    if (!faq.isPublished) {
      const isAdmin = ADMIN_ROLES.includes(req.user?.role);
      if (!isAdmin) return res.status(404).json({ error: 'FAQ not found' });
    }
    // Fire-and-forget view counter; do not block the response on failure.
    prisma.faqEntry.update({ where: { id: req.params.id }, data: { viewCount: { increment: 1 } } }).catch(() => {});
    res.json(faq);
  } catch (err) { next(err); }
});

// POST /support/faqs/:id/feedback — employee marks helpful / not helpful
router.post('/faqs/:id/feedback', authenticate, async (req, res, next) => {
  try {
    const { wasHelpful } = req.body;
    if (typeof wasHelpful !== 'boolean') return res.status(400).json({ error: 'wasHelpful (boolean) required' });
    const faq = await prisma.faqEntry.findUnique({ where: { id: req.params.id } });
    if (!faq || !faq.isPublished) return res.status(404).json({ error: 'FAQ not found' });
    const updated = await prisma.faqEntry.update({
      where: { id: req.params.id },
      data: wasHelpful
        ? { helpfulCount: { increment: 1 } }
        : { notHelpfulCount: { increment: 1 } },
    });
    res.json({ helpfulCount: updated.helpfulCount, notHelpfulCount: updated.notHelpfulCount });
  } catch (err) { next(err); }
});

// ── ADMIN CRUD ────────────────────────────────────────────────────────────────

// GET /support/faqs/admin/all — list including unpublished
router.get('/faqs/admin/all', authenticate, authorize(...ADMIN_ROLES), async (_req, res, next) => {
  try {
    const faqs = await prisma.faqEntry.findMany({ orderBy: [{ category: 'asc' }, { displayOrder: 'asc' }] });
    res.json(faqs);
  } catch (err) { next(err); }
});

// POST /support/faqs — create
router.post('/faqs', authenticate, authorize(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const { question, answer, category, isPublished, displayOrder } = req.body;
    if (!question || !answer) return res.status(400).json({ error: 'question and answer required' });
    const allowed = ['GENERAL', 'PAYROLL', 'LEAVE', 'CLAIMS', 'IT_ACCESS', 'OTHER'];
    const cat = (category || 'GENERAL').toUpperCase();
    if (!allowed.includes(cat)) return res.status(400).json({ error: `category must be one of: ${allowed.join(', ')}` });
    const faq = await prisma.faqEntry.create({
      data: {
        id: uuidv4(),
        question, answer,
        category: cat,
        isPublished: isPublished == null ? true : !!isPublished,
        displayOrder: parseInt(displayOrder, 10) || 0,
        createdBy: req.user.sub,
        updatedBy: req.user.sub,
      },
    });
    res.status(201).json(faq);
  } catch (err) { next(err); }
});

// PUT /support/faqs/:id — edit
router.put('/faqs/:id', authenticate, authorize(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const b = req.body;
    const data = { updatedBy: req.user.sub };
    if (b.question !== undefined) data.question = b.question;
    if (b.answer !== undefined) data.answer = b.answer;
    if (b.category !== undefined) {
      const allowed = ['GENERAL', 'PAYROLL', 'LEAVE', 'CLAIMS', 'IT_ACCESS', 'OTHER'];
      const cat = b.category.toUpperCase();
      if (!allowed.includes(cat)) return res.status(400).json({ error: `category must be one of: ${allowed.join(', ')}` });
      data.category = cat;
    }
    if (b.isPublished !== undefined) data.isPublished = !!b.isPublished;
    if (b.displayOrder !== undefined) data.displayOrder = parseInt(b.displayOrder, 10) || 0;
    const faq = await prisma.faqEntry.update({ where: { id: req.params.id }, data });
    res.json(faq);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'FAQ not found' });
    next(err);
  }
});

// DELETE /support/faqs/:id — soft-delete (unpublish)
router.delete('/faqs/:id', authenticate, authorize(...ADMIN_ROLES), async (req, res, next) => {
  try {
    await prisma.faqEntry.update({
      where: { id: req.params.id },
      data: { isPublished: false, updatedBy: req.user.sub },
    });
    res.json({ message: 'FAQ unpublished' });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'FAQ not found' });
    next(err);
  }
});

// POST /support/faqs/seed — idempotent seed of pre-loaded common questions
router.post('/faqs/seed', authenticate, authorize(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const created = [];
    const skipped = [];
    for (const f of SEED_FAQS) {
      const existing = await prisma.faqEntry.findFirst({
        where: { question: f.question, category: f.category },
      });
      if (existing) { skipped.push(existing.id); continue; }
      const row = await prisma.faqEntry.create({
        data: {
          id: uuidv4(),
          question: f.question,
          answer: f.answer,
          category: f.category,
          displayOrder: f.displayOrder,
          isPublished: true,
          createdBy: req.user.sub,
          updatedBy: req.user.sub,
        },
      });
      created.push(row.id);
    }
    res.json({ seedTotal: SEED_FAQS.length, created: created.length, skipped: skipped.length, createdIds: created, skippedIds: skipped });
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.SEED_FAQS = SEED_FAQS;
