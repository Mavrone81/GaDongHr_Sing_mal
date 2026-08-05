'use strict';

/**
 * No "Foo 2.js" duplicates in the tree.
 *
 * `services/auth-service/src/utils/prisma 2.js` sat in the repo for months: a
 * March-era snapshot of prisma.js taken before tenant isolation existed. It was
 * imported by nothing, so it never failed a test — but it is a working Prisma
 * client WITHOUT the auto-scoping extension. One stray import of the wrong
 * filename and a service would read across tenants with no error anywhere.
 *
 * These files come from Finder/iCloud copy collisions, which is exactly why
 * they arrive silently and get committed by `git add -A`.
 */
const { execSync } = require('child_process');

describe('the tree carries no copy-collision artifacts', () => {
  it('has no tracked file named like "Foo 2.js"', () => {
    const tracked = execSync('git ls-files -z', { encoding: 'utf8' }).split('\0').filter(Boolean);
    const offenders = tracked.filter((f) => / \d+\.[A-Za-z0-9]+$/.test(f));
    expect(offenders).toEqual([]);
  });
});
