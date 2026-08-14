'use strict';

/**
 * findUnique must be called with a COMPLETE unique key.
 *
 * Multi-tenancy turned many single-column unique keys into composites —
 * `@@unique([tenantId, period])`, `@@unique([tenantId, code])`, and so on — but
 * the call sites kept passing the old single column. Prisma rejects that at
 * runtime:
 *
 *   Argument `where` of type XWhereUniqueInput needs at least one of ...
 *
 * 25 production call sites were doing this. It reached CI as HTTP 500 on every
 * payroll compute, and the unit suites were blind to it because they mock the
 * Prisma client: a mock happily answers findUnique with whatever the test
 * queued, so an invalid query looks perfectly healthy right up until it meets a
 * real database.
 *
 * The auto-scoping extension adds tenantId to the where-clause, which makes
 * findFirst correct and sufficient — it takes a filter rather than a key.
 */
const fs = require('fs');
const path = require('path');
const glob = require('glob');

const ROOT = path.join(__dirname, '..', '..');

/** model name (camelCase) -> composite unique fields, per service. */
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

describe('findUnique is never called with a partial unique key', () => {
  const composites = compositeKeys();

  it('found composite keys to check — not vacuously empty', () => {
    const count = Object.values(composites).reduce((n, m) => n + Object.keys(m).length, 0);
    expect(count).toBeGreaterThan(10);
  });

  it('has no call site passing only part of a composite key', () => {
    const offenders = [];
    for (const file of glob.sync('services/*/src/**/*.js', { cwd: ROOT })) {
      const svc = file.split('/')[1];
      if (!composites[svc]) continue;
      const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
      const re = /prisma\.(\w+)\.findUnique\(\{\s*where:\s*\{([^}]*)\}/g;
      let m;
      while ((m = re.exec(src)) !== null) {
        const [, model, where] = m;
        const comp = composites[svc][model];
        if (!comp) continue;
        const keys = where.split(',').map((k) => k.trim().split(':')[0].trim()).filter(Boolean);
        if (keys.length === 1 && keys[0] !== 'id' && comp.includes(keys[0])) {
          const line = src.slice(0, m.index).split('\n').length;
          offenders.push(`${file}:${line} — ${model}.findUnique by '${keys[0]}', key is [${comp}]`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
