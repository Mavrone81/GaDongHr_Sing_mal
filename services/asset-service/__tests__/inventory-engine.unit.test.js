'use strict';
/**
 * Unit tests for src/engines/inventory.engine.js (AST-002)
 */

const { isLowStock, computeReorderQty, applyStockTransaction, shouldAutoCreatePr } = require('../src/engines/inventory.engine');

describe('isLowStock', () => {
  test('true when currentStock equals reorderPoint', () => {
    expect(isLowStock({ isActive: true, currentStock: 5, reorderPoint: 5 })).toBe(true);
  });
  test('true when currentStock below reorderPoint', () => {
    expect(isLowStock({ isActive: true, currentStock: 2, reorderPoint: 5 })).toBe(true);
  });
  test('false when currentStock above reorderPoint', () => {
    expect(isLowStock({ isActive: true, currentStock: 10, reorderPoint: 5 })).toBe(false);
  });
  test('false for inactive items', () => {
    expect(isLowStock({ isActive: false, currentStock: 0, reorderPoint: 5 })).toBe(false);
  });
  test('false for invalid inputs', () => {
    expect(isLowStock(null)).toBe(false);
    expect(isLowStock({ isActive: true, currentStock: 'abc', reorderPoint: 5 })).toBe(false);
  });
});

describe('computeReorderQty', () => {
  test('uses reorderQty when set', () => {
    expect(computeReorderQty({ reorderQty: 50, reorderPoint: 10, currentStock: 5 })).toBe(50);
  });
  test('falls back to 2× reorderPoint − currentStock', () => {
    expect(computeReorderQty({ reorderQty: 0, reorderPoint: 10, currentStock: 3 })).toBe(17);
  });
  test('floor at reorderPoint', () => {
    expect(computeReorderQty({ reorderQty: 0, reorderPoint: 10, currentStock: 20 })).toBe(10);
  });
  test('defaults to 1 when nothing set', () => {
    expect(computeReorderQty({})).toBe(1);
  });
});

describe('applyStockTransaction', () => {
  test('RECEIVE adds quantity', () => {
    expect(applyStockTransaction(10, 'RECEIVE', 5)).toBe(15);
  });
  test('ISSUE subtracts quantity', () => {
    expect(applyStockTransaction(10, 'ISSUE', 3)).toBe(7);
  });
  test('ADJUST honours signed value', () => {
    expect(applyStockTransaction(10, 'ADJUST', -4)).toBe(6);
    expect(applyStockTransaction(10, 'ADJUST', 3)).toBe(13);
  });
  test('throws on negative resulting stock', () => {
    expect(() => applyStockTransaction(5, 'ISSUE', 10)).toThrow(/negative/);
  });
  test('throws on RECEIVE with negative quantity', () => {
    expect(() => applyStockTransaction(10, 'RECEIVE', -5)).toThrow(/positive/);
  });
  test('throws on ISSUE with negative quantity', () => {
    expect(() => applyStockTransaction(10, 'ISSUE', -5)).toThrow(/positive/);
  });
  test('throws on unknown txType', () => {
    expect(() => applyStockTransaction(10, 'STEAL', 5)).toThrow(/Unknown/);
  });
});

describe('shouldAutoCreatePr', () => {
  test('true when low-stock and no open PR', () => {
    expect(shouldAutoCreatePr({ isActive: true, currentStock: 2, reorderPoint: 5 }, 0)).toBe(true);
  });
  test('false when open PR already exists', () => {
    expect(shouldAutoCreatePr({ isActive: true, currentStock: 2, reorderPoint: 5 }, 1)).toBe(false);
  });
  test('false when not low-stock', () => {
    expect(shouldAutoCreatePr({ isActive: true, currentStock: 10, reorderPoint: 5 }, 0)).toBe(false);
  });
});
