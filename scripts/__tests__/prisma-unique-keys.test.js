'use strict';

/**
 * A single-record Prisma call must pass a COMPLETE unique key.
 *
 * Multi-tenancy turned many single-column uniques into composites —
 * `@@unique([tenantId, period])`, `@@unique([tenantId, candidateId])` — but call
 * sites kept passing the old single column. Prisma rejects that at the client
 * layer, before SQL:
 *
 *   Argument `where` of type XWhereUniqueInput needs at least one of ...
 *
 * These are not silent data bugs: they throw on every call. The unit suites are
 * blind to them because they mock the Prisma client, and a `jest.fn()` happily
 * accepts any `where` shape — so an invalid query looks healthy right up until
 * it meets a real database.
 *
 * ── Why this file was rewritten, 2026-10-02 (T2(L)-DevLead) ──────────────────
 * The previous version of this guard passed, reporting ZERO offenders, while
 * SEVENTEEN broken call sites were live on main. It had three blind spots and a
 * methodological one:
 *
 *   1. It matched only `.findUnique`, so `upsert` / `update` / `delete` — 14 of
 *      the 17 — were invisible.
 *   2. It was hardcoded to `prisma\.`, so any call on a transaction client was
 *      invisible. That is what hid the two payroll-journal sites: both are
 *      `tx.payrollJournal.findUnique(...)` inside `$transaction(async (tx) =>`.
 *   3. It could not see a STALE COMPOSITE NAME — `where: { sector_passType: {…} }`
 *      against `@@unique([tenantId, sector, passType])` is equally invalid, and
 *      reads as correct because it is shaped like a composite selector.
 *   4. Its only control asserted that the INPUTS were non-empty ("found more
 *      than 10 composite keys" — it finds 79). That proves the schema parser
 *      works. It says nothing about whether the DETECTOR fires. A control on
 *      the inputs is not a control on the detector, and a guard nobody has
 *      watched fail is not a guard.
 *
 * So the detector below is written as pure functions over source text, and is
 * exercised against known-bad and known-good fixtures that must respectively
 * fire and stay silent. If the fixtures stop failing, the suite says so.
 *
 * Binding names are deliberately NOT enumerated. The filter that makes this
 * precise is "the model has a composite unique in this service's schema", which
 * catches `prisma.`, `tx.`, `trx.`, `this.prisma.` and anything else.
 */
const fs = require('fs');
const path = require('path');
const glob = require('glob');

const ROOT = path.join(__dirname, '..', '..');

/** Single-record ops: all of them require a complete unique selector. */
const OPS = 'findUnique|findUniqueOrThrow|update|updateOrThrow|upsert|delete|deleteOrThrow';

/** `<anything>.<model>.<op>({ where: { <inner> }` — binding-agnostic. */
const CALL_RE = new RegExp(String.raw`\w+\.(\w+)\.(${OPS})\(\s*\{\s*where:\s*\{`, 'g');

/**
 * Read a balanced `{ … }` starting at `open` (the index OF the brace).
 *
 * Why not a regex: `\{([^}]*)\}` stops at the first inner brace, so a nested
 * or multi-line `where` — `where: { tenantId_period: { … } }`, or one wrapped
 * across lines — reads as EMPTY and the site is then skipped SILENTLY. A
 * detector that quietly declines to look at the hardest-shaped call sites is
 * the failure this whole file exists to stop. Found by T2(L)-DevSecOps's
 * independent brace-matching detector, which agreed on the 17 sites that exist
 * today but would not have agreed on a nested one added tomorrow.
 */
function balanced(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(open + 1, i); }
  }
  return null; // unbalanced: caller treats as unreadable rather than as empty
}
/** The composite-name form: `where: { someName: {` */
const NAMED_RE = new RegExp(String.raw`\w+\.(\w+)\.(${OPS})\(\s*\{\s*where:\s*\{\s*(\w+)\s*:\s*\{`, 'g');

/** model (camelCase) -> composite unique fields, per service. */
function compositeKeys() {
  const out = {};
  for (const schema of glob.sync('services/*/prisma/schema.prisma', { cwd: ROOT })) {
    const svc = schema.split('/')[1];
    const txt = fs.readFileSync(path.join(ROOT, schema), 'utf8');
    let model = null;
    for (const line of txt.split('\n')) {
      const m = /^model (\w+)/.exec(line);
      if (m) model = m[1];
      const u = /@@unique\(\[([^\]]+)\]/.exec(line);
      if (u && model) {
        const fields = u[1].split(',').map((f) => f.trim());
        if (fields.length > 1) {
          out[svc] = out[svc] || {};
          out[svc][model[0].toLowerCase() + model.slice(1)] = fields;
        }
      }
    }
  }
  return out;
}

/**
 * The detector. `models` maps camelCase model -> composite fields.
 * Returns a sorted list of human-readable offences found in `src`.
 */
function findOffences(src, models, label = 'src') {
  const out = [];
  const lineOf = (i) => src.slice(0, i).split('\n').length;

  for (const m of src.matchAll(CALL_RE)) {
    const [, model, op] = m;
    const comp = models[model];
    if (!comp) continue;
    // m[0] ends ON the opening brace of the where-object.
    const open = m.index + m[0].length - 1;
    const where = balanced(src, open);
    if (where === null) {
      out.push(`${label}:${lineOf(m.index)} — ${model}.${op} has an UNREADABLE where clause (unbalanced braces); refusing to pass it silently`);
      continue;
    }
    // Only consider top-level keys: split on commas that are not inside braces.
    let depth = 0, cur = '', parts = [];
    for (const ch of where) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
    }
    parts.push(cur);
    const keys = parts.map((k) => k.trim().split(':')[0].trim()).filter(Boolean);
    if (keys.length === 1 && keys[0] !== 'id' && comp.includes(keys[0])) {
      out.push(`${label}:${lineOf(m.index)} — ${model}.${op} by '${keys[0]}', key is [${comp}]`);
    }
  }
  for (const m of src.matchAll(NAMED_RE)) {
    const [, model, op, name] = m;
    const comp = models[model];
    if (!comp) continue;
    const expected = comp.join('_');
    if (name !== expected && name !== 'id') {
      out.push(`${label}:${lineOf(m.index)} — ${model}.${op} uses composite name '${name}', expected '${expected}'`);
    }
  }
  return out.sort();
}

// ── Fixtures: the detector must fire on these ────────────────────────────────
const MODELS = { attendancePeriod: ['tenantId', 'period'], drcQuota: ['tenantId', 'sector', 'passType'] };
const BAD_BARE_PRISMA = `await prisma.attendancePeriod.upsert({ where: { period }, create: {} });`;
const BAD_BARE_TX = `await tx.attendancePeriod.findUnique({ where: { period } });`;
const BAD_UPDATE = `await prisma.attendancePeriod.update({ where: { period }, data: {} });`;
const BAD_DELETE = `await trx.attendancePeriod.delete({ where: { period } });`;
const BAD_STALE_NAME = `await prisma.drcQuota.upsert({ where: { sector_passType: { sector, passType } } });`;
// ── and must stay silent on these ───────────────────────────────────────────
const OK_COMPOUND = `await prisma.attendancePeriod.upsert({ where: { tenantId_period: { tenantId, period } } });`;
const OK_BY_ID = `await prisma.attendancePeriod.update({ where: { id: row.id }, data: {} });`;
const OK_FINDFIRST = `await prisma.attendancePeriod.findFirst({ where: { period } });`;
const OK_UNKNOWN_MODEL = `await prisma.somethingElse.update({ where: { period }, data: {} });`;
// Shapes the previous regex-truncating extraction read as EMPTY and skipped:
const BAD_MULTILINE = `await prisma.attendancePeriod.update({\n  where: {\n    period,\n  },\n  data: {},\n});`;
const OK_NESTED_CORRECT = `await prisma.attendancePeriod.upsert({\n  where: {\n    tenantId_period: { tenantId, period },\n  },\n});`;

describe('the partial-unique-key detector itself works', () => {
  it('CONTROL: fires on a bare composite member via prisma.', () => {
    expect(findOffences(BAD_BARE_PRISMA, MODELS)).toHaveLength(1);
  });
  it('CONTROL: fires on a TRANSACTION client — the blind spot that hid 2 live sites', () => {
    expect(findOffences(BAD_BARE_TX, MODELS)).toHaveLength(1);
    expect(findOffences(BAD_DELETE, MODELS)).toHaveLength(1);
  });
  it('CONTROL: fires on update/upsert/delete — the blind spot that hid 14 live sites', () => {
    expect(findOffences(BAD_UPDATE, MODELS)).toHaveLength(1);
    expect(findOffences(BAD_BARE_PRISMA, MODELS)).toHaveLength(1);
  });
  it('CONTROL: fires on a STALE COMPOSITE NAME', () => {
    const hits = findOffences(BAD_STALE_NAME, MODELS);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatch(/expected 'tenantId_sector_passType'/);
  });
  it('CONTROL: fires on a MULTI-LINE bare key — the shape the old regex skipped silently', () => {
    expect(findOffences(BAD_MULTILINE, MODELS)).toHaveLength(1);
  });
  it('CONTROL: silent on a correct NESTED compound selector across lines', () => {
    expect(findOffences(OK_NESTED_CORRECT, MODELS)).toEqual([]);
  });
  it('CONTROL: silent on a correct compound selector', () => {
    expect(findOffences(OK_COMPOUND, MODELS)).toEqual([]);
  });
  it('CONTROL: silent on a primary-key selector, on findFirst, and on unknown models', () => {
    expect(findOffences(OK_BY_ID, MODELS)).toEqual([]);
    expect(findOffences(OK_FINDFIRST, MODELS)).toEqual([]);
    expect(findOffences(OK_UNKNOWN_MODEL, MODELS)).toEqual([]);
  });
});

describe('no call site passes a partial unique key', () => {
  const composites = compositeKeys();

  it('found composite keys to check — not vacuously empty', () => {
    const count = Object.values(composites).reduce((n, m) => n + Object.keys(m).length, 0);
    expect(count).toBeGreaterThan(10);
  });

  it('has no offending call site', () => {
    const offenders = [];
    for (const file of glob.sync('services/*/src/**/*.js', { cwd: ROOT })) {
      const svc = file.split('/')[1];
      if (!composites[svc]) continue;
      const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
      offenders.push(...findOffences(src, composites[svc], file));
    }
    expect(offenders).toEqual([]);
  });
});

module.exports = { findOffences, compositeKeys };
