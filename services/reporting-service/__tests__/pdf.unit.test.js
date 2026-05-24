'use strict';
const { toPdf } = require('../src/engines/pdf');

const COLS = [
  { key: 'name', label: 'Full Name' },
  { key: 'dept', label: 'Department' },
  { key: 'salary', label: 'Salary' },
];
const ROWS = [
  { name: 'Alice Tan', dept: 'Engineering', salary: 7500 },
  { name: 'Bob Lee',   dept: 'Operations',  salary: 5000 },
];

describe('pdf.engine', () => {
  test('P1 toPdf returns a non-empty Buffer', async () => {
    const buf = await toPdf('Test Report', COLS, ROWS);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(200);
  });

  test('P2 Buffer starts with PDF magic bytes %PDF', async () => {
    const buf = await toPdf('Magic Bytes', COLS, ROWS);
    expect(buf.slice(0, 4).toString()).toBe('%PDF');
  });

  test('P3 handles empty rows without throwing', async () => {
    const buf = await toPdf('Empty Report', COLS, []);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.slice(0, 4).toString()).toBe('%PDF');
  });

  test('P4 handles many columns (wide table) gracefully', async () => {
    const cols = Array.from({ length: 14 }, (_, i) => ({ key: `c${i}`, label: `Col ${i}` }));
    const rows = [Object.fromEntries(cols.map(c => [c.key, `v${c.key}`]))];
    const buf = await toPdf('Wide Report', cols, rows);
    expect(Buffer.isBuffer(buf)).toBe(true);
  });

  test('P5 handles large row count requiring multiple pages', async () => {
    const rows = Array.from({ length: 300 }, (_, i) => ({ name: `Emp ${i}`, dept: 'HR', salary: 4000 + i }));
    const buf = await toPdf('Long Report', COLS, rows);
    expect(Buffer.isBuffer(buf)).toBe(true);
    // Multi-page PDF is larger
    const singlePageBuf = await toPdf('Short', COLS, ROWS);
    expect(buf.length).toBeGreaterThan(singlePageBuf.length);
  });

  test('P6 handles null/undefined field values gracefully', async () => {
    const rows = [{ name: null, dept: undefined, salary: 0 }];
    await expect(toPdf('Nulls', COLS, rows)).resolves.toBeDefined();
  });
});
