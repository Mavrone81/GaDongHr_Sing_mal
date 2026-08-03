'use strict';
/**
 * RPT-003 Phase 2 — PDF export engine.
 * Builds a landscape A4 PDF from column metadata + rows and returns a Buffer.
 */

const PDFDocument = require('pdfkit');

function toPdf(reportName, columns, rows) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageW = doc.page.width - 80; // effective content width
    const colW = Math.max(45, Math.min(160, Math.floor(pageW / Math.max(1, columns.length))));

    // ── Title ────────────────────────────────────────────────────────────────
    doc.fontSize(13).font('Helvetica-Bold').fillColor('#0f172a').text(reportName);
    doc.fontSize(7).font('Helvetica').fillColor('#64748b')
      .text(`Generated ${new Date().toUTCString()}  ·  ${rows.length} row(s)`);
    doc.moveDown(0.6);

    // ── Column header row ────────────────────────────────────────────────────
    const hdrY = doc.y;
    doc.rect(40, hdrY, pageW, 15).fill('#1e293b');
    doc.fontSize(6.5).font('Helvetica-Bold').fillColor('#f8fafc');
    columns.forEach((col, i) => {
      if (i * colW >= pageW) return;
      doc.text(String(col.label).slice(0, 22), 42 + i * colW, hdrY + 4, { width: colW - 4, lineBreak: false });
    });

    // ── Data rows ────────────────────────────────────────────────────────────
    let y = hdrY + 17;
    const rowH = 13;
    rows.forEach((row, ri) => {
      if (y + rowH > doc.page.height - 50) {
        doc.addPage();
        y = 40;
      }
      if (ri % 2 === 0) doc.rect(40, y, pageW, rowH).fill('#f8fafc');
      doc.fontSize(6.5).font('Helvetica').fillColor('#334155');
      columns.forEach((col, i) => {
        if (i * colW >= pageW) return;
        const v = row[col.key];
        const s = v == null ? '' : String(v).slice(0, 28);
        doc.text(s, 42 + i * colW, y + 3, { width: colW - 4, lineBreak: false });
      });
      y += rowH;
    });

    // ── Footer ───────────────────────────────────────────────────────────────
    doc.fontSize(6).font('Helvetica').fillColor('#94a3b8')
      .text(`${rows.length} rows  ·  GaDongHR HRMS`, 40, y + 6);

    doc.end();
  });
}

module.exports = { toPdf };
