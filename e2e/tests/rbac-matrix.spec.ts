/**
 * RBAC permission-boundary matrix.
 *
 * For every (role × endpoint) combination, expect:
 *   - 2xx when the role has the required permission/role
 *   - 403 when it doesn't
 *
 * Generated programmatically from:
 *   - e2e/lib/roles.ts        (role → perm mapping, mirror of seed-rbac.js)
 *   - e2e/lib/endpoints.ts    (endpoint → required perm/role)
 *
 * If you add an authorize() to a new route, add a row to endpoints.ts and
 * the matrix grows automatically.
 */

import { test, expect, request } from '@playwright/test';
import { ALL_ROLES, ROLE_PERMS, Role } from '../lib/roles';
import { ENDPOINTS, EndpointSpec } from '../lib/endpoints';
import { TEST_USERS } from '../lib/testUsers';
import { signJwt } from '../lib/jwt';

const API_BASE = process.env.E2E_API_URL ?? 'http://localhost:4000';

function roleSatisfies(role: Role, spec: EndpointSpec): boolean {
  if (spec.requirePerm) return ROLE_PERMS[role].includes(spec.requirePerm as any);
  if (spec.requireRole) return spec.requireRole.includes(role);
  return true; // unguarded — everyone allowed
}

test.describe('RBAC permission boundary', () => {
  // Cache one JWT per role for the whole test file
  const tokens: Record<string, string> = {};
  test.beforeAll(() => {
    for (const role of ALL_ROLES) {
      tokens[role] = signJwt(TEST_USERS[role], role);
    }
  });

  for (const spec of ENDPOINTS) {
    for (const role of ALL_ROLES) {
      const allowed = roleSatisfies(role, spec);
      const tag = allowed ? 'ALLOW' : 'DENY';

      test(`[${tag}] ${role} → ${spec.method} ${spec.path} (${spec.id})`, async () => {
        const ctx = await request.newContext({
          baseURL: API_BASE,
          extraHTTPHeaders: { Authorization: `Bearer ${tokens[role]}` },
        });

        const body = spec.body?.();
        const opts: any = { failOnStatusCode: false };
        if (body) opts.data = body;

        let res;
        switch (spec.method) {
          case 'GET':    res = await ctx.get(spec.path, opts); break;
          case 'POST':   res = await ctx.post(spec.path, opts); break;
          case 'PUT':    res = await ctx.put(spec.path, opts); break;
          case 'PATCH':  res = await ctx.patch(spec.path, opts); break;
          case 'DELETE': res = await ctx.delete(spec.path, opts); break;
        }
        const status = res.status();
        await ctx.dispose();

        if (allowed) {
          if (spec.skipAllowedAssertion) {
            // Only assert it's NOT a 403 (anything else — including 400 for missing
            // body fields — means RBAC passed).
            expect(status, `${role} should not be denied; got ${status}`).not.toBe(spec.deniedStatus ?? 403);
          } else {
            const allowedStatuses = spec.allowedStatuses ?? [200, 201, 204];
            expect(
              allowedStatuses.includes(status),
              `${role} should be allowed; expected one of ${allowedStatuses}, got ${status}`
            ).toBe(true);
          }
        } else {
          expect(status, `${role} should be denied; got ${status}`).toBe(spec.deniedStatus ?? 403);
        }
      });
    }
  }
});
