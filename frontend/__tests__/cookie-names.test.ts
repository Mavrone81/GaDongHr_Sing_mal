/**
 * Cookie names are part of the brand surface — visible in devtools, in headers,
 * and in any audit of an acquired product.
 *
 * Renaming them normally means logging every user out, which is why it usually
 * gets deferred forever. This deployment is a fresh start with no live sessions,
 * so the rename is free here and will never be this cheap again.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const API = readFileSync(join(__dirname, '..', 'src', 'lib', 'api.ts'), 'utf8');

describe('cookie names are gadonghr-prefixed', () => {
  it('uses the gadonghr access cookie', () => {
    expect(API).toContain("'gadonghr_token'");
  });

  it('uses the gadonghr refresh cookie', () => {
    expect(API).toContain("'gadonghr_refresh'");
  });

  it('retains no vorkhive_ prefix', () => {
    expect(API).not.toMatch(/vorkhive_/);
  });
});
