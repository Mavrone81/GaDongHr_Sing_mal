/**
 * JWT factory: mint tokens signed with the auth-service's private key, so they
 * verify cleanly against the gateway's public key. Used to skip real /login in
 * tests that aren't specifically testing the login flow.
 *
 * Requires `docker exec hrms-auth ...` to read the in-container private key.
 */

import { execSync } from 'child_process';
import { ROLE_PERMS, Role } from './roles';

export interface TestUser {
  id: string;       // matches users.id in hrms_auth
  email: string;
  employeeId?: string | null;
  tenantId?: string;
}

/**
 * The fixed "Default" tenant that seed-default-tenant.js creates, and that every
 * seeded user and employee belongs to.
 */
export const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';

export interface TokenOptions {
  expiresIn?: string;
}

let cachedPrivateKey: string | null = null;

function readPrivateKey(): string {
  if (cachedPrivateKey) return cachedPrivateKey;
  cachedPrivateKey = execSync('docker exec hrms-auth cat /app/certs/private.pem').toString();
  return cachedPrivateKey;
}

/** Sign a JWT inside the auth-service container (has node + jsonwebtoken). */
export function signJwt(user: TestUser, role: Role, opts: TokenOptions = {}): string {
  const payload = {
    sub: user.id,
    email: user.email,
    role,
    employeeId: user.employeeId ?? null,
    permissions: ROLE_PERMS[role],
    // Real login tokens carry tenantId (auth.routes.js signs it into every
    // access token), so a minted test token must too or it is not standing in
    // for the thing it claims to replace.
    //
    // Most endpoints did not notice: shared/auth-middleware falls back to the
    // Default tenant when a token has none, for back-compat with tokens issued
    // before multi-tenancy. But entities.routes.js reads req.user.tenantId
    // directly and 403s without it, which is why every payroll spec failed with
    // "Could not list legal entities (403)" once they started resolving a legal
    // entity. That divergence between the two is worth knowing about.
    tenantId: user.tenantId ?? DEFAULT_TENANT_ID,
  };
  const expiresIn = opts.expiresIn ?? '60m';
  const payloadJson = JSON.stringify(payload).replace(/'/g, "\\'");
  const script = `
    const jwt = require('jsonwebtoken');
    const fs = require('fs');
    const key = fs.readFileSync('/app/certs/private.pem');
    process.stdout.write(jwt.sign(${payloadJson}, key, { algorithm: 'RS256', issuer: 'gadonghr', expiresIn: '${expiresIn}' }));
  `.trim().replace(/\n+/g, ' ');
  return execSync(`docker exec hrms-auth node -e "${script.replace(/"/g, '\\"')}"`).toString().trim();
}
