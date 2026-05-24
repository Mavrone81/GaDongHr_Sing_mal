'use strict';

const { escapeCell, toCsv } = require('../src/engines/csv');

describe('csv', () => {
  describe('escapeCell', () => {
    test('null → empty', () => expect(escapeCell(null)).toBe(''));
    test('undefined → empty', () => expect(escapeCell(undefined)).toBe(''));
    test('plain string unchanged', () => expect(escapeCell('hello')).toBe('hello'));
    test('quotes string with comma', () => expect(escapeCell('a,b')).toBe('"a,b"'));
    test('escapes embedded quotes', () => expect(escapeCell('say "hi"')).toBe('"say ""hi"""'));
    test('quotes newlines', () => expect(escapeCell('line1\nline2')).toBe('"line1\nline2"'));
    test('serializes objects as JSON', () => expect(escapeCell({ a: 1 })).toBe('"{""a"":1}"'));
    test('serializes Date as ISO', () => {
      const d = new Date('2026-05-24T08:00:00Z');
      expect(escapeCell(d)).toBe('2026-05-24T08:00:00.000Z');
    });
  });

  describe('toCsv', () => {
    test('empty rows → header only', () => {
      const out = toCsv([{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }], []);
      expect(out).toBe('A,B\n');
    });
    test('writes header + rows', () => {
      const out = toCsv(
        [{ key: 'name' }, { key: 'salary' }],
        [{ name: 'Alice', salary: 5000 }, { name: 'Bob, Jr.', salary: 4500 }],
      );
      expect(out).toBe('name,salary\nAlice,5000\n"Bob, Jr.",4500\n');
    });
    test('missing field → empty cell', () => {
      const out = toCsv([{ key: 'a' }, { key: 'b' }], [{ a: 1 }]);
      expect(out).toBe('a,b\n1,\n');
    });
  });
});
