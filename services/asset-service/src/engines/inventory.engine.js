'use strict';
// Pure logic for AST-002 inventory & purchase-request decisions.

/**
 * True when an item's current stock has dropped to or below its reorder point.
 */
function isLowStock(item) {
  if (!item || !item.isActive) return false;
  const cur = parseInt(item.currentStock, 10);
  const rp  = parseInt(item.reorderPoint, 10);
  if (!isFinite(cur) || !isFinite(rp)) return false;
  return cur <= rp;
}

/**
 * Suggested reorder quantity. Falls back to bringing stock to 2× reorder point
 * when reorderQty is unset.
 */
function computeReorderQty(item) {
  const rq = parseInt(item.reorderQty, 10);
  if (isFinite(rq) && rq > 0) return rq;
  const rp = parseInt(item.reorderPoint, 10);
  const cur = parseInt(item.currentStock, 10);
  if (isFinite(rp) && isFinite(cur)) return Math.max(rp * 2 - cur, rp);
  return 1;
}

/**
 * Apply a stock transaction and return the resulting stock level.
 * RECEIVE → +qty   ISSUE → −qty   ADJUST → +qty (caller supplies signed value)
 * Throws if the resulting stock would be negative.
 */
function applyStockTransaction(currentStock, txType, quantity) {
  const cur = parseInt(currentStock, 10);
  let qty = parseInt(quantity, 10);
  if (!isFinite(cur) || !isFinite(qty)) throw new Error('Invalid numeric input');

  let delta;
  switch (txType) {
    case 'RECEIVE':
      if (qty <= 0) throw new Error('RECEIVE quantity must be positive');
      delta = qty;
      break;
    case 'ISSUE':
      if (qty <= 0) throw new Error('ISSUE quantity must be positive');
      delta = -qty;
      break;
    case 'ADJUST':
      delta = qty;             // signed
      break;
    default:
      throw new Error(`Unknown txType: ${txType}`);
  }

  const next = cur + delta;
  if (next < 0) throw new Error(`Stock cannot go negative (current=${cur}, delta=${delta})`);
  return next;
}

/**
 * Decision: should the system auto-create a PR for this item?
 * - item must be active, low-stock
 * - no DRAFT/SUBMITTED/APPROVED/ORDERED PR already exists for this SKU
 */
function shouldAutoCreatePr(item, openPrCount = 0) {
  if (!isLowStock(item)) return false;
  if (openPrCount > 0) return false;
  return true;
}

module.exports = {
  isLowStock,
  computeReorderQty,
  applyStockTransaction,
  shouldAutoCreatePr,
};
