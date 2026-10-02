'use strict';

/**
 * Every DB-backed test suite is claimed by exactly one job.
 *
 * There are two jobs. The unit job (`test:backend`) has no database and
 * EXCLUDES these suites by path pattern. The DB-backed job
 * (`scripts/dev/test-isolation.sh`) stands up Postgres and runs them. A suite
 * must land in exactly one — and the failure that prompted this guard was a
 * suite landing in NEITHER:
 *
 *   - 5 of 10 `tenant-isolation.test.js` suites (asset, claims, notification,
 *     offboarding, recruitment) were excluded from the unit job because they
 *     need a database, and never reached by the DB-backed job because its
 *     service list was hardcoded to five. They ran nowhere. The runner then
 *     printed "all services passed", which was true of the five it ran.
 *   - Then the compound-unique work introduced `*-tenant-unique.integration`,
 *     which the unit job did NOT exclude, so 7 DB-backed suites failed there
 *     instead — the same mismatch pointing the other way.
 *
 * Neither was a bug in any test. Both were a routing gap, and a routing gap is
 * invisible precisely because each job is individually behaving correctly.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const DB_BACKED = /(tenant-isolation|db-contract|tenant-unique)/;

function dbBackedSuites() {
  return execSync("git ls-files -- 'services/*/__tests__/*'", { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((f) => f && DB_BACKED.test(f) && /\.test\.js$/.test(f));
}

/** Pure: which of these suites would the unit job still run? */
function notExcludedFromUnitJob(suites, unitScript) {
  const ignores = [...unitScript.matchAll(/--testPathIgnorePatterns=(\S+)/g)].map((m) => m[1]);
  return suites.filter((s) => !ignores.some((ig) => s.includes(ig)));
}

/** Pure: which of these suites' services would the DB-backed runner not reach? */
function unreachableByDbJob(suites, runnerSrc) {
  // The runner must discover services, not name them.
  const hardcoded = /SERVICES=\(\s*auth\s+employee/.test(runnerSrc);
  if (hardcoded) return suites; // a named list cannot be reasoned about: treat all as at risk
  const pattern = /tenant-isolation\|db-contract\|tenant-unique/.test(runnerSrc);
  return pattern ? [] : suites;
}

describe('every DB-backed suite is claimed by exactly one job', () => {
  const suites = dbBackedSuites();
  const unitScript = require(path.join(ROOT, 'package.json')).scripts['test:backend'];
  const runnerSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'dev', 'test-isolation.sh'), 'utf8');

  it('found DB-backed suites to reason about — not vacuously empty', () => {
    expect(suites.length).toBeGreaterThan(10);
  });

  it('the unit job excludes all of them (it has no database)', () => {
    expect(notExcludedFromUnitJob(suites, unitScript)).toEqual([]);
  });

  it('the DB-backed runner discovers services dynamically, not from a hardcoded list', () => {
    expect(/SERVICES=\(\s*auth\s+employee/.test(runnerSrc)).toBe(false);
    expect(runnerSrc).toMatch(/git ls-files/);
  });

  it('the DB-backed runner matches all three DB-backed naming conventions', () => {
    expect(unreachableByDbJob(suites, runnerSrc)).toEqual([]);
  });

  it('CONTROL: a suite excluded from neither job is detected', () => {
    const orphan = 'services/made-up-service/__tests__/thing-tenant-unique.integration.test.js';
    // Against a unit script with no tenant-unique exclusion, the orphan surfaces.
    const weakScript = 'jest --testPathIgnorePatterns=/node_modules/';
    expect(notExcludedFromUnitJob([orphan], weakScript)).toEqual([orphan]);
    // And against the real script it does not.
    expect(notExcludedFromUnitJob([orphan], unitScript)).toEqual([]);
  });

  it('CONTROL: a hardcoded runner is detected as unsafe', () => {
    const bad = 'SERVICES=(auth employee payroll leave attendance)';
    expect(unreachableByDbJob(['x'], bad)).toEqual(['x']);
  });
});
