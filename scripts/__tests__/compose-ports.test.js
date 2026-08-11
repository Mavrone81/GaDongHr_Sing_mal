'use strict';

/**
 * No two compose services may publish the same host port.
 *
 * `statutory-my-service` was given host 4022, which benefits-service already
 * published (mapped to its container 4016). Docker starts containers
 * concurrently, so the symptom was not "the new service is broken" — it was the
 * WHOLE STACK failing to boot, with the error attributed to whichever container
 * happened to lose the race:
 *
 *   Error response from daemon: failed to set up container networking ...
 *   Bind for 127.0.0.1:4022 failed: port is already allocated   (hrms-benefits)
 *
 * Nothing in the unit suites can see this; it only appears when the stack is
 * actually brought up, which is the e2e job — the slowest and last thing to run.
 * A second's check here is worth a CI cycle.
 */
const fs = require('fs');
const path = require('path');

const COMPOSE = fs.readFileSync(
  path.join(__dirname, '..', '..', 'docker-compose.yml'), 'utf8');

/** Matches `- "127.0.0.1:${FOO_PORT:-4022}:4016"` and the plain `4022:4016` form. */
const PUBLISH = /-\s*"(?:127\.0\.0\.1:)?(?:\$\{[A-Z_]+:-(\d+)\}|(\d+)):(\d+)"/g;

function hostPorts() {
  const seen = new Map(); // host port -> count
  for (const m of COMPOSE.matchAll(PUBLISH)) {
    const host = Number(m[1] ?? m[2]);
    seen.set(host, (seen.get(host) ?? 0) + 1);
  }
  return seen;
}

describe('docker-compose host ports', () => {
  it('finds published ports — the check is not vacuously empty', () => {
    expect(hostPorts().size).toBeGreaterThan(10);
  });

  it('publishes each host port exactly once', () => {
    const clashes = [...hostPorts().entries()]
      .filter(([, n]) => n > 1)
      .map(([port, n]) => `host port ${port} published by ${n} services`);
    expect(clashes).toEqual([]);
  });
});
