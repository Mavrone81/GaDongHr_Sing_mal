'use strict';
require('dotenv').config();
const express  = require('express');
const helmet   = require('helmet');
const cors     = require('cors');
const morgan   = require('morgan');
const { v4: uuidv4 } = require('uuid');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize, ROLES } = require('/app/shared/auth-middleware');
const {
  fillTemplate,
  computeDocumentHash,
  extractPlaceholders,
  validatePlaceholders,
  isExpired,
  buildSigningSummary,
  buildSignatureStatement,
} = require('./engines/esign.engine');

const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://notification-service:4009';

const prisma = require('./utils/prisma');
const app    = express();
const PORT   = process.env.PORT || 4015;

app.use(helmet()); app.use(cors()); app.use(express.json({ limit: '2mb' })); app.use(morgan('combined'));
const { tenantContextMiddleware } = require('/app/shared/tenant-context');
app.use(tenantContextMiddleware);
app.get('/health', (req, res) => res.json({ service: 'esign-service', status: 'ok', ts: new Date() }));

const ESIGN_DOC_TYPES = ['EMPLOYMENT_CONTRACT', 'POLICY_ACKNOWLEDGEMENT', 'CUSTOM'];
const ESIGN_STATUSES  = ['PENDING', 'SIGNED', 'DECLINED', 'EXPIRED', 'REVOKED'];
const HR_ROLES        = [ROLES.HR_ADMIN, ROLES.HR_MANAGER, ROLES.SUPER_ADMIN];

// ── Audit helper ──────────────────────────────────────────────────────────────
async function writeESignAudit({ requestId, action, actorId, req, detail }) {
  try {
    await prisma.eSignAuditLog.create({
      data: {
        id:        uuidv4(),
        requestId,
        action,
        actorId:   actorId || null,
        actorIp:   req?.ip || req?.headers?.['x-forwarded-for'] || null,
        detail:    detail  || null,
      },
    });
  } catch (err) {
    console.error('[esign-audit] write failed:', err.message);
  }
}

// ── Document Templates ────────────────────────────────────────────────────────

// POST /esign/documents — HR creates a new document template
app.post('/esign/documents', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const { code, title, description, documentType, templateHtml, version, annualRenewal, expiresInDays } = req.body;
    if (!code || !code.trim())          return res.status(400).json({ error: 'code is required' });
    if (!title || !title.trim())         return res.status(400).json({ error: 'title is required' });
    if (!templateHtml || !templateHtml.trim()) return res.status(400).json({ error: 'templateHtml is required' });
    if (!documentType || !ESIGN_DOC_TYPES.includes(documentType))
      return res.status(400).json({ error: `documentType must be one of: ${ESIGN_DOC_TYPES.join(', ')}` });

    const doc = await prisma.eSignDocument.create({
      data: {
        id:           uuidv4(),
        code:         code.trim().toUpperCase(),
        title:        title.trim(),
        description:  description?.trim() || null,
        documentType,
        templateHtml: templateHtml.trim(),
        version:      version?.trim() || '1.0',
        annualRenewal: Boolean(annualRenewal),
        expiresInDays: expiresInDays ? parseInt(expiresInDays) : null,
        createdBy:    req.user.sub,
      },
    });

    const placeholders = extractPlaceholders(doc.templateHtml);
    res.status(201).json({ ...doc, placeholders });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'A document with this code already exists' });
    next(err);
  }
});

// GET /esign/documents — list active templates (HR only)
app.get('/esign/documents', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const { includeInactive, documentType } = req.query;
    const where = {};
    if (!includeInactive) where.isActive = true;
    if (documentType)     where.documentType = documentType;

    const docs = await prisma.eSignDocument.findMany({ where, orderBy: { createdAt: 'desc' } });
    res.json({ documents: docs.map(d => ({ ...d, placeholders: extractPlaceholders(d.templateHtml) })), total: docs.length });
  } catch (err) { next(err); }
});

// GET /esign/documents/:id — single template
app.get('/esign/documents/:id', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const doc = await prisma.eSignDocument.findUnique({ where: { id: req.params.id } });
    if (!doc) return res.status(404).json({ error: 'Document template not found' });
    res.json({ ...doc, placeholders: extractPlaceholders(doc.templateHtml) });
  } catch (err) { next(err); }
});

// PUT /esign/documents/:id — update template (increments version)
app.put('/esign/documents/:id', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const doc = await prisma.eSignDocument.findUnique({ where: { id: req.params.id } });
    if (!doc) return res.status(404).json({ error: 'Document template not found' });

    const { title, description, templateHtml, version, annualRenewal, expiresInDays, isActive } = req.body;
    const data = { updatedBy: req.user.sub };
    if (title       !== undefined) data.title         = title.trim();
    if (description !== undefined) data.description   = description?.trim() || null;
    if (templateHtml !== undefined) data.templateHtml  = templateHtml.trim();
    if (version     !== undefined) data.version        = version.trim();
    if (annualRenewal !== undefined) data.annualRenewal = Boolean(annualRenewal);
    if (expiresInDays !== undefined) data.expiresInDays = expiresInDays ? parseInt(expiresInDays) : null;
    if (isActive    !== undefined) data.isActive       = Boolean(isActive);

    const updated = await prisma.eSignDocument.update({ where: { id: req.params.id }, data });
    res.json({ ...updated, placeholders: extractPlaceholders(updated.templateHtml) });
  } catch (err) { next(err); }
});

// ── Sign Requests ─────────────────────────────────────────────────────────────

// POST /esign/requests — HR dispatches sign requests (single or bulk)
// Body: { documentId, signatoryIds: string[], variables: {}, dueDate?, message? }
app.post('/esign/requests', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const { documentId, signatoryIds, variables = {}, dueDate, message } = req.body;
    if (!documentId) return res.status(400).json({ error: 'documentId is required' });
    if (!signatoryIds || !Array.isArray(signatoryIds) || signatoryIds.length === 0)
      return res.status(400).json({ error: 'signatoryIds must be a non-empty array' });

    const doc = await prisma.eSignDocument.findUnique({ where: { id: documentId } });
    if (!doc)           return res.status(404).json({ error: 'Document template not found' });
    if (!doc.isActive)  return res.status(409).json({ error: 'Document template is inactive' });

    const docHash      = computeDocumentHash(doc.templateHtml);
    const dueDateValue = dueDate ? new Date(dueDate) :
      doc.expiresInDays ? new Date(Date.now() + doc.expiresInDays * 86_400_000) : null;

    const created = [];
    const skipped = [];

    for (const signatoryId of signatoryIds) {
      // Skip if already has a PENDING or SIGNED request for this doc version
      const existing = await prisma.eSignRequest.findFirst({
        where: { documentId, signatoryId, documentVersion: doc.version, status: { in: ['PENDING', 'SIGNED'] } },
      });
      if (existing) { skipped.push({ signatoryId, reason: `Already ${existing.status}` }); continue; }

      const mergedVars    = { ...variables, signatoryId };
      const personalHtml  = fillTemplate(doc.templateHtml, mergedVars);
      const reqTitle      = `${doc.title} — ${signatoryId}`;

      const esignReq = await prisma.eSignRequest.create({
        data: {
          id:               uuidv4(),
          documentId,
          documentVersion:  doc.version,
          documentHash:     docHash,
          signatoryId,
          requestedById:    req.user.sub,
          title:            reqTitle,
          personalizedHtml: personalHtml,
          status:           'PENDING',
          dueDate:          dueDateValue,
          message:          message?.trim() || null,
        },
      });

      await writeESignAudit({ requestId: esignReq.id, action: 'CREATED', actorId: req.user.sub, req });

      // Notify signatory (fire-and-forget)
      fetch(`${NOTIFICATION_SERVICE_URL}/notifications/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type:       'SYSTEM',
          recipients: [signatoryId],
          data: {
            title: `Action Required: Sign "${doc.title}"`,
            body:  message?.trim() || `You have a document requiring your e-signature: "${doc.title}". Please review and sign at your earliest convenience.`,
          },
          link: `/documents/sign/${esignReq.id}`,
        }),
      }).catch(() => {});

      created.push(esignReq);
    }

    res.status(201).json({ created: created.length, skipped: skipped.length, requests: created, skippedDetails: skipped });
  } catch (err) { next(err); }
});

// GET /esign/requests — list requests (employees see own; HR sees all)
app.get('/esign/requests', authenticate, async (req, res, next) => {
  try {
    const isHr = HR_ROLES.includes(req.user.role);
    const { status, documentId, signatoryId } = req.query;

    const where = {};
    if (!isHr) {
      where.signatoryId = req.user.sub;
    } else {
      if (signatoryId) where.signatoryId = signatoryId;
    }
    if (status)     where.status     = status;
    if (documentId) where.documentId = documentId;

    const requests = await prisma.eSignRequest.findMany({
      where,
      select: {
        id: true, documentId: true, documentVersion: true, signatoryId: true,
        requestedById: true, title: true, status: true, dueDate: true, message: true,
        viewedAt: true, signedAt: true, declineReason: true, remindersSent: true,
        createdAt: true, updatedAt: true,
        // omit personalizedHtml from list — can be large
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    const now     = new Date();
    // eslint-disable-next-line no-unused-vars
    const enriched = requests.map(({ personalizedHtml: _omit, ...r }) => ({
      ...r,
      isOverdue: r.status === 'PENDING' && r.dueDate && new Date(r.dueDate) < now,
    }));

    const summary = isHr ? buildSigningSummary(requests) : undefined;
    res.json({ requests: enriched, total: enriched.length, ...(summary ? { summary } : {}) });
  } catch (err) { next(err); }
});

// GET /esign/requests/pending — HR: all PENDING requests sorted by dueDate
app.get('/esign/requests/pending', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const requests = await prisma.eSignRequest.findMany({
      where: { status: 'PENDING' },
      select: {
        id: true, documentId: true, documentVersion: true, signatoryId: true,
        title: true, status: true, dueDate: true, viewedAt: true, createdAt: true,
      },
      orderBy: { dueDate: 'asc' },
    });
    const now = new Date();
    res.json({
      requests: requests.map(r => ({ ...r, isOverdue: r.dueDate && new Date(r.dueDate) < now })),
      total: requests.length,
    });
  } catch (err) { next(err); }
});

// GET /esign/requests/:id — single request (records viewedAt on first employee view)
app.get('/esign/requests/:id', authenticate, async (req, res, next) => {
  try {
    const esignReq = await prisma.eSignRequest.findUnique({
      where: { id: req.params.id },
      include: { document: { select: { title: true, documentType: true, code: true } } },
    });
    if (!esignReq) return res.status(404).json({ error: 'Sign request not found' });

    const isHr = HR_ROLES.includes(req.user.role);
    if (!isHr && esignReq.signatoryId !== req.user.sub)
      return res.status(403).json({ error: 'Forbidden' });

    // Record first view by the signatory
    if (!isHr && !esignReq.viewedAt && esignReq.signatoryId === req.user.sub) {
      await prisma.eSignRequest.update({ where: { id: req.params.id }, data: { viewedAt: new Date() } });
      await writeESignAudit({ requestId: req.params.id, action: 'VIEWED', actorId: req.user.sub, req });
    }

    res.json({ ...esignReq, isOverdue: isExpired(esignReq.dueDate) });
  } catch (err) { next(err); }
});

// PUT /esign/requests/:id/sign — employee e-signs the document
app.put('/esign/requests/:id/sign', authenticate, async (req, res, next) => {
  try {
    const { signatoryName, confirmStatement } = req.body;
    if (!signatoryName || !signatoryName.trim())
      return res.status(400).json({ error: 'signatoryName is required to sign the document' });

    const esignReq = await prisma.eSignRequest.findUnique({ where: { id: req.params.id } });
    if (!esignReq) return res.status(404).json({ error: 'Sign request not found' });
    if (esignReq.signatoryId !== req.user.sub)
      return res.status(403).json({ error: 'You can only sign your own documents' });
    if (esignReq.status !== 'PENDING')
      return res.status(409).json({ error: `Cannot sign a request in ${esignReq.status} status` });
    if (isExpired(esignReq.dueDate))
      return res.status(409).json({ error: 'This sign request has expired' });

    const signedDocHash = computeDocumentHash(esignReq.personalizedHtml);
    const statement     = confirmStatement?.trim() || buildSignatureStatement(signatoryName.trim(), esignReq.title);
    const now           = new Date();

    const updated = await prisma.eSignRequest.update({
      where: { id: req.params.id },
      data: {
        status:            'SIGNED',
        signedAt:          now,
        signatoryIp:       req.ip || req.headers['x-forwarded-for'] || null,
        signedDocHash,
        signatureStatement: statement,
        viewedAt:          esignReq.viewedAt || now,
      },
    });

    await writeESignAudit({
      requestId: req.params.id, action: 'SIGNED', actorId: req.user.sub, req,
      detail: { signedDocHash, signatoryName: signatoryName.trim() },
    });

    // Notify HR that document was signed (fire-and-forget)
    fetch(`${NOTIFICATION_SERVICE_URL}/notifications/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type:  'SYSTEM',
        roles: ['HR_ADMIN', 'HR_MANAGER'],
        data:  { title: `Document Signed`, body: `Employee ${esignReq.signatoryId} signed "${esignReq.title}" on ${now.toISOString().slice(0, 10)}.` },
        link:  '/documents',
      }),
    }).catch(() => {});

    res.json({ ...updated, signedAt: now.toISOString(), signedDocHash });
  } catch (err) { next(err); }
});

// PUT /esign/requests/:id/decline — employee declines (reason required)
app.put('/esign/requests/:id/decline', authenticate, async (req, res, next) => {
  try {
    const { declineReason } = req.body;
    if (!declineReason || !declineReason.trim())
      return res.status(400).json({ error: 'declineReason is required when declining a document' });

    const esignReq = await prisma.eSignRequest.findUnique({ where: { id: req.params.id } });
    if (!esignReq) return res.status(404).json({ error: 'Sign request not found' });
    if (esignReq.signatoryId !== req.user.sub)
      return res.status(403).json({ error: 'You can only decline your own documents' });
    if (esignReq.status !== 'PENDING')
      return res.status(409).json({ error: `Cannot decline a request in ${esignReq.status} status` });

    const updated = await prisma.eSignRequest.update({
      where: { id: req.params.id },
      data:  { status: 'DECLINED', declineReason: declineReason.trim() },
    });

    await writeESignAudit({ requestId: req.params.id, action: 'DECLINED', actorId: req.user.sub, req, detail: { declineReason: declineReason.trim() } });

    fetch(`${NOTIFICATION_SERVICE_URL}/notifications/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type:  'SYSTEM',
        roles: ['HR_ADMIN', 'HR_MANAGER'],
        data:  { title: `Document Declined`, body: `Employee ${esignReq.signatoryId} declined "${esignReq.title}". Reason: ${declineReason.trim()}` },
        link:  '/documents',
      }),
    }).catch(() => {});

    res.json(updated);
  } catch (err) { next(err); }
});

// PUT /esign/requests/:id/revoke — HR revokes a PENDING request
app.put('/esign/requests/:id/revoke', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const esignReq = await prisma.eSignRequest.findUnique({ where: { id: req.params.id } });
    if (!esignReq) return res.status(404).json({ error: 'Sign request not found' });
    if (!['PENDING', 'DECLINED'].includes(esignReq.status))
      return res.status(409).json({ error: `Cannot revoke a request in ${esignReq.status} status` });

    const updated = await prisma.eSignRequest.update({
      where: { id: req.params.id },
      data:  { status: 'REVOKED', revokedAt: new Date(), revokedById: req.user.sub },
    });

    await writeESignAudit({ requestId: req.params.id, action: 'REVOKED', actorId: req.user.sub, req });

    res.json(updated);
  } catch (err) { next(err); }
});

// GET /esign/requests/:id/audit — immutable audit trail for a request
app.get('/esign/requests/:id/audit', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const esignReq = await prisma.eSignRequest.findUnique({ where: { id: req.params.id } });
    if (!esignReq) return res.status(404).json({ error: 'Sign request not found' });

    const entries = await prisma.eSignAuditLog.findMany({
      where:   { requestId: req.params.id },
      orderBy: { timestamp: 'asc' },
    });
    res.json({ requestId: req.params.id, entries, total: entries.length });
  } catch (err) { next(err); }
});

// GET /esign/dashboard — HR compliance summary
app.get('/esign/dashboard', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const { period } = req.query; // optional YYYY-MM filter

    const where = {};
    if (period) {
      const [y, m] = period.split('-');
      const start  = new Date(parseInt(y), parseInt(m) - 1, 1);
      const end    = new Date(parseInt(y), parseInt(m), 1);
      where.createdAt = { gte: start, lt: end };
    }

    const [allRequests, docs] = await Promise.all([
      prisma.eSignRequest.findMany({
        where,
        select: { id: true, documentId: true, signatoryId: true, status: true, dueDate: true, signedAt: true },
      }),
      prisma.eSignDocument.findMany({ where: { isActive: true }, select: { id: true, title: true, code: true, documentType: true } }),
    ]);

    const now     = new Date();
    const summary = buildSigningSummary(allRequests);
    const overdue = allRequests.filter(r => r.status === 'PENDING' && r.dueDate && new Date(r.dueDate) < now);

    // Per-document breakdown
    const byDocument = docs.map(doc => {
      const reqs   = allRequests.filter(r => r.documentId === doc.id);
      const docSum = buildSigningSummary(reqs);
      return { ...doc, ...docSum };
    }).filter(d => d.total > 0);

    res.json({ summary, overdue: overdue.length, byDocument, asOf: now });
  } catch (err) { next(err); }
});

// POST /esign/sweep — expire overdue PENDING requests; send reminders
async function runESignSweep() {
  const now     = new Date();
  const pending = await prisma.eSignRequest.findMany({ where: { status: 'PENDING' } });

  let expired   = 0;
  let reminders = 0;

  for (const r of pending) {
    if (isExpired(r.dueDate, now)) {
      await prisma.eSignRequest.update({ where: { id: r.id }, data: { status: 'EXPIRED' } });
      await writeESignAudit({ requestId: r.id, action: 'EXPIRED', actorId: null, req: null });
      expired++;
    } else if (r.dueDate) {
      const daysLeft = Math.floor((new Date(r.dueDate).getTime() - now.getTime()) / 86_400_000);
      if (daysLeft === 3 || daysLeft === 1) {
        fetch(`${NOTIFICATION_SERVICE_URL}/notifications/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type:       'SYSTEM',
            recipients: [r.signatoryId],
            data: {
              title: `Reminder: Document signature due in ${daysLeft} day${daysLeft > 1 ? 's' : ''}`,
              body:  `Please sign "${r.title}" by ${new Date(r.dueDate).toLocaleDateString('en-SG')}.`,
            },
            link: `/documents/sign/${r.id}`,
          }),
        }).catch(() => {});
        await prisma.eSignRequest.update({ where: { id: r.id }, data: { remindersSent: { increment: 1 } } });
        await writeESignAudit({ requestId: r.id, action: 'REMINDER_SENT', actorId: null, req: null, detail: { daysLeft } });
        reminders++;
      }
    }
  }

  return { checked: pending.length, expired, reminders };
}

app.post('/esign/sweep', authenticate, authorize(ROLES.HR_ADMIN, ROLES.SUPER_ADMIN), async (req, res, next) => {
  try {
    const result = await runESignSweep();
    res.json(result);
  } catch (err) { next(err); }
});

// POST /esign/renewal-trigger — trigger annual re-sign for all annualRenewal documents
app.post('/esign/renewal-trigger', authenticate, authorize(ROLES.HR_ADMIN, ROLES.SUPER_ADMIN), async (req, res, next) => {
  try {
    const { signatoryIds, variables = {} } = req.body;
    if (!signatoryIds || !Array.isArray(signatoryIds) || signatoryIds.length === 0)
      return res.status(400).json({ error: 'signatoryIds is required' });

    const docs = await prisma.eSignDocument.findMany({
      where: { isActive: true, annualRenewal: true },
    });

    let totalCreated = 0;
    for (const doc of docs) {
      const docHash     = computeDocumentHash(doc.templateHtml);
      const year        = new Date().getFullYear();
      const renewalVersion = `${doc.version}-${year}`;
      const dueDate     = doc.expiresInDays ? new Date(Date.now() + doc.expiresInDays * 86_400_000) : null;

      for (const signatoryId of signatoryIds) {
        const existing = await prisma.eSignRequest.findFirst({
          where: { documentId: doc.id, signatoryId, documentVersion: renewalVersion, status: { in: ['PENDING', 'SIGNED'] } },
        });
        if (existing) continue;

        const mergedVars   = { ...variables, signatoryId };
        const personalHtml = fillTemplate(doc.templateHtml, mergedVars);

        const esignReq = await prisma.eSignRequest.create({
          data: {
            id:               uuidv4(),
            documentId:       doc.id,
            documentVersion:  renewalVersion,
            documentHash:     docHash,
            signatoryId,
            requestedById:    req.user.sub,
            title:            `${doc.title} — Annual Renewal ${year}`,
            personalizedHtml: personalHtml,
            status:           'PENDING',
            dueDate,
            message:          `Annual renewal of "${doc.title}" for ${year}. Please review and re-acknowledge.`,
          },
        });

        await writeESignAudit({ requestId: esignReq.id, action: 'CREATED', actorId: req.user.sub, req });

        fetch(`${NOTIFICATION_SERVICE_URL}/notifications/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type:       'SYSTEM',
            recipients: [signatoryId],
            data: { title: `Annual Re-acknowledgement: "${doc.title}"`, body: `Please review and re-sign "${doc.title}" for ${year}.` },
            link: `/documents/sign/${esignReq.id}`,
          }),
        }).catch(() => {});

        totalCreated++;
      }
    }

    res.json({ documentsProcessed: docs.length, requestsCreated: totalCreated });
  } catch (err) { next(err); }
});

// ESign daily sweep — 01:10 SGT
function scheduleESignSweep() {
  if (process.env.NODE_ENV === 'test') return;
  const sgtOffsetMs = 8 * 60 * 60 * 1000;
  function msUntilNext0110Sgt() {
    const sgtNow = new Date(Date.now() + sgtOffsetMs);
    const target = new Date(Date.UTC(sgtNow.getUTCFullYear(), sgtNow.getUTCMonth(), sgtNow.getUTCDate(), 1, 10, 0, 0));
    if (target <= sgtNow) target.setUTCDate(target.getUTCDate() + 1);
    return target.getTime() - sgtNow.getTime();
  }
  async function tick() {
    try {
      const r = await runESignSweep();
      console.log(`[esign-sweep] checked=${r.checked} expired=${r.expired} reminders=${r.reminders}`);
    } catch (err) {
      console.error('[esign-sweep] failed:', err.message);
    }
    setTimeout(tick, 24 * 60 * 60 * 1000);
  }
  setTimeout(tick, msUntilNext0110Sgt());
  console.log('[esign-sweep] daily scheduler armed for 01:10 SGT');
}

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: (process.env.NODE_ENV === 'production' && (err.status || 500) >= 500) ? 'Internal server error' : (err.message || 'Internal server error') });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`[esign-service] Running on port ${PORT}`));
  scheduleESignSweep();
}

module.exports = app;
module.exports.runESignSweep = runESignSweep;
