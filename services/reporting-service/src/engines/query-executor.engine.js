'use strict';
/**
 * RPT-003 Phase 1 — query executor.
 *
 * Takes a template definition and a row source (an async fetch callback that
 * returns the raw rows for the named dataSource) and returns the final rows
 * after filter/group/sort/limit.
 *
 *   definition = {
 *     dataSource:   "employees" | "payrollRuns" | "leaveApplications" | "attendance" | "claims",
 *     fields:       [{ key: "department", label: "Dept" }] | undefined  // undefined = return all fields
 *     filters:      [{ field, op, value }]
 *     groupBy:      "department"                              // optional, single field
 *     aggregations: [{ field, op: "count|sum|avg|min|max", as }]
 *     sortBy:       [{ field, dir: "asc"|"desc" }]
 *     limit:        Number (default 5000, max 50000)
 *   }
 *
 * Pure functions — no Prisma, no axios. Side effects belong to the route.
 */

const DATA_SOURCES = ['employees', 'payrollRuns', 'leaveApplications', 'attendance', 'claims'];
const FILTER_OPS = ['eq', 'ne', 'gt', 'lt', 'gte', 'lte', 'in', 'contains'];
const AGG_OPS = ['count', 'sum', 'avg', 'min', 'max'];
const DEFAULT_LIMIT = 5000;
const MAX_LIMIT = 50000;

function validate(def) {
  const errors = [];
  if (!def || typeof def !== 'object') return ['definition must be an object'];
  if (!DATA_SOURCES.includes(def.dataSource)) {
    errors.push(`dataSource must be one of: ${DATA_SOURCES.join(', ')}`);
  }
  if (def.filters !== undefined) {
    if (!Array.isArray(def.filters)) errors.push('filters must be an array');
    else def.filters.forEach((f, i) => {
      if (!f.field) errors.push(`filters[${i}].field required`);
      if (!FILTER_OPS.includes(f.op)) errors.push(`filters[${i}].op must be one of: ${FILTER_OPS.join(', ')}`);
      if (f.op === 'in' && !Array.isArray(f.value)) errors.push(`filters[${i}].value must be array when op=in`);
    });
  }
  if (def.aggregations !== undefined) {
    if (!Array.isArray(def.aggregations)) errors.push('aggregations must be an array');
    else def.aggregations.forEach((a, i) => {
      if (!AGG_OPS.includes(a.op)) errors.push(`aggregations[${i}].op must be one of: ${AGG_OPS.join(', ')}`);
      if (a.op !== 'count' && !a.field) errors.push(`aggregations[${i}].field required for op=${a.op}`);
      if (!a.as) errors.push(`aggregations[${i}].as required`);
    });
  }
  if (def.sortBy !== undefined) {
    if (!Array.isArray(def.sortBy)) errors.push('sortBy must be an array');
    else def.sortBy.forEach((s, i) => {
      if (!s.field) errors.push(`sortBy[${i}].field required`);
      if (s.dir && !['asc', 'desc'].includes(s.dir)) errors.push(`sortBy[${i}].dir must be asc or desc`);
    });
  }
  if (def.limit !== undefined && (!Number.isFinite(def.limit) || def.limit <= 0)) {
    errors.push('limit must be a positive number');
  }
  return errors;
}

function getField(row, field) {
  // Support dotted paths: leaveType.name
  if (field.indexOf('.') === -1) return row[field];
  return field.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), row);
}

function applyFilter(row, filter) {
  const v = getField(row, filter.field);
  switch (filter.op) {
    case 'eq': return v === filter.value;
    case 'ne': return v !== filter.value;
    case 'gt': return v != null && v > filter.value;
    case 'lt': return v != null && v < filter.value;
    case 'gte': return v != null && v >= filter.value;
    case 'lte': return v != null && v <= filter.value;
    case 'in': return Array.isArray(filter.value) && filter.value.includes(v);
    case 'contains':
      return typeof v === 'string' && v.toLowerCase().includes(String(filter.value).toLowerCase());
    default: return true;
  }
}

function applyFilters(rows, filters) {
  if (!filters || filters.length === 0) return rows;
  return rows.filter(r => filters.every(f => applyFilter(r, f)));
}

function aggregate(rows, op, field) {
  if (op === 'count') return rows.length;
  const vals = rows
    .map(r => getField(r, field))
    .filter(v => v != null && !Number.isNaN(Number(v)))
    .map(Number);
  if (vals.length === 0) return null;
  switch (op) {
    case 'sum': return vals.reduce((s, v) => s + v, 0);
    case 'avg': return vals.reduce((s, v) => s + v, 0) / vals.length;
    case 'min': return Math.min(...vals);
    case 'max': return Math.max(...vals);
    default: return null;
  }
}

function applyGroupBy(rows, groupBy, aggregations) {
  if (!groupBy) return rows;
  const aggs = aggregations || [];
  const groups = new Map();
  for (const row of rows) {
    const key = getField(row, groupBy);
    const k = key == null ? '__null__' : String(key);
    if (!groups.has(k)) groups.set(k, { __key: key, __rows: [] });
    groups.get(k).__rows.push(row);
  }
  const out = [];
  for (const [, g] of groups) {
    const aggRow = { [groupBy]: g.__key };
    for (const a of aggs) {
      aggRow[a.as] = aggregate(g.__rows, a.op, a.field);
    }
    aggRow.__count = g.__rows.length;
    out.push(aggRow);
  }
  return out;
}

function applySort(rows, sortBy) {
  if (!sortBy || sortBy.length === 0) return rows;
  return [...rows].sort((a, b) => {
    for (const s of sortBy) {
      const av = getField(a, s.field);
      const bv = getField(b, s.field);
      if (av === bv) continue;
      // Null sorts last regardless of direction
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = av < bv ? -1 : 1;
      return s.dir === 'desc' ? -cmp : cmp;
    }
    return 0;
  });
}

function projectFields(rows, fields) {
  if (!fields || fields.length === 0) return rows;
  const keys = fields.map(f => f.key);
  return rows.map(r => {
    const out = {};
    for (const k of keys) out[k] = getField(r, k);
    return out;
  });
}

/**
 * Execute a template definition against an already-fetched row set.
 *   rows: the source rows (array)
 *   definition: the validated template definition
 * Returns { columns, rows, totalRows }.
 *   - columns: the ordered column metadata (for export headers)
 *   - rows: the filtered/grouped/sorted/projected rows, capped at limit
 *   - totalRows: pre-limit row count (post-filter, post-group)
 */
function execute(rows, definition) {
  const errors = validate(definition);
  if (errors.length > 0) {
    throw Object.assign(new Error('Invalid report definition: ' + errors.join('; ')), { errors, status: 400 });
  }
  const limit = Math.min(MAX_LIMIT, Math.max(1, definition.limit || DEFAULT_LIMIT));

  let working = applyFilters(rows, definition.filters);
  working = applyGroupBy(working, definition.groupBy, definition.aggregations);
  working = applySort(working, definition.sortBy);
  const totalRows = working.length;
  working = working.slice(0, limit);

  // Decide column metadata for export. Group-by output has known keys.
  let columns;
  if (definition.groupBy) {
    columns = [
      { key: definition.groupBy, label: definition.groupBy },
      ...((definition.aggregations || []).map(a => ({ key: a.as, label: a.as }))),
      { key: '__count', label: 'rowCount' },
    ];
  } else if (definition.fields && definition.fields.length > 0) {
    columns = definition.fields.map(f => ({ key: f.key, label: f.label || f.key }));
    working = projectFields(working, definition.fields);
  } else {
    // Fallback: use the keys from the first row
    const sample = working[0] || rows[0] || {};
    columns = Object.keys(sample).map(k => ({ key: k, label: k }));
  }

  return { columns, rows: working, totalRows, limit };
}

module.exports = {
  DATA_SOURCES, FILTER_OPS, AGG_OPS, DEFAULT_LIMIT, MAX_LIMIT,
  validate, getField, applyFilter, applyFilters,
  aggregate, applyGroupBy, applySort, projectFields, execute,
};
