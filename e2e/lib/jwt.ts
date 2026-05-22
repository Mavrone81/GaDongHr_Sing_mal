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
}

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
  };
  const expiresIn = opts.expiresIn ?? '60m';
  const payloadJson = JSON.stringify(payload).replace(/'/g, "\\'");
  const script = `
    const jwt = require('jsonwebtoken');
    const fs = require('fs');
    const key = fs.readFileSync('/app/certs/private.pem');
    process.stdout.write(jwt.sign(${payloadJson}, key, { algorithm: 'RS256', issuer: 'ezyhRM', expiresIn: '${expiresIn}' }));
  `.trim().replace(/\n+/g, ' ');
  return execSync(`docker exec hrms-auth node -e "${script.replace(/"/g, '\\"')}"`).toString().trim();
}
