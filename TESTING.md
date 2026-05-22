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
- 263 jest tests across 8 services
- Lives in `services/*/__tests__/`
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
| Bug fix | Regression test that fails before the fix and passes after |

A PR that changes business logic without a corresponding test should be sent back.

---

## 7. T3 (Nightly) — Roadmap

Not yet automated; add as time permits. Each adds one or two test files:
- **AUTH-03** Account lockout after N failed attempts
- **AUTH-04** Refresh token rotation
- **AUTH-07/08** MFA enroll + login challenge
- **AUTH-09/10** SSO callback (Google + Microsoft) — needs mock providers
- **LV-15** Leave working-days calculation matches backend `totalDays` (known divergence today)
- **LV-17/18** Attachment size + MIME validation
- **EMP-13** Concurrent edit conflict detection
- **CLM-01..07** Claims module happy paths + RBAC
- **ATT-01..10** Attendance + roster end-to-end
- **PAY-01..13** Payroll cycle, CPF/GIRO/IR8A generation, maker-checker
- **REC-01..07** Recruitment + ATS pipeline
- **X-04** Rate limiter (200 req/min) triggers 429
- **X-06** Audit log entries appear for every mutation
- **X-09** Internal-service auth audit (the `x-internal-service-key` pattern that's silently broken in several places)

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
