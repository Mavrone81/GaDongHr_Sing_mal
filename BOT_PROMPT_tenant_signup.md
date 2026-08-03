# Paste-ready prompt for your coding bot

> Run this from the repo root. It's scoped so the bot doesn't try to build all of multi-tenancy in one shot — it starts with the foundation, which everything else depends on. Work through the phases in order; do NOT skip to the signup UI before isolation exists.

---

We are turning GaDongHR HRMS from single-tenant into a multi-tenant SaaS. Read `MULTITENANCY_SAAS_SPEC.md` in the repo root first — it has the full plan and the current-state findings. Follow it. Use the **shared-DB + `tenantId` row-level isolation** approach. Reference UX for company signup is payboy.biz/register (Register Company form, no credit card, instant isolated workspace).

**Context you must respect:**
- Microservices, each with its own Postgres DB (`hrms_auth`, `hrms_employee`, …). Auth is in `services/auth-service` (Prisma), JWT is RS256 with PEM keys in `/app/certs`. `User.email` is currently globally unique — that must become unique per tenant.
- The existing `frontend/src/app/onboard/page.tsx` is EMPLOYEE profile onboarding, not company signup. Do not touch its purpose; just make it tenant-scoped.

**Do Phase 1 only in this pass, then stop and show me a summary + how to test before continuing:**

1. In `services/auth-service/prisma/schema.prisma`, add `Tenant`, `TenantStatus` enum, `Subscription`, and `CompanyProfile` models exactly as in the spec. Add `tenantId String` to `User`, `Role`, `OrgSetting`, `AuditLog`, `OtpToken`. Change `User.email` to `@@unique([tenantId, email])` and `Role.name` to `@@unique([tenantId, name])`. Add `@@index([tenantId])` everywhere relevant. Add the relations.
2. Add `tenantId` to the signed JWT access-token payload in the auth-service token util, and update verification/middleware to expose `req.tenantId` from the verified token only (never from headers/body/query). **Decide tenant-login resolution now** (email is no longer globally unique): implement login by company slug/subdomain OR a tenant-picker step after password. Also handle existing users whose old tokens have no `tenantId` — force re-login / invalidate old refresh tokens on deploy.
3. Write an idempotent migration + seed script that creates a single **"Default" tenant**, backfills `tenantId` on all existing `auth-service` rows to it, and a matching `TRIALING` subscription, so existing data keeps working. Generate the Prisma migration.
4. Add a Prisma client extension in auth-service that uses `AsyncLocalStorage` to auto-inject `where: { tenantId }` on reads and `tenantId` on creates, sourced from `req.tenantId`. Wire it into request handling.
5. Add/extend tests: existing auth tests still pass, plus a new test proving a query under tenant A's context cannot read a row belonging to tenant B.

Constraints: keep existing security behavior (bcrypt hashing, MFA, lockout, RS256) intact. Don't break the existing `/onboard` employee flow. Make every change additive and reversible. When done, summarize what changed, list the new env vars (if any), and give me exact commands to run the migration and the isolation test.

After I confirm Phase 1, we'll do Phase 2 (propagate `tenantId` + auto-scoping to every other service), then Phase 3 (`POST /api/tenants/register`, provisioning fan-out, `/register` page + company-profile wizard), then Phase 4 (trial enforcement + Stripe billing).

---

## Phase 2 prompt — propagate isolation to every service

For each service (`employee`, `payroll`, `leave`, `claims`, `attendance`, `recruitment`, `performance`, `training`, `offboarding`, `asset`, `benefits`, `loans`, `survey`, `hr-case`, `support`, `reporting`, `notification`, …): add `tenantId String` + `@@index([tenantId])` to every business model, generate migrations, backfill existing rows to the Default tenant, and wire in the same `AsyncLocalStorage` + Prisma `$extends` auto-scoping extension so every read/create is tenant-filtered by default. Make the `tenantId` claim flow from the gateway to each service. Add a cross-tenant isolation integration test per service.

## Phase 2.5 prompt — cross-cutting isolation (the non-Postgres leaks)

These are NOT covered by `tenantId` columns and will leak or break if skipped:
- **Object storage** (`asset-service`, `esign-service`, `face-service`): prefix every stored key with the tenant (`tenant/{tenantId}/…`) and check tenant ownership on every download. Treat `face-service` biometric data as sensitive PII (PDPA).
- **Background jobs / queues** (payroll runs, notification sends): carry `tenantId` in every job payload and re-establish the `AsyncLocalStorage` tenant context inside the worker — the request-scoped extension does not cover async workers.
- **Cache** (Redis or in-memory): namespace every key by `tenantId`.
- **Logs/traces:** include `tenantId` in structured logs for debuggability.
- Add a test proving tenant A cannot fetch tenant B's files or job results.

## Phase 3 prompt (use after Phases 1–2 land) — the actual "company registration"

Implement self-service company signup, Payboy-style.

- Add `POST /api/tenants/register` (public, no auth, behind reCAPTCHA + rate limit). Body: `companyName, fullName, workEmail, password, country, companySize, referralSource`. In one transaction: create `Tenant` (status `TRIALING`, `trialEndsAt = now + 14 days`, unique slug from companyName), create `Subscription` (plan `trial`), create the first `User` with an `OWNER` role inside that tenant (bcrypt password), seed default Roles/Permissions for the tenant by cloning the system template, then fire tenant provisioning. Send a verification email, issue a JWT, return `{ token, tenant }`.
- Tenant provisioning: publish a `tenant.created` event; have each service seed that tenant's defaults (leave types, claim categories, country public holidays, default approval workflows). If there's no event bus yet, implement lazy per-tenant seeding on first access instead — pick one and be consistent. **Make provisioning idempotent and recoverable**: track a provisioning status on the tenant and retry failed services, so a half-seeded tenant can be repaired rather than left broken.
- **Country compliance:** `country` must drive statutory config — payroll rules (CPF for SG, EPF/SOCSO for MY, MPF for HK), public holidays, currency, and date format. Seed the right defaults per country at provisioning.
- **Tenant lifecycle:** add per-tenant data export and a true cascade-delete that purges every service's DB and object storage (PDPA right-to-erasure) — not just the `auth-service` row.
- `POST /api/tenants/:id/profile` (auth, OWNER/ADMIN) saving `CompanyProfile`; country drives statutory config (SG → CPF).
- Frontend: new public `frontend/src/app/register/page.tsx` mirroring Payboy's fields (company name, work email, full name, password, country dropdown SG/MY/HK/ID/TH/PH/VN, company-size dropdown, "where did you hear about us", no credit card). On success store the JWT and redirect to a `frontend/src/app/onboard/company` setup wizard that forces company-profile completion before the dashboard unlocks.
- Test: two companies register independently and cannot see each other's data; a fresh signup lands in a seeded, empty workspace.

## Phase 4 prompt — free trial → paid
- Middleware: if `tenant.status = TRIALING` and `trialEndsAt < now` with no active paid sub → return 402 and route to billing.
- `GET /api/tenants/:id/subscription`, `POST /api/billing/checkout` (Stripe Checkout), `POST /api/billing/webhook` (update `Subscription.status`/`currentPeriodEnd`).
- Daily job flips expired trials to `PAST_DUE`/`SUSPENDED`.
- Frontend: trial banner ("X days left — Upgrade") + `/settings/billing` page.
- **Billing depth (don't ship the toy version):** per-active-employee (pay-per-use) metering like Payboy, GST on invoices, failed-payment dunning/retries, proration on plan change, card capture at upgrade (not at signup), and coupon/PSG-grant support for SG. Currency follows tenant country.
- Per-tenant quotas: enforce trial limits (e.g. max employees) and basic per-tenant rate limiting (noisy-neighbor protection) at the gateway.

## Phase 5 prompt — Platform Admin (super-admin control plane)

Build the SaaS operator back-office. Read section **3A** of `MULTITENANCY_SAAS_SPEC.md`. This is the most security-sensitive part — keep it in a separate auth realm, out of the tenant data path.

- Create a new **`services/admin-service`** (own Postgres DB) with Prisma models `PlatformAdmin` (+ `PlatformRole` enum SUPER_ADMIN/BILLING/SUPPORT), `Module`, `TenantModule`, `PlatformAuditLog` exactly as in the spec. Platform admins have NO `tenantId`.
- Separate login `POST /api/platform/login` issuing a JWT with `scope: "platform"` + platform role, **MFA mandatory**. Update the tenant auto-scoping extension and the gateway so a `scope: platform` token deliberately bypasses tenant scoping for `/api/platform/*` only, and is rejected on tenant app routes (and tenant tokens rejected on platform routes).
- `/api/platform/*` endpoints (platform-scope only, every action written to `PlatformAuditLog` with admin id + before/after + IP): list/search tenants, tenant detail, suspend/resume/cancel/delete tenant, extend/reset trial, view subscriptions/invoices and change plan, **toggle `TenantModule.enabled` per tenant**, time-boxed audited impersonation of a tenant owner, per-tenant usage + global audit view.
- **Gateway module entitlement enforcement:** map each route prefix to a module code (`/api/payroll/* → "payroll"`, etc.); before proxying a tenant request, check `TenantModule.enabled` for that tenant+module and return **403 module_disabled** if off. Core modules always on. Cache per tenant with short TTL, bust on toggle.
- Seed `TenantModule` rows from the plan's default module set inside tenant provisioning (Phase 3).
- Frontend: a **separate** operator console at `frontend/src/app/platform/*` behind platform login + MFA (never linked from the tenant app): tenants list, tenant detail with subscription + **module toggles** + usage + suspend/extend-trial actions, billing/MRR overview, plan & module catalog, platform audit log.
- Tests: platform token rejected on tenant routes and vice versa; toggling a module off immediately 403s that module for that tenant only; platform actions appear in `PlatformAuditLog`.
