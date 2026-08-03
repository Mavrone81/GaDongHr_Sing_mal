'use strict';
/**
 * RPT-003 Phase 2 — scheduler tick with real data fetch + email delivery.
 *
 * Fires every hour. Picks active schedules whose nextRunAt has passed,
 * builds the report attachment, and emails it to the recipients.
 *
 * Requires REPORTING_INTERNAL_JWT env var — a pre-signed admin JWT that the
 * scheduler uses when calling downstream services (employee-service, etc.).
 * If not set, the tick records a SUCCESS placeholder (schedule advances) but
 * does not fetch data or deliver email.
 *
 * SMTP delivery requires SMTP_HOST + SMTP credentials (see engines/email.js).
 * If SMTP_HOST is absent, the report is built but delivery is skipped.
 */

const { v4: uuidv4 } = require('uuid');
const ExcelJS = require('exceljs');
const { PrismaClient } = require('@prisma/client');
const { nextRunAt } = require('./engines/schedule');
const { fetchDataSource } = require('./engines/data-source');
const { execute } = require('./engines/query-executor.engine');
const { toCsv } = require('./engines/csv');
const { toPdf } = require('./engines/pdf');
const { sendReportEmail } = require('./engines/email');

const prisma = require('./utils/prisma');

async function buildAttachment(tpl, format, authHeader) {
  const rawRows = await fetchDataSource(tpl.definition.dataSource, authHeader);
  const out = execute(rawRows, tpl.definition);
  const fmt = (format || 'CSV').toUpperCase();

  if (fmt === 'PDF') {
    const buf = await toPdf(tpl.name, out.columns, out.rows);
    return { buf, ext: 'pdf', contentType: 'application/pdf', rowCount: out.rows.length };
  }
  if (fmt === 'XLSX') {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(tpl.name.slice(0, 30) || 'Report');
    ws.columns = out.columns.map(c => ({ header: c.label, key: c.key, width: 18 }));
    for (const row of out.rows) ws.addRow(row);
    ws.getRow(1).font = { bold: true };
    const buf = await wb.xlsx.writeBuffer();
    return { buf: Buffer.from(buf), ext: 'xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', rowCount: out.rows.length };
  }
  const csv = toCsv(out.columns, out.rows);
  return { buf: Buffer.from(csv, 'utf8'), ext: 'csv', contentType: 'text/csv', rowCount: out.rows.length };
}

async function tick(now = new Date()) {
  const INTERNAL_JWT = process.env.REPORTING_INTERNAL_JWT || '';

  const due = await prisma.reportSchedule.findMany({
    where: { isActive: true, nextRunAt: { lte: now } },
    include: { template: true },
  });

  const results = [];
  for (const sched of due) {
    const startedAt = new Date();
    try {
      let rowCount = 0;
      let deliveryNote = null;

      if (INTERNAL_JWT) {
        const authHeader = `Bearer ${INTERNAL_JWT}`;
        const { buf, ext, contentType, rowCount: rc } = await buildAttachment(sched.template, sched.format, authHeader);
        rowCount = rc;

        // SECURITY (M-14): HR-stored template name is interpolated into the
        // outbound email's HTML body. Escape so a hostile name field can't
        // inject script tags or unsafe attributes into the recipient's mail.
        const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
          '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
        }[c]));
        const safeName = esc(sched.template.name);

        const recipients = sched.recipients.split(',').map(r => r.trim()).filter(Boolean);
        const filename = `${sched.template.name.replace(/[^\w.-]+/g, '_')}.${ext}`;
        const result = await sendReportEmail({
          recipients,
          subject: `[GaDongHR Report] ${sched.template.name}`,
          html: `<p>Your scheduled report <strong>${safeName}</strong> is ready (${rowCount} rows).</p>` +
                `<p>Generated: ${now.toISOString()}</p>`,
          attachmentName: filename,
          attachmentBuffer: buf,
          contentType,
        });
        deliveryNote = result.skipped ? 'SMTP not configured — attachment built, delivery skipped' : null;
      } else {
        console.log(`[reporting] Tick: schedule=${sched.id} template="${sched.template.name}" → ${sched.recipients} (REPORTING_INTERNAL_JWT not set)`);
        deliveryNote = 'REPORTING_INTERNAL_JWT not configured — data fetch and delivery skipped';
      }

      await prisma.reportRun.create({
        data: {
          id: uuidv4(),
          templateId: sched.templateId,
          scheduleId: sched.id,
          status: 'SUCCESS',
          rowCount,
          errorMsg: deliveryNote,
          triggeredBy: 'scheduler',
          startedAt, completedAt: new Date(),
        },
      });
      const next = nextRunAt(sched.frequency, sched.nextRunAt);
      await prisma.reportSchedule.update({
        where: { id: sched.id },
        data: { lastRunAt: now, nextRunAt: next },
      });
      results.push({ scheduleId: sched.id, status: 'SUCCESS', rowCount, nextRunAt: next.toISOString() });
    } catch (err) {
      console.error(`[reporting] Tick error on schedule ${sched.id}:`, err.message);
      await prisma.reportRun.create({
        data: {
          id: uuidv4(),
          templateId: sched.templateId, scheduleId: sched.id,
          status: 'ERROR', rowCount: 0,
          errorMsg: err.message?.slice(0, 500) || 'Unknown error',
          triggeredBy: 'scheduler',
          startedAt, completedAt: new Date(),
        },
      });
      results.push({ scheduleId: sched.id, status: 'ERROR', error: err.message });
    }
  }
  return { tickedAt: now.toISOString(), due: due.length, results };
}

module.exports = { tick };
