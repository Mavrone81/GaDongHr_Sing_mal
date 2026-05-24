'use strict';

const {
  validate, applyFilter, applyFilters, aggregate, applyGroupBy,
  applySort, projectFields, execute, getField,
} = require('../src/engines/query-executor.engine');

describe('query-executor.engine', () => {
  describe('validate', () => {
    test('rejects unknown dataSource', () => {
      const errs = validate({ dataSource: 'unicorns' });
      expect(errs.some(e => /dataSource/.test(e))).toBe(true);
    });
    test('rejects unknown filter op', () => {
      const errs = validate({ dataSource: 'employees', filters: [{ field: 'x', op: 'xxx' }] });
      expect(errs.some(e => /filters\[0\]\.op/.test(e))).toBe(true);
    });
    test('rejects filter op=in without array value', () => {
      const errs = validate({ dataSource: 'employees', filters: [{ field: 'x', op: 'in', value: 5 }] });
      expect(errs.some(e => /op=in/.test(e))).toBe(true);
    });
    test('rejects aggregation without "as"', () => {
      const errs = validate({ dataSource: 'employees', aggregations: [{ op: 'count' }] });
      expect(errs.some(e => /aggregations\[0\]\.as/.test(e))).toBe(true);
    });
    test('rejects sum/avg/etc without field', () => {
      const errs = validate({ dataSource: 'employees', aggregations: [{ op: 'sum', as: 'total' }] });
      expect(errs.some(e => /op=sum/.test(e))).toBe(true);
    });
    test('accepts a valid definition', () => {
      const errs = validate({
        dataSource: 'employees',
        fields: [{ key: 'department' }],
        filters: [{ field: 'isActive', op: 'eq', value: true }],
        groupBy: 'department',
        aggregations: [{ op: 'count', as: 'headcount' }],
        sortBy: [{ field: 'department', dir: 'asc' }],
        limit: 100,
      });
      expect(errs).toEqual([]);
    });
  });

  describe('getField', () => {
    test('reads dotted paths', () => {
      expect(getField({ leaveType: { name: 'Annual' } }, 'leaveType.name')).toBe('Annual');
    });
    test('returns undefined for missing intermediate', () => {
      expect(getField({}, 'a.b.c')).toBeUndefined();
    });
  });

  describe('applyFilter', () => {
    test('eq/ne/gt/lt/gte/lte', () => {
      const r = { age: 30 };
      expect(applyFilter(r, { field: 'age', op: 'eq', value: 30 })).toBe(true);
      expect(applyFilter(r, { field: 'age', op: 'ne', value: 30 })).toBe(false);
      expect(applyFilter(r, { field: 'age', op: 'gt', value: 25 })).toBe(true);
      expect(applyFilter(r, { field: 'age', op: 'lt', value: 25 })).toBe(false);
      expect(applyFilter(r, { field: 'age', op: 'gte', value: 30 })).toBe(true);
      expect(applyFilter(r, { field: 'age', op: 'lte', value: 30 })).toBe(true);
    });
    test('in', () => {
      expect(applyFilter({ x: 'a' }, { field: 'x', op: 'in', value: ['a', 'b'] })).toBe(true);
      expect(applyFilter({ x: 'c' }, { field: 'x', op: 'in', value: ['a', 'b'] })).toBe(false);
    });
    test('contains is case-insensitive', () => {
      expect(applyFilter({ name: 'Hello World' }, { field: 'name', op: 'contains', value: 'WORLD' })).toBe(true);
      expect(applyFilter({ name: 'Hello' }, { field: 'name', op: 'contains', value: 'world' })).toBe(false);
    });
    test('contains returns false for non-strings', () => {
      expect(applyFilter({ name: 42 }, { field: 'name', op: 'contains', value: '4' })).toBe(false);
    });
  });

  describe('aggregate', () => {
    test('count', () => {
      expect(aggregate([1, 2, 3], 'count')).toBe(3);
    });
    test('sum / avg / min / max ignore null/NaN', () => {
      const rows = [{ v: 10 }, { v: 20 }, { v: null }, { v: 'abc' }];
      expect(aggregate(rows, 'sum', 'v')).toBe(30);
      expect(aggregate(rows, 'avg', 'v')).toBe(15);
      expect(aggregate(rows, 'min', 'v')).toBe(10);
      expect(aggregate(rows, 'max', 'v')).toBe(20);
    });
    test('returns null for empty numeric set', () => {
      expect(aggregate([{ v: null }], 'sum', 'v')).toBeNull();
    });
  });

  describe('applyGroupBy', () => {
    test('groups by field with count + sum aggregations', () => {
      const rows = [
        { dept: 'ENG', salary: 5000 },
        { dept: 'ENG', salary: 6000 },
        { dept: 'OPS', salary: 4000 },
      ];
      const out = applyGroupBy(rows, 'dept', [
        { op: 'count', as: 'headcount' },
        { op: 'sum', field: 'salary', as: 'totalSalary' },
      ]);
      const eng = out.find(r => r.dept === 'ENG');
      const ops = out.find(r => r.dept === 'OPS');
      expect(eng).toMatchObject({ dept: 'ENG', headcount: 2, totalSalary: 11000 });
      expect(ops).toMatchObject({ dept: 'OPS', headcount: 1, totalSalary: 4000 });
    });
    test('handles null group key', () => {
      const out = applyGroupBy([{ dept: null }, { dept: null }], 'dept', [{ op: 'count', as: 'n' }]);
      expect(out).toHaveLength(1);
      expect(out[0].n).toBe(2);
    });
  });

  describe('applySort', () => {
    test('multi-field sort with mixed directions', () => {
      const rows = [
        { dept: 'A', headcount: 5 },
        { dept: 'A', headcount: 10 },
        { dept: 'B', headcount: 3 },
      ];
      const out = applySort(rows, [
        { field: 'dept', dir: 'asc' },
        { field: 'headcount', dir: 'desc' },
      ]);
      expect(out.map(r => `${r.dept}-${r.headcount}`)).toEqual(['A-10', 'A-5', 'B-3']);
    });
    test('null sorts last in both asc and desc', () => {
      const rows = [{ x: 1 }, { x: null }, { x: 2 }];
      expect(applySort(rows, [{ field: 'x', dir: 'asc' }]).map(r => r.x)).toEqual([1, 2, null]);
      expect(applySort(rows, [{ field: 'x', dir: 'desc' }]).map(r => r.x)).toEqual([2, 1, null]);
    });
  });

  describe('projectFields', () => {
    test('drops fields not in the field list, supports dotted paths', () => {
      const rows = [{ a: 1, b: 2, c: { d: 3 }, secret: 'no' }];
      const out = projectFields(rows, [{ key: 'a' }, { key: 'c.d' }]);
      expect(out).toEqual([{ a: 1, 'c.d': 3 }]);
    });
  });

  describe('execute (integration of all stages)', () => {
    const employees = [
      { id: '1', department: 'ENG', isActive: true, basicSalary: 5000 },
      { id: '2', department: 'ENG', isActive: true, basicSalary: 6000 },
      { id: '3', department: 'OPS', isActive: false, basicSalary: 4000 },
      { id: '4', department: 'OPS', isActive: true, basicSalary: 4500 },
    ];

    test('filter + group + sort + limit', () => {
      const out = execute(employees, {
        dataSource: 'employees',
        filters: [{ field: 'isActive', op: 'eq', value: true }],
        groupBy: 'department',
        aggregations: [
          { op: 'count', as: 'headcount' },
          { op: 'sum', field: 'basicSalary', as: 'totalSalary' },
        ],
        sortBy: [{ field: 'totalSalary', dir: 'desc' }],
      });
      expect(out.rows).toHaveLength(2);
      expect(out.rows[0]).toMatchObject({ department: 'ENG', headcount: 2, totalSalary: 11000 });
      expect(out.rows[1]).toMatchObject({ department: 'OPS', headcount: 1, totalSalary: 4500 });
      expect(out.totalRows).toBe(2);
    });

    test('no groupBy → returns projected rows in source order', () => {
      const out = execute(employees, {
        dataSource: 'employees',
        fields: [{ key: 'id' }, { key: 'department', label: 'Dept' }],
      });
      expect(out.rows).toEqual([
        { id: '1', department: 'ENG' },
        { id: '2', department: 'ENG' },
        { id: '3', department: 'OPS' },
        { id: '4', department: 'OPS' },
      ]);
      expect(out.columns.find(c => c.key === 'department').label).toBe('Dept');
    });

    test('throws 400-like error for invalid definition', () => {
      expect(() => execute(employees, { dataSource: 'unknown' })).toThrow(/Invalid report definition/);
    });

    test('limit caps row count, totalRows reflects pre-limit count', () => {
      const out = execute(employees, {
        dataSource: 'employees', limit: 2,
      });
      expect(out.rows).toHaveLength(2);
      expect(out.totalRows).toBe(4);
    });
  });
});
