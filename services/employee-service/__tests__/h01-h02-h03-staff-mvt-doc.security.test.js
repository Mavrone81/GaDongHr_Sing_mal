'use strict';
/**
 * Security regression for H-01, H-02, H-03.
 *
 * H-01: staff-movement letter HTML-escapes employeeName/reason.
 * H-02: document upload uses an extension-derived MIME on download AND
 *       forces Content-Disposition: attachment.
 * H-03: document upload filename is uuid + extension only.
 */
const fs = require('fs');
const path = require('path');

const movement = require('../src/engines/staff-movement.engine');
const docSrc   = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'document.routes.js'), 'utf8');

// ── H-01 ──────────────────────────────────────────────────────────────────────
describe('H-01 suggestLetterText HTML-escapes user fields', () => {
  test('escapes employeeName XSS payload', () => {
    const out = movement.suggestLetterText({
      type: 'DEPARTMENT_TRANSFER',
      employeeName: '<script>fetch("//atk")</script>',
      reason: '',
      fromDepartment: 'A', toDepartment: 'B',
    });
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });
  test('escapes reason XSS payload', () => {
    const out = movement.suggestLetterText({
      type: 'DEPARTMENT_TRANSFER',
      employeeName: 'Alice',
      reason: '<img src=x onerror="evil()">',
      fromDepartment: 'A', toDepartment: 'B',
    });
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });
  test('null/empty handling', () => {
    expect(movement.suggestLetterText(null)).toBe('');
    expect(movement.escapeHtml(null)).toBe('');
  });
});

// ── H-02 + H-03 ───────────────────────────────────────────────────────────────
describe('H-02 / H-03 document.routes hardening', () => {
  test('filename callback uses uuid + extname only (no originalname concat)', () => {
    // The filename callback signature should NOT include `${file.originalname}` raw.
    expect(docSrc).toMatch(/filename:\s*\(_req,\s*file,\s*cb\)\s*=>\s*cb\(null,\s*`\$\{uuidv4\(\)\}\$\{path\.extname\(file\.originalname\)\.toLowerCase\(\)\}`/);
    expect(docSrc).not.toMatch(/cb\(null,\s*`\$\{uuidv4\(\)\}-\$\{file\.originalname\}`/);
  });

  test('upload has a fileFilter MIME allowlist', () => {
    expect(docSrc).toMatch(/ALLOWED_MIMES\s*=\s*new Set/);
    expect(docSrc).toMatch(/fileFilter:/);
  });

  test('stored mimeType is the extension-derived safeMime, not req.file.mimetype', () => {
    const start = docSrc.indexOf("router.post('/employee/:employeeId'");
    expect(start).toBeGreaterThan(-1);
    const slice = docSrc.slice(start, start + 2500);
    expect(slice).toMatch(/safeMime\s*=\s*EXT_TO_MIME\[ext\]/);
    expect(slice).toMatch(/mimeType:\s*safeMime/);
    expect(slice).not.toMatch(/mimeType:\s*req\.file\.mimetype/);
  });

  test('download forces Content-Disposition: attachment + nosniff', () => {
    const start = docSrc.indexOf("router.get('/:id/download'");
    const slice = docSrc.slice(start, start + 2500);
    expect(slice).toMatch(/Content-Disposition.*attachment/);
    expect(slice).toMatch(/X-Content-Type-Options.*nosniff/);
    expect(slice).not.toMatch(/Content-Disposition.*inline/);
  });
});
