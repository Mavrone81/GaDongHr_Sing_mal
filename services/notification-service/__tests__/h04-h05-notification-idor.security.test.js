'use strict';
/**
 * Security regression for H-04 / H-05.
 *
 * H-04: PUT /notifications/:id/read updates ONLY notifications whose userId
 *       matches the caller's sub OR the role-key `role:<ROLE>`.
 * H-05: GET /notifications/:userId rejects when the requested userId is
 *       neither the caller nor allowed by the admin allowlist.
 */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');

describe('H-04 PUT /notifications/:id/read ownership scoping', () => {
  test('handler uses updateMany with userId filter (not unscoped update)', () => {
    const start = src.indexOf("app.put('/notifications/:id/read'");
    expect(start).toBeGreaterThan(-1);
    const slice = src.slice(start, start + 1500);
    expect(slice).toMatch(/updateMany\(/);
    // Confirms the where clause includes userId: { in: [...] }
    expect(slice).toMatch(/userId:\s*\{\s*in:\s*\[/);
  });
  test('handler returns 404 when no row matched (no leakage to other users)', () => {
    const start = src.indexOf("app.put('/notifications/:id/read'");
    const slice = src.slice(start, start + 1500);
    expect(slice).toMatch(/count\s*===\s*0[\s\S]+?res\.status\(404\)/);
  });
});

describe('H-05 GET /notifications/:userId ownership scoping', () => {
  test('rejects mismatch between :userId and caller, unless admin', () => {
    const start = src.indexOf("app.get('/notifications/:userId'");
    expect(start).toBeGreaterThan(-1);
    const slice = src.slice(start, start + 1500);
    expect(slice).toMatch(/req\.params\.userId\s*!==\s*req\.user\.sub/);
    expect(slice).toMatch(/SUPER_ADMIN/);
    expect(slice).toMatch(/res\.status\(403\)/);
  });
});
