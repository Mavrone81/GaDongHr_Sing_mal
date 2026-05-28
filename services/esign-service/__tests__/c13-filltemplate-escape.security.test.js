'use strict';
/**
 * Security regression test for C-13:
 *   fillTemplate must HTML-escape variable substitutions so HR-supplied
 *   `variables` containing <script> tags or event handlers cannot land
 *   intact in the rendered template (which is later injected via
 *   dangerouslySetInnerHTML on the signing page).
 */
const { fillTemplate, htmlEscape } = require('../src/engines/esign.engine');

describe('C-13 htmlEscape', () => {
  test('escapes &, <, >, ", and \'', () => {
    expect(htmlEscape('&')).toBe('&amp;');
    expect(htmlEscape('<')).toBe('&lt;');
    expect(htmlEscape('>')).toBe('&gt;');
    expect(htmlEscape('"')).toBe('&quot;');
    expect(htmlEscape("'")).toBe('&#39;');
  });
  test('handles null and undefined', () => {
    expect(htmlEscape(null)).toBe('');
    expect(htmlEscape(undefined)).toBe('');
  });
});

describe('C-13 fillTemplate', () => {
  test('escapes a script-tag payload in a variable', () => {
    const out = fillTemplate('<p>Hello {{name}}</p>', { name: '<script>alert(1)</script>' });
    expect(out).toBe('<p>Hello &lt;script&gt;alert(1)&lt;/script&gt;</p>');
    expect(out).not.toContain('<script>');
  });
  test('escapes an onerror img payload', () => {
    const out = fillTemplate('<p>{{n}}</p>', { n: '<img src=x onerror="evil()">' });
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });
  test('preserves placeholder when key is absent', () => {
    expect(fillTemplate('Hello {{missing}}!', {})).toBe('Hello {{missing}}!');
  });
  test('does NOT escape the template HTML itself (HR-authored)', () => {
    const out = fillTemplate('<b>{{n}}</b>', { n: 'safe' });
    expect(out).toBe('<b>safe</b>');
  });
});
