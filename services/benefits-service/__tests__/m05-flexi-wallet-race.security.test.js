'use strict';
/**
 * M-05 — flexi-wallet auto-approve path uses an atomic conditional UPDATE
 * via $executeRaw, so concurrent claims cannot overspend the wallet.
 */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');

describe('M-05 atomic flexi-wallet auto-approve', () => {
  test('handler uses prisma.$executeRaw with conditional WHERE used_amount + amt <= credited_amount', () => {
    const start = src.indexOf("/benefits/flexi-claims'");
    const slice = src.slice(start, start + 4000);
    expect(slice).toMatch(/prisma\.\$executeRaw`/);
    expect(slice).toMatch(/UPDATE flexi_wallets/);
    expect(slice).toMatch(/used_amount \+ \$\{amt\} <= credited_amount/);
  });
  test('handler returns 409 when conditional update returns count=0', () => {
    const start = src.indexOf("/benefits/flexi-claims'");
    const slice = src.slice(start, start + 4000);
    expect(slice).toMatch(/Number\(r\)\s*===\s*0[\s\S]+?409/);
  });
});
