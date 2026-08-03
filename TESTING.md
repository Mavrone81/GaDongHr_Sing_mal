# Testing Policy & Plan

> **Binding policy.** Every PR that ships behavioural change must pass the
> tests below at the tier appropriate to its blast radius. Reviewers should
> not merge a PR that hasn't been run against these suites, and CI is gated
> on T0 + T1 + T2 (see `.github/workflows/pr-tests.yml`).

Last updated: 2026-05-22 (v1.1)

---

## 1. Why This Exists

We've shipped four RBAC revisions, two major leave features, and a dozen UI
tweaks in the past week alone. Without a regression net, every change risks
breaking something invisible — most dangerously, a permission leak that
silently grants access to the wrong role. This document defines the suite
that catches those.

---

## 2. Tiers

| Tier | Purpose | When it runs | Stop-ship if fails |
|---|---|---|---|
| **T0 Smoke** | Does the system boot and can each role reach its dashboard | Every PR | Yes |
| **T1 Critical Path** | Each role can do the thing they're paid to do | Every PR | Yes |
| **T2 Permission Boundary** | Each role gets the right 200/403 on every protected endpoint | Every PR | Yes |
| **T3 Edge & Negative** | Invalid input, concurrency, error recovery | Nightly | No (logs issue) |
| **T4 Non-Functional** | Perf, a11y, security baseline | Weekly + pre-release | No (logs issue) |

---

## 3. What Exists Today (Phase 1, shipped)

### Backend unit + integration — `npm run test:backend`
- ~1,477 jest tests across all services (mock-Prisma unit tier)
- Lives in `services/*/__tests__/`
- **Requires Node 20** (jest 29 hangs on Node 22+). `npm ci` (not `npm install`) for a consistent tree.
- Includes leave-service MOM compliance, employee supervisor chain,
  payroll utils, training-service, etc.

### Frontend unit — `npm run test:frontend`
- 68 jest tests + `tsc --noEmit`
- Lives in `frontend/__tests__/`

### E2E — `npm run test:e2e`
- **`tests/smoke.spec.ts`** — 11 specs: every role loads its dashboard with the right sidebar
- **`tests/rbac-matrix.spec.ts`** — 220 generated specs (11 roles × 20 endpoints; 86 ALLOW + 134 DENY)
- **`tests/auth.spec.ts`** — real `/login` flow (valid + invalid credentials)
- **`tests/employee.spec.ts`** — HR browses employee list, opens profile; staff directory cards link to profile
- **`tests/leave.spec.ts`** — apply-with-attachment → fetch detail → byte-identical download; foreign-employee 403 probe
- **`tests/training.spec.ts`** — admin creates program + materials → employee completes DOCUMENT/VIDEO/QUIZ → enrollment auto-progresses; below-passing-score keeps IN_PROGRESS; EMPLOYEE-creates-program 403; foreign-employee completes-others-enrollment 403
- **`tests/claims.spec.ts`** — employee submits → finance approves → status/timestamps; SUBMITTED-only amend guard; re-approve 400; category maxAmount enforcement (MEAL ≤ SGD 200); reject with reason; payroll-period report aggregation; EMPLOYEE/RECRUITER approve 403
- **`tests/supervisor-approval.spec.ts`** — SEQUENTIAL chain step-1 advances + step-2 finalises; out-of-order approval 403; ANY_ONE flow immediate APPROVE; non-designated LINE_MANAGER 403; HR_ADMIN bypasses chain; `/me/subordinates` returns direct reports
- **`tests/payroll.spec.ts`** — full DRAFT→compute→APPROVE→FINALISE lifecycle + CPF e-Submit file generation; **CPF Act rate matrix — one E2E per rate-table row**: SC ≤55 (20%/17%), SC 55–60 (16%/15%), SC 60–65 (10.5%/11.5%), SC 65–70 (7.5%/9%), SC 70+ (5%/7.5%, ageMax=null), PR_YEAR1 (5%/4%), PR_YEAR2 (15%/9%), FOREIGNER (0%/0%); OW ceiling SGD 8,000/month (Jan 2026); **AW annual ceiling SGD 102,000 — five scenarios**: under cap, partial cap (ytdOw), full exhaustion (ytdOw), ytdAw-only cap, OW-ceiling + AW partial cap together; **SDL Act bounds + boundaries**: floor ($2 min), linear regime, max cap ($11.25), zero-gross exemption, exact SGD 4,500 cap boundary; **EA s.20 pro-ration — four scenarios with rotating calendar**: mid-month starter (March, 31-day), mid-month leaver (February, 28/29-day leap-year-aware), short stint (June, 30-day), working-type change (November, FT → PT via terminate + rehire pattern with two employee records). Periods rotate by year per CI run (day-stable seed), so over time the formula gets tested against many different working-day counts; failures reproducible via `E2E_PAYROLL_SEED=<n>`; **EA s.38 overtime via paycode** (3 tests): OT_PAY component flows into effective OW + CPF base; OT + basic above SGD 6,800 ceiling → CPF capped; OIL (Off-In-Lieu, non-CPF OW paycode) adds to gross but escapes CPF base (pins `isCpfApplicable=false` branch); **DEDUCTION + REIMBURSEMENT paycodes** (3 tests): STAFF_LOAN deducts from net only (gross + CPF unchanged); `Math.abs()` semantics — negative entries still deduct; MED_REIMB adds to net only (IRAS: reimbursements not taxable, not CPF-able); mixed OT + loan + reimbursement in one payslip — all five compute-loop branches active without cross-contamination; duplicate-run 409; status guards (cannot compute FINALISED, cannot finalise unapproved); employee fetches own payslip via `/payslips/me`; EMPLOYEE/RECRUITER RBAC 403

### Infrastructure
- `e2e/lib/roles.ts` — role → permission set, mirrors `seed-rbac.js`
- `e2e/lib/endpoints.ts` — protected-endpoint manifest (add a row when you add an `authorize()` call)
- `e2e/lib/jwt.ts` — forges JWTs against the running auth-service's key
- `e2e/lib/session.ts` — Playwright fixture: BrowserContext authenticated as a role
- `e2e/scripts/seed-test-users.js` — idempotently creates 10 test users (one per non-super-admin role) via the SUPER_ADMIN JWT
- `e2e/lib/testUsers.ts` — test-user registry (UUIDs from the seed)

---

## 4. How to Run Locally

```bash
# Backend + frontend unit suites
npm run test:backend     # jest across all services (~30s)
npm run test:frontend    # jest + tsc (~5s)

# E2E (requires the stack to be running via `docker compose up -d`)
npm run test:e2e:seed    # one-time: create 10 test users in hrms_auth
npm run test:e2e         # all e2e specs (~12 min)
npm run test:rbac        # just the RBAC matrix (~10 min)
npm run test:smoke       # just smoke (~1.5 min)

# Everything
npm run test:all
```

If `npm run test:e2e:seed` reports "already exists" — that's expected and idempotent.

### 4.1 Local database helpers

Two wrappers in `scripts/dev/` exist because the obvious way to do each of
these is quietly wrong:

```bash
scripts/dev/psql.sh hrms_auth -c 'SELECT * FROM tenants;'
scripts/dev/psql.sh hrms_auth <<'SQL'
SELECT code, country FROM legal_entities;
SQL

scripts/dev/push-schema.sh auth-service          # db name inferred: hrms_auth
scripts/dev/push-schema.sh statutory-sg-service  # -> hrms_statutory_sg
```

- **`psql.sh`** — always passes `docker exec **-i**`. Without `-i`, stdin is not
  attached: a heredoc is silently discarded and psql exits 0 having executed
  nothing, so the command *appears* to succeed. It also sets `ON_ERROR_STOP=1`
  so a failing statement is a non-zero exit rather than a buried warning.
- **`push-schema.sh`** — pushes a service's Prisma schema from the **host**
  against the published Postgres port. Identical result to
  `docker compose exec <svc> npx prisma db push`, but only Postgres has to be
  running, so it takes seconds instead of a container build.

### 4.2 Two `.env` gotchas

- **`POSTGRES_PORT` must be free on your machine.** `docker compose up` fails
  with `Bind for 0.0.0.0:<port> failed: port is already allocated` if another
  project holds it. Change `POSTGRES_PORT` in your `.env` (it is git-ignored);
  the helper scripts read the port from there, so nothing else needs updating.
- **Values containing spaces or globs must be quoted** — e.g.
  `BACKUP_CRON="0 19 * * *"`, `COMPANY_NAME="Vorkhive Pte Ltd"`. Docker Compose
  parses them either way, but an unquoted value breaks `source .env` in a shell
  (`command not found: Pte`) and an unquoted `*` glob-expands against the
  working directory. `.env.example` is quoted correctly — keep it that way when
  adding variables.

---

## 5. The Role × Endpoint Matrix (auto-generated)

The most valuable test we have. For each of **11 roles × N endpoints** (currently
N=20 → 220 cases, of which 86 expect 2xx and 134 expect 403),
the test asserts:
- **2xx** when `roleSatisfies(role, spec)` is true
- **403** when it's false

When you add a new `authorize(...)` to a service route, you **must** add a row
to `e2e/lib/endpoints.ts`. The matrix will then exercise it against all 11 roles
automatically.

```ts
// e2e/lib/endpoints.ts
export const ENDPOINTS: EndpointSpec[] = [
  // ...
  { id: 'new-route', method: 'POST', path: '/api/foo/bar',
    requirePerm: 'foo:manage',                 // or requireRole: ['HR_ADMIN']
    body: () => ({ name: 'x' }),                // sent only when allowed
    allowedStatuses: [200, 201],                // optional override
  },
];
```

---

## 6. When to Add a Test (Required by Policy)

| Change you're making | Required test additions |
|---|---|
| Add/change a route in any service | Row in `endpoints.ts` covering it |
| Add a new role to `seed-rbac.js` | Row in `roles.ts`, regen seed, re-run matrix |
| Add/change a permission code in `seed-rbac.js` | Row in `roles.ts` ALL_PERMISSIONS, plus mapping for affected roles |
| Add/change a sidebar nav definition | Sentinel in `smoke.spec.ts ROLE_SENTINEL` |
| New file-upload endpoint | T1 spec like `leave.spec.ts` (upload → fetch → byte-equal download) |
| New role-gated UI button/page | T1 spec confirming it's hidden for non-permitted roles |
| Add a model with a `tenantId` field | Cross-tenant isolation test (tenant A cannot read/write tenant B's rows) in that service's `tenant-isolation.test.js` |
| New internal service→service call that creates tenant-scoped rows | Assert the call stamps the caller's `tenantId` (regression for the "leaked into Default tenant" class of bug) |
| Add/change a platform-console endpoint (admin-service) | Spec under `services/admin-service/__tests__/` (auth realm, role gate, audit row) |
| Bug fix | Regression test that fails before the fix and passes after |

A PR that changes business logic without a corresponding test should be sent back.

---

## 6a. Phase 2 — Multi-Tenancy & Platform (test backlog)

> Added after the 2026-06-12 full run. The multi-tenant SaaS conversion + platform
> console + dynamic pricing shipped **without** test coverage. These are the gaps.

**Environment note:** the backend suite needs **Node 20** (`engines: ">=20"`). jest 29
hangs/errors under Node 22+; if `npm run test:backend` produces no output, you're on a
newer Node — run with Node 20 (`brew install node@20`). Always restore deps with
`npm ci` (an inconsistent `npm install` is what surfaced as a `jest-util` MODULE_NOT_FOUND).

**Backend unit/integration — to add (currently 0 coverage):**
- **Tenant isolation** (per service with a `tenantId` model): `tenant-isolation.test.js` exists
  for auth/employee/attendance/leave/payroll but is an **integration** test — it instantiates a
  real `PrismaClient` and needs a migrated test DB + `prisma generate`. Wire it into the
  DB-backed CI job (not the mock-only unit run). It must assert: a read in tenant-A context
  returns only A's rows; a create stamps A's `tenantId`; `runUnscoped` sees both.
- **`POST /users` stamps the creator's tenant** (regression for the bug where staff users
  leaked into the Default tenant) — auth-service.
- **`createAuthUser` (employee→auth internal call) passes `employee.tenantId`** (same bug class).
- **Tenant signup** (`tenants.routes`): `/register` creates Tenant(TRIALING +14d) + Subscription +
  OWNER (cloned SUPER_ADMIN) + cloned roles; rate-limited; rejects duplicate owner email.
- **Billing** (`billing.routes`): `/subscription` trial status + `trialDaysLeft`; `/checkout`
  stub with no Stripe key; `trialExpirySweep` flips expired TRIALING→PAST_DUE; webhook
  `checkout.session.completed` → ACTIVE.
- **Pricing** (admin-service): `getPricing` returns defaults when unset; `PUT /platform/pricing`
  requires SUPER_ADMIN/BILLING + writes an audit row; public `GET /pricing` returns only active.
- **Platform admin** (admin-service): login requires MFA; create/suspend/resume/cancel tenant;
  module toggle; trial-extend (date + days); AI-provider set; create-platform-admin (SUPER_ADMIN
  only, can't deactivate self); entitlements (`disabled` + `billingBlocked`).
- **Chatbot provider** (assistant-service): `resolveProvider` maps `claude`→anthropic else openai;
  `maskSensitive` recursively redacts SENSITIVE_KEYS when provider is anthropic.

**E2E — to add:**
- **Cross-tenant isolation E2E**: a user in tenant A gets 403/empty on tenant B's
  employees/leave/claims across services.
- **Gateway realm + entitlements**: platform token rejected on tenant routes (and vice versa);
  module-disabled → 403; billing-blocked (PAST_DUE) → 402.
- **Tenant signup → onboard → login** happy path.
- **Pricing**: public `/api/pricing` is CORS-`*`; operator edit in the console reflects on
  `/settings/billing`.

**Previously listed as "known failing" — both entries were wrong, both now pass (2026-08):**

- ~~5× `tenant-isolation.test.js`~~ — these were never failing; they had never been
  **run**. They need a real Postgres *and* each service's own generated Prisma client
  (`@prisma/client` is hoisted, so `prisma generate` for one service overwrites every
  other — all five can never pass in one jest invocation). `npm run test:isolation`
  runs one service per pass: **16/16 green**, and CI gates `deploy` on it.

- ~~`payroll-*` + `wica.engine` date-sensitive off-by-ones~~ — the diagnosis was wrong.
  These tests already use fixed 2026 dates, so a frozen clock would have **masked** the
  bug rather than fixed it. The real cause was mixing LOCAL date accessors with UTC
  serialisation: holidays were keyed a day early in any +08 zone, so EA s.20 pro-rated
  salary was wrong on every SG/MY machine while CI (UTC) stayed green. Fixed by
  UTC-anchoring the server-side date logic; CI now runs a TZ matrix (UTC +
  Asia/Singapore) so it cannot regress unseen.

**Known flaky (open):** the full `npm run test:backend` run is green on ~5 runs in 8;
the rest fail 1–5 scattered tests. Cause is **mock-order leakage**, not the app:
`jest.clearAllMocks()` in `beforeEach` resets call history but NOT queued
`mockResolvedValueOnce` / `mockRejectedValueOnce` implementations, so an unconsumed
`...Once` leaks into the next test and async timing under load decides whether that
happens. Fix is `resetAllMocks` in the affected suites. See
`docs/superpowers/plans/p1-verification-record.md` for the full evidence, including
two hypotheses that were tested and disproved (schedulers, test timeouts).

**Fixed in the 2026-06-12 run:** `moduleNameMapper` for `/app/shared/tenant-context` was missing
in performance/training/support services (their whole suites failed to load — recovered ~250
tests); the `m03-m12` SSO security test was updated for the multi-tenant `findUnique`→`findFirst`
email lookup.

---

## 7. T3 (Nightly) — Roadmap

All shipped 2026-05-29 across 9 new spec files (53 tests, 1 informational skip
when `GATEWAY_RATELIMIT_MAX_TEST_OVERRIDE > 1000`). Full suite runs in ~60s
against a docker compose stack with `GATEWAY_RATELIMIT_MAX=5000` (relaxed for
the suite; production stays at 200).

- ~~**AUTH-03** Account lockout after N failed attempts~~ — `auth-extended.spec.ts`: 5 failed bcrypt comparisons set `lockedUntil` for 15 min; the 6th attempt returns 423 even with the correct password. Uses per-test spoofed `X-Forwarded-For` so the per-IP login rate-limit (10/15min) doesn't bleed across tests.
- ~~**AUTH-04** Refresh token rotation~~ — `auth-extended.spec.ts`: rotated token works once and old token replay → 401. Uses fresh `APIRequestContext` per call because the route prefers the `vorkhive_refresh` cookie over body (the cookie set by the first refresh would otherwise shadow the rt1 replay attempt).
- ~~**AUTH-07/08** MFA enroll + login challenge~~ — `auth-extended.spec.ts`: full TOTP secret generation → `/mfa/verify` → login challenge round-trip. TOTPs are minted inside the auth container via `docker exec -i hrms-auth node` so the e2e package doesn't need to depend on `otplib`.
- ~~**AUTH-09/10** SSO callback (Google + Microsoft)~~ — `auth-sso.spec.ts`: pins the public `/sso/<provider>/config` shape, missing-field 400s, and the unconfigured/bogus-code → 401/503 branch on both `/sso/google/callback` and `/sso/microsoft/callback`. Happy path is not mocked (heavy OIDC machinery for a nightly test).
- ~~**LV-15** Leave working-days vs backend `totalDays`~~ — `leave-extended.spec.ts`: pins the backend's calendar-day contract (7 days for Mon-Sun) so any future move to working-days requires reconciling with the frontend display module. Also asserts the half-day override and the inverted-range 400.
- ~~**LV-17/18** Attachment size + MIME validation~~ — `leave-extended.spec.ts`: 11 MB upload is rejected/not-persisted; `.exe` is silently dropped by the multer fileFilter; `.pdf` and `.png` round-trip via the download endpoint.
- ~~**EMP-13** Concurrent edit conflict detection~~ — `employee-concurrency.spec.ts`: documents today's last-write-wins on `PUT /employees/:id` (no optimistic lock). Uses an existing employee + a benign `costCentre` field to side-step a pre-existing race in `nextEmployeeCode()` that makes fresh creates flaky.
- ~~**CLM-01..07** Claims module happy paths + RBAC~~ — **covered** by `claims.spec.ts`.
- ~~**ATT-01..10** Attendance + roster end-to-end~~ — `attendance.spec.ts`: clock-in idempotency, clock-out 400 without prior clock-in, hoursWorked round-trip, admin records + EMPLOYEE 403, OT summary surfaces the 72h MOM cap, location CRUD round-trip (with `postalCode`), unified shifts list.
- ~~**REC-01..07** Recruitment + ATS pipeline~~ — `recruitment.spec.ts`: job DRAFT → MCF compliance → candidate APPLIED → SCREENING → INTERVIEW_1 → OFFER → HIRED stage walk, FCF-status NOT_POSTED→IN_PERIOD, 14-day window blocks in-window shortlisting, EMPLOYEE 403 on `/candidates`.
- ~~**PAY-01..13** Payroll cycle, CPF e-Submit~~ — **covered** by `payroll.spec.ts`. IR8A + GIRO file formats are now covered separately in `payroll-iras-giro.spec.ts`: IR8A header `IR8A|<year>|<UEN>` + 8-field pipe-delimited detail; GIRO UOB 615-char fixed-width (CRLF stripped), DBS 114-char fixed-width, SCB generic-CSV with `X-Bank-Format-Status` header, unsupported-bank 400, non-FINALISED run 400.
- ~~**X-04** Rate limiter triggers 429~~ — `gateway-rate-limit.spec.ts`: isolated to its own file because the burst exhausts the per-IP budget. Tunable via `GATEWAY_RATELIMIT_MAX` env on the gateway; the spec reads `GATEWAY_RATELIMIT_MAX_TEST_OVERRIDE` and skips when set > 1000 to avoid bursting > 6000 requests in CI.
- ~~**X-06** Audit log entries appear for every mutation~~ — `cross-cutting.spec.ts`: `LOGIN_FAILED` lands an `auditLog` row in auth-service; `PUT /employees/:id` lands an `UPDATE` row in employee-service with `actorRole=SUPER_ADMIN` and `actorEmail` matching the JWT.
- ~~**X-09** Internal-service-key audit~~ — `cross-cutting.spec.ts`: probes `payroll-service:/payroll/internal/daily-rate/:emp/:period` from inside the docker network (via `docker exec hrms-leave wget`); missing key → 403, wrong key → 403, correct key → 200/404 (past the auth check). One representative of the wider `x-internal-service-key` family.

---

## 8. T4 (Weekly + Pre-Release) — Roadmap

| Area | Tool | Threshold |
|---|---|---|
| Perf — page first-paint | Lighthouse | < 2 s |
| Perf — `/employees?limit=500` | k6 | p95 < 500 ms |
| Perf — payroll compute (100 employees) | k6 | < 30 s |
| Concurrency — 50 users browsing | k6 | p95 < 2 s, 0 errors |
| Security baseline | OWASP ZAP (Docker) | 0 high, ≤3 medium |
| SQL injection | sqlmap | 0 findings |
| Secret leakage in logs | grep | 0 hits for NRIC/salary/bank |
| Accessibility | axe-playwright | 0 critical |
| Responsive (mobile 375×667) | Playwright | sidebar collapses, no h-scroll |
| Responsive (tablet 768×1024) | Playwright | grid reflows |

---

## 9. Test User Accounts

Seeded by `npm run test:e2e:seed`. Password: `TestE2E@2026!`

| Role | Email |
|---|---|
| SUPER_ADMIN | admin@hrms.com (existing) |
| ADMIN | test-admin@example.com |
| IT_ADMIN | test-it-admin@example.com |
| HR_ADMIN | test-hr-admin@example.com |
| HR_MANAGER | test-hr-manager@example.com |
| PAYROLL_OFFICER | test-payroll-officer@example.com |
| FINANCE_ADMIN | test-finance-admin@example.com |
| LINE_MANAGER | test-line-manager@example.com |
| RECRUITER | test-recruiter@example.com |
| TRAINING_MANAGER | test-training-manager@example.com |
| EMPLOYEE | test-employee@example.com |

These accounts exist in `hrms_auth` only — they intentionally have no employee
record (`employeeId: null`) except where individual specs require one (the leave
spec uses any existing real employee from `hrms_employee`).

---

## 10. CI Integration

GitHub Actions runs three jobs on every PR (`.github/workflows/pr-tests.yml`):

1. **backend-and-frontend** — `npm run test:backend && npm run test:frontend`
2. **e2e** (depends on #1) — boots `docker compose`, seeds RBAC + test users,
   installs Playwright browser, runs the full e2e suite
3. On failure: uploads `playwright-report/` artifact + dumps compose logs

A PR cannot merge unless both jobs pass.

---

## 11. Known Divergences Tracked in Tests

### Payroll spec is COMPLIANCE-DRIVEN

`e2e/tests/payroll.spec.ts` encodes the **statutory rule** (CPF Act, SDL Act, EA,
IRAS e-Tax Guide) as the expected value — NOT what the system currently
produces. Each assertion message starts with a `[SOURCE]` tag pointing back to
the published source (e.g. `[CPF-RATES-2026]`, `[EA-SECT-20]`). For CPF rates,
the source-of-truth is the official PDF "CPF Contribution Rate Table from 1
January 2026" (at `/root/NEWHRMS/CPFcontributionratesfrom1Jan2026.pdf`).
A test failure indicates one of:
- the system has a compliance bug → re-seed data or fix the engine,
- the statute has changed since the spec was written → update both the
  expected value AND the cited source in the spec header,
- the system intentionally diverges → record it below.

**Do not make a failing payroll-compliance test pass by reading the system's
output and pasting it back into the test** — that defeats the entire suite.

### Active findings to investigate

- **CPF rates and OW ceiling updated to Jan 2026 in `scripts/seed.js`** (RESOLVED for fresh deployments)
  As of 2026-05-22, `scripts/seed.js` was updated to the official Jan 2026
  values from `CPFcontributionratesfrom1Jan2026.pdf` (Tables 1, 2, 3):
    - OW ceiling: $6,800 → **$8,000**
    - 55-60: 16%/15% → **18%/16%**
    - 60-65: 10.5%/11.5% → **12.5%/12.5%**
    - PR_YEAR1: added age bracket (≤60: 5%/4%; 60+: 5%/3.5%)
    - PR_YEAR2: added age brackets (≤55: 15%/9%; 55-60: 12.5%/6%; 60-65: 7.5%/3.5%; 65+: 5%/3.5%)
    - 65-70, 70+, FOREIGNER: unchanged
  Fresh deployments will pick these up via `node scripts/seed.js`.

  **Existing deployments must run the migration**: `node scripts/migrate-cpf-jan2026.js`
  This script replaces all rows in `cpf_rates` with the Jan 2026 values in one
  transaction. Use `DRY_RUN=true` to preview. Required before any payroll run
  for period 2026-01 or later — otherwise CPF will be under-contributed for
  senior workers and high earners (>$6,800/month).

- **CPF rounding methodology mismatch (verified against Jan 2026 PDF)**
  Per CPF Board's Steps to Compute (printed at the bottom of every official
  rate table): (1) round TOTAL contribution to nearest dollar; (2) round
  EMPLOYEE share DOWN to nearest dollar; (3) EMPLOYER = TOTAL − EMPLOYEE.
  The system's `cpfRound()` in `shared/payroll-utils/index.js:41` rounds each
  share independently with `Math.round`. For most values this produces the
  same result, but at fractional cents the employee/employer split can be off
  by $1 vs the CPF Board method. Fix path: replace `cpfRound` calls with the
  three-step algorithm. Low priority (cents-level) but technically non-
  compliant for an audit.

- **OIL (Off-In-Lieu) CPF treatment** — RESOLVED 2026-05-22.
  Renamed in `scripts/seed.js` to "Off-In-Lieu (OIL) Cash-out" with
  `isCpfApplicable=true, isIrasTaxable=true`. Per [CPF-WAGES-DEF], an OIL
  cash payment is remuneration under contract of service and is therefore
  CPF-able OW + IRAS-taxable. Test `[CPF-WAGES-DEF] OIL cash-out is wages →
  subject to CPF as OW` now passes against fresh seeds. For existing
  deployments, the migration script does not touch `pay_components` — apply
  the OIL update manually with:
  ```sql
  UPDATE pay_components
  SET name = 'Off-In-Lieu (OIL) Cash-out',
      "isCpfApplicable" = true,
      "isIrasTaxable"   = true
  WHERE code = 'OIL';
  ```
  If your team uses a separate component for non-monetary OIL tracking
  (no cash payout), keep that one as `isCpfApplicable=false`.

- **CPF rounding methodology** — RESOLVED 2026-05-22.
  `shared/payroll-utils/index.js` now implements the official CPF Board
  3-step rounding (per the "Steps to compute CPF contribution" block printed
  at the bottom of the Jan 2026 rate-table PDF):
  1. TOTAL = round to nearest dollar
  2. EMPLOYEE = round DOWN (floor)
  3. EMPLOYER = TOTAL − EMPLOYEE (derived, not separately rounded)
  Applied separately to OW and AW components. Default `OW_CEILING` also
  updated from 6,800 to 8,000 when no rate row is provided. One unit test
  in `payroll-utils.unit.test.js` (the OW=49 edge case) was updated to
  match the new method. Full backend suite (263 tests) passes.

### Other divergences (operational, not compliance)

These are deliberately documented (not assertion failures) so they don't
silently regress:
- **Leave working-days display vs backend total** — frontend shows working days,
  backend stores calendar days. See LV-15 in §7.
- **`x-internal-service-key` auth pattern** — only honored on 2 routes in
  `auth-service`. Other call sites (e.g. `getEmployeeStartDate` in leave-service)
  fall back silently. See X-09 in §7.
- **HR_ADMIN sidebar shows Payroll module** but role only has `payroll:view`.
  RBAC matrix catches this at the endpoint level; sidebar visibility is per
  RBAC v3.1 doc §8.2.
- **`/auth/me` is source of truth** — forged JWT `role` claims don't escalate
  the UI. Auth context only trusts the DB lookup. The RBAC matrix tests at the
  API level use forged JWTs intentionally to bypass this.

---

## 12. Adding a New Test — Quick Recipe

1. **Pick the tier:** new module → T1, role permission change → T2, edge case → T3.
2. **Find the pattern:** check existing specs in `e2e/tests/` for the closest match.
3. **Forge a JWT or use the fixture:**
   ```ts
   import { contextAsRole } from '../lib/session';
   const ctx = await contextAsRole(browser, 'HR_ADMIN');
   ```
4. **Hit the endpoint or drive the UI** — keep it focused: one assertion per behaviour.
5. **Run locally before pushing:** `npm run test:e2e -- tests/your-spec.ts`
6. **Add a row to §3 of this doc** describing what your new spec covers.

---

## 13. Definition of Done

A change is "done" when:
- [ ] All T0 + T1 + T2 tests pass locally (`npm run test:all`)
- [ ] New tests added per §6 above
- [ ] CI is green on the PR
- [ ] Any new divergences are recorded in §11 of this doc

If you ship without these, the next regression isn't a question of *if* — only *when*.
