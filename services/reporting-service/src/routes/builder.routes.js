'use strict';
/**
 * RPT-003 Phase 1 — report builder routes.
 *
 *   GET    /reports/data-sources                 — metadata for the builder UI
 *   POST   /reports/templates                    — create template
 *   GET    /reports/templates                    — list (own + shared)
 *   GET    /reports/templates/:id                — read
 *   PUT    /reports/templates/:id                — update (owner only)
 *   DELETE /reports/templates/:id                — delete (owner only)
 *   POST   /reports/templates/:id/run            — run, return JSON rows
 *   GET    /reports/templates/:id/export.csv     — run + CSV download
 *   GET    /reports/templates/:id/export.xlsx    — run + Excel download
 *   POST   /reports/preview                      — run an unsaved definition (admin)
 *
 *   POST   /reports/schedules                    — create schedule
 *   GET    /reports/schedules                    — list (own)
 *   PUT    /reports/schedules/:id                — update
 *   DELETE /reports/schedules/:id                — delete
 *   GET    /reports/templates/:id/runs           — run history
 */

const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const ExcelJS = require('exceljs');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize, ROLES } = require('/app/shared/auth-middleware');
const { execute, validate, DATA_SOURCES, FILTER_OPS, AGG_OPS } = require('../engines/query-executor.engine');
const { fetchDataSource, FIELD_CATALOG } = require('../engines/data-source');
const { toCsv } = require('../engines/csv');
const { toPdf } = require('../engines/pdf');
const { firstRunAt, FREQUENCIES } = require('../engines/schedule');

const prisma = require('../utils/prisma');
const REPORT_ROLES = [ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER, ROLES.FINANCE_ADMIN, ROLES.PAYROLL_OFFICER];

function userIdOf(req) {
  return req.user?.sub || req.headers['x-user-id'] || 'unknown';
}

function isAdmin(req) {
  return [ROLES.SUPER_ADMIN, ROLES.HR_ADMIN].includes(req.user?.role || req.headers['x-user-role']);
}

// ── Data sources metadata (helps the builder UI later) ────────────────────────
router.get('/data-sources', authenticate, authorize(...REPORT_ROLES), (req, res) => {
  res.json({
    dataSources: DATA_SOURCES,
    filterOps: FILTER_OPS,
    aggregationOps: AGG_OPS,
    frequencies: FREQUENCIES,
    fieldCatalog: FIELD_CATALOG,
  });
});

// ── Template CRUD ─────────────────────────────────────────────────────────────
router.post('/templates', authenticate, authorize(...REPORT_ROLES), async (req, res, next) => {
  try {
    const { name, description, category, definition, isShared } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const errors = validate(definition);
    if (errors.length > 0) return res.status(400).json({ error: 'Invalid definition', errors });

    const tpl = await prisma.reportTemplate.create({
      data: {
        id: uuidv4(),
        name, description, category,
        definition,
        ownerId: userIdOf(req),
        isShared: !!isShared,
      },
    });
    res.status(201).json(tpl);
  } catch (err) { next(err); }
});

router.get('/templates', authenticate, authorize(...REPORT_ROLES), async (req, res, next) => {
  try {
    const ownerId = userIdOf(req);
    const where = isAdmin(req) ? {} : { OR: [{ ownerId }, { isShared: true }] };
    if (req.query.category) where.category = req.query.category;
    const templates = await prisma.reportTemplate.findMany({
      where, orderBy: { updatedAt: 'desc' },
    });
    res.json(templates);
  } catch (err) { next(err); }
});

router.get('/templates/:id', authenticate, authorize(...REPORT_ROLES), async (req, res, next) => {
  try {
    const tpl = await prisma.reportTemplate.findUnique({ where: { id: req.params.id } });
    if (!tpl) return res.status(404).json({ error: 'Template not found' });
    if (!isAdmin(req) && tpl.ownerId !== userIdOf(req) && !tpl.isShared) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json(tpl);
  } catch (err) { next(err); }
});

router.put('/templates/:id', authenticate, authorize(...REPORT_ROLES), async (req, res, next) => {
  try {
    const tpl = await prisma.reportTemplate.findUnique({ where: { id: req.params.id } });
    if (!tpl) return res.status(404).json({ error: 'Template not found' });
    if (!isAdmin(req) && tpl.ownerId !== userIdOf(req)) {
      return res.status(403).json({ error: 'Only the owner can edit this template' });
    }
    const { name, description, category, definition, isShared } = req.body;
    if (definition !== undefined) {
      const errors = validate(definition);
      if (errors.length > 0) return res.status(400).json({ error: 'Invalid definition', errors });
    }
    const updated = await prisma.reportTemplate.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(category !== undefined && { category }),
        ...(definition !== undefined && { definition }),
        ...(isShared !== undefined && { isShared: !!isShared }),
      },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

router.delete('/templates/:id', authenticate, authorize(...REPORT_ROLES), async (req, res, next) => {
  try {
    const tpl = await prisma.reportTemplate.findUnique({ where: { id: req.params.id } });
    if (!tpl) return res.status(404).json({ error: 'Template not found' });
    if (!isAdmin(req) && tpl.ownerId !== userIdOf(req)) {
      return res.status(403).json({ error: 'Only the owner can delete this template' });
    }
    await prisma.reportTemplate.delete({ where: { id: req.params.id } });
    res.json({ message: 'Template deleted' });
  } catch (err) { next(err); }
});

// ── Run / Export ──────────────────────────────────────────────────────────────
async function runTemplate(definition, authHeader) {
  const rawRows = await fetchDataSource(definition.dataSource, authHeader);
  return execute(rawRows, definition);
}

async function recordRun(templateId, scheduleId, triggeredBy, status, rowCount, errorMsg, startedAt) {
  try {
    await prisma.reportRun.create({
      data: {
        id: uuidv4(),
        templateId, scheduleId,
        status, rowCount, errorMsg,
        triggeredBy, startedAt, completedAt: new Date(),
      },
    });
  } catch (err) {
    // Don't let run-history failures fail the actual report response.
    console.error('[reporting] Failed to record run:', err.message);
  }
}

router.post('/templates/:id/run', authenticate, authorize(...REPORT_ROLES), async (req, res, next) => {
  const startedAt = new Date();
  try {
    const tpl = await prisma.reportTemplate.findUnique({ where: { id: req.params.id } });
    if (!tpl) return res.status(404).json({ error: 'Template not found' });
    if (!isAdmin(req) && tpl.ownerId !== userIdOf(req) && !tpl.isShared) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const out = await runTemplate(tpl.definition, req.headers['authorization']);
    await recordRun(tpl.id, null, userIdOf(req), 'SUCCESS', out.rows.length, null, startedAt);
    res.json({ templateId: tpl.id, name: tpl.name, ...out, generatedAt: new Date().toISOString() });
  } catch (err) {
    await recordRun(req.params.id, null, userIdOf(req), 'ERROR', 0, err.message || 'Unknown error', startedAt);
    if (err.status === 400) return res.status(400).json({ error: err.message, errors: err.errors });
    next(err);
  }
});

router.post('/preview', authenticate, authorize(...REPORT_ROLES), async (req, res, next) => {
  try {
    const definition = req.body.definition;
    const errors = validate(definition);
    if (errors.length > 0) return res.status(400).json({ error: 'Invalid definition', errors });
    const out = await runTemplate(definition, req.headers['authorization']);
    res.json({ ...out, generatedAt: new Date().toISOString() });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message, errors: err.errors });
    next(err);
  }
});

router.get('/templates/:id/export.csv', authenticate, authorize(...REPORT_ROLES), async (req, res, next) => {
  const startedAt = new Date();
  try {
    const tpl = await prisma.reportTemplate.findUnique({ where: { id: req.params.id } });
    if (!tpl) return res.status(404).json({ error: 'Template not found' });
    if (!isAdmin(req) && tpl.ownerId !== userIdOf(req) && !tpl.isShared) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const out = await runTemplate(tpl.definition, req.headers['authorization']);
    const csv = toCsv(out.columns, out.rows);
    await recordRun(tpl.id, null, userIdOf(req), 'SUCCESS', out.rows.length, null, startedAt);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${tpl.name.replace(/[^\w.-]+/g, '_')}.csv"`);
    res.send(csv);
  } catch (err) {
    await recordRun(req.params.id, null, userIdOf(req), 'ERROR', 0, err.message, startedAt);
    next(err);
  }
});

router.get('/templates/:id/export.xlsx', authenticate, authorize(...REPORT_ROLES), async (req, res, next) => {
  const startedAt = new Date();
  try {
    const tpl = await prisma.reportTemplate.findUnique({ where: { id: req.params.id } });
    if (!tpl) return res.status(404).json({ error: 'Template not found' });
    if (!isAdmin(req) && tpl.ownerId !== userIdOf(req) && !tpl.isShared) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const out = await runTemplate(tpl.definition, req.headers['authorization']);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'GaDongHR Reporting';
    wb.created = new Date();
    const ws = wb.addWorksheet(tpl.name.slice(0, 30) || 'Report');
    ws.columns = out.columns.map(c => ({ header: c.label, key: c.key, width: 18 }));
    for (const row of out.rows) ws.addRow(row);
    ws.getRow(1).font = { bold: true };

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${tpl.name.replace(/[^\w.-]+/g, '_')}.xlsx"`);
    await wb.xlsx.write(res);
    await recordRun(tpl.id, null, userIdOf(req), 'SUCCESS', out.rows.length, null, startedAt);
    res.end();
  } catch (err) {
    await recordRun(req.params.id, null, userIdOf(req), 'ERROR', 0, err.message, startedAt);
    next(err);
  }
});

router.get('/templates/:id/export.pdf', authenticate, authorize(...REPORT_ROLES), async (req, res, next) => {
  const startedAt = new Date();
  try {
    const tpl = await prisma.reportTemplate.findUnique({ where: { id: req.params.id } });
    if (!tpl) return res.status(404).json({ error: 'Template not found' });
    if (!isAdmin(req) && tpl.ownerId !== userIdOf(req) && !tpl.isShared) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const out = await runTemplate(tpl.definition, req.headers['authorization']);
    const pdfBuf = await toPdf(tpl.name, out.columns, out.rows);
    await recordRun(tpl.id, null, userIdOf(req), 'SUCCESS', out.rows.length, null, startedAt);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${tpl.name.replace(/[^\w.-]+/g, '_')}.pdf"`);
    res.send(pdfBuf);
  } catch (err) {
    await recordRun(req.params.id, null, userIdOf(req), 'ERROR', 0, err.message, startedAt);
    next(err);
  }
});

router.get('/templates/:id/runs', authenticate, authorize(...REPORT_ROLES), async (req, res, next) => {
  try {
    const runs = await prisma.reportRun.findMany({
      where: { templateId: req.params.id },
      orderBy: { startedAt: 'desc' },
      take: 50,
    });
    res.json(runs);
  } catch (err) { next(err); }
});

// ── Schedules ─────────────────────────────────────────────────────────────────
router.post('/schedules', authenticate, authorize(...REPORT_ROLES), async (req, res, next) => {
  try {
    const { templateId, frequency, format, recipients } = req.body;
    if (!templateId || !frequency || !recipients) {
      return res.status(400).json({ error: 'templateId, frequency, recipients are required' });
    }
    if (!FREQUENCIES.includes(frequency)) {
      return res.status(400).json({ error: `frequency must be one of: ${FREQUENCIES.join(', ')}` });
    }
    const tpl = await prisma.reportTemplate.findUnique({ where: { id: templateId } });
    if (!tpl) return res.status(404).json({ error: 'Template not found' });
    if (!isAdmin(req) && tpl.ownerId !== userIdOf(req) && !tpl.isShared) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const sched = await prisma.reportSchedule.create({
      data: {
        id: uuidv4(),
        templateId, frequency,
        format: ['CSV', 'XLSX', 'PDF'].includes(format) ? format : 'CSV',
        recipients: Array.isArray(recipients) ? recipients.join(',') : String(recipients),
        nextRunAt: firstRunAt(new Date()),
        createdBy: userIdOf(req),
      },
    });
    res.status(201).json(sched);
  } catch (err) { next(err); }
});

router.get('/schedules', authenticate, authorize(...REPORT_ROLES), async (req, res, next) => {
  try {
    const where = isAdmin(req) ? {} : { createdBy: userIdOf(req) };
    if (req.query.templateId) where.templateId = req.query.templateId;
    const schedules = await prisma.reportSchedule.findMany({
      where, orderBy: { nextRunAt: 'asc' },
      include: { template: { select: { id: true, name: true, category: true } } },
    });
    res.json(schedules);
  } catch (err) { next(err); }
});

router.put('/schedules/:id', authenticate, authorize(...REPORT_ROLES), async (req, res, next) => {
  try {
    const sched = await prisma.reportSchedule.findUnique({ where: { id: req.params.id } });
    if (!sched) return res.status(404).json({ error: 'Schedule not found' });
    if (!isAdmin(req) && sched.createdBy !== userIdOf(req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const { frequency, format, recipients, isActive } = req.body;
    if (frequency !== undefined && !FREQUENCIES.includes(frequency)) {
      return res.status(400).json({ error: `frequency must be one of: ${FREQUENCIES.join(', ')}` });
    }
    const updated = await prisma.reportSchedule.update({
      where: { id: req.params.id },
      data: {
        ...(frequency !== undefined && { frequency }),
        ...(format !== undefined && ['CSV', 'XLSX', 'PDF'].includes(format) && { format }),
        ...(recipients !== undefined && { recipients: Array.isArray(recipients) ? recipients.join(',') : String(recipients) }),
        ...(isActive !== undefined && { isActive: !!isActive }),
      },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

router.delete('/schedules/:id', authenticate, authorize(...REPORT_ROLES), async (req, res, next) => {
  try {
    const sched = await prisma.reportSchedule.findUnique({ where: { id: req.params.id } });
    if (!sched) return res.status(404).json({ error: 'Schedule not found' });
    if (!isAdmin(req) && sched.createdBy !== userIdOf(req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    await prisma.reportSchedule.delete({ where: { id: req.params.id } });
    res.json({ message: 'Schedule deleted' });
  } catch (err) { next(err); }
});

// ── Seed pre-built templates (admin only) ─────────────────────────────────────
router.post('/seed-templates', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const { seedTemplates } = require('../seeds/seed-templates');
    const seeded = await seedTemplates(prisma);
    res.json({ seeded, message: seeded === 0 ? 'All seed templates already present' : `Seeded ${seeded} template(s)` });
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.runTemplate = runTemplate;
module.exports.recordRun = recordRun;
