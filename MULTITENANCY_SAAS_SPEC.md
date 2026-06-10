# Vorkhive HRMS — Multi-Tenant SaaS Onboarding Spec

**Goal:** Let any company self-register (Payboy-style), get an isolated tenant provisioned automatically for free-trial testing, set up its company profile, and use the full HR system. Each company has its own tenant; trials convert to paid after the trial period.

**Reference UX:** [payboy.biz/register](https://payboy.biz/register) — "Register Company" form, no credit card, instant workspace.

---

## 1. Current state (important — read first)

Vorkhive is **single-tenant today.** Confirmed by reading the codebase:

- **No tenant concept exists.** No `Tenant`/`Company`/`Subscription` model anywhere; zero `tenantId` columns across all 22 service schemas.
- **Architecture:** Node microservices behind an `api-gateway`. Each service owns its **own Postgres database** (`hrms_auth`, `hrms_employee`, …) on one shared Postgres instance. Per-service DBs are created by `scripts/init-dbs.sql`.
- **Auth:** `auth-service` (Prisma) with `User`, `Role`, `Permission`, `RolePermission`, `RefreshToken`, `AuditLog`, `OtpToken`, `OrgSetting`. JWT is **RS256** (private/public PEM in `/app/certs`). MFA (TOTP + email OTP), forgot-password, account lockout all present.
- **`User.email` is globally `@unique`** — this breaks the moment two tenants have a user with the same email. Must become unique *per tenant*.
- **Existing `/onboard` page is NOT company signup.** It's an *employee* completing their personal profile after HR invites them (`inviteToken` → `POST /employees/apply`), with client-side AES-256-GCM encryption. Do not confuse it with tenant registration — it stays, but becomes tenant-scoped.
- **Frontend:** Next.js App Router. `auth/*` (login, forgot/reset, OAuth callbacks), `(dashboard)/*` feature pages, `onboard/page.tsx`.

**Conclusion:** "Register a new company + free trial" = adding **multi-tenancy** across the whole platform. It is not a single feature; it is a cross-cutting change. The plan below uses **shared-DB + `tenantId` row-level isolation** (chosen approach — cheapest to run, fastest to provision a trial, least disruptive to the current per-service DB layout).

---

## 2. Target model: shared DB + `tenantId`

Every business row is stamped with a `tenantId`. Every query is filtered by the `tenantId` of the authenticated user. The JWT carries the `tenantId` claim, so services never trust a client-supplied tenant.

```
Company signs up  →  Tenant row (status=TRIALING, trialEndsAt=now+14d)
                  →  first User (role: OWNER) in that tenant
                  →  default Roles/Permissions seeded for the tenant
                  →  default HR config seeded (leave types, claim types, CPF/country settings)
                  →  JWT issued { sub, tenantId, role }  →  user lands in their workspace
```

### 2.1 New models (in `auth-service`, since it mints JWTs)

```prisma
model Tenant {
  id            String   @id @default(uuid())
  name          String                 // company display name
  slug          String   @unique       // e.g. acme  -> used for subdomain/login hint
  country       String   @default("SG")// SG | MY | HK | ID | TH | PH | VN
  companySize   String?                // "1-10", "11-20", ...
  referralSource String?               // "where did you hear about us"
  status        TenantStatus @default(TRIALING)
  trialEndsAt   DateTime
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  users         User[]
  subscription  Subscription?
  profile       CompanyProfile?
  @@map("tenants")
}

enum TenantStatus { TRIALING ACTIVE PAST_DUE SUSPENDED CANCELED }

model Subscription {
  id               String   @id @default(uuid())
  tenantId         String   @unique
  plan             String   @default("trial")   // trial | starter | pro
  status           String   @default("trialing")// trialing | active | past_due | canceled
  seats            Int      @default(0)
  trialEndsAt      DateTime
  currentPeriodEnd DateTime?
  stripeCustomerId String?
  stripeSubId      String?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  tenant           Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  @@map("subscriptions")
}

model CompanyProfile {
  id            String  @id @default(uuid())
  tenantId      String  @unique
  legalName     String
  registrationNo String?               // UEN (SG) / SSM (MY) etc.
  industry      String?
  addressLine1  String?
  addressLine2  String?
  postalCode    String?
  city          String?
  country       String  @default("SG")
  logoUrl       String?
  payrollConfig Json?                  // country-specific: CPF rates ref, pay cycle, etc.
  completed     Boolean @default(false)
  tenant        Tenant  @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  @@map("company_profiles")
}
```

### 2.2 Changes to existing models

- Add `tenantId String` to `User`, `Role`, `OrgSetting`, `AuditLog`, `OtpToken` (and the equivalent business tables in **every** other service: employee, payroll, leave, claims, attendance, etc.).
- Change `User.email @unique` → `@@unique([tenantId, email])`.
- Change `Role.name @unique` → `@@unique([tenantId, name])` (each tenant gets its own role set).
- Add `@@index([tenantId])` to every tenant-scoped table for query performance.

### 2.3 JWT
Add `tenantId` to the signed access-token payload. The gateway and every service read `tenantId` **from the verified token only** — never from headers, query, or body.

### 2.4 Auto-scoping (do NOT rely on hand-written `where` clauses)
In each service, use a **Prisma client extension** (`$extends` query hook) plus **`AsyncLocalStorage`** to carry the request's `tenantId` and auto-inject `where: { tenantId }` on every read and `data: { tenantId }` on every create. This makes tenant isolation the default and prevents accidental cross-tenant leaks. Add an integration test that proves Tenant A cannot read Tenant B's rows.

---

## 3. New flows & endpoints

### 3.1 Public signup (no auth) — `POST /api/tenants/register`
Body (Payboy-equivalent): `companyName, fullName, workEmail, password, country, companySize, referralSource`. reCAPTCHA token.
Steps (single DB transaction where possible):
1. Reject if a tenant already uses this `workEmail` as an owner.
2. Create `Tenant` (status `TRIALING`, `trialEndsAt = now + 14 days`, unique `slug` from company name).
3. Create `Subscription` (plan `trial`, status `trialing`).
4. Create first `User` with `OWNER` role inside the tenant; hash password (bcrypt, as existing code does).
5. Seed default `Role`s/`Permission`s for the tenant (clone the system role/permission template).
6. Fire **tenant provisioning** (section 3.3).
7. Send verification email; issue JWT; return `{ token, tenant }`.

### 3.2 Company profile setup — `POST /api/tenants/:id/profile`
Auth required (OWNER/ADMIN). Saves `CompanyProfile`. On first login the frontend forces a **setup wizard** until `profile.completed = true`. Country drives statutory config (e.g. SG → CPF rates from `CPFcontributionratesfrom1Jan2026.pdf`).

### 3.3 Tenant provisioning (fan-out to services)
When a tenant is created, each downstream service must seed that tenant's defaults (default leave types, claim categories, public holidays for the country, default approval workflows). Two valid options — pick one and be consistent:
- **Event-based (preferred):** `auth-service` publishes `tenant.created`; each service subscribes and seeds. Reuses `notification-service` patterns.
- **Lazy seeding:** each service seeds tenant defaults on first access if missing.

### 3.4 Trial → paid enforcement
- Middleware (gateway or shared lib): if `tenant.status` is `TRIALING` and `trialEndsAt < now` and no active paid subscription → block app routes with HTTP 402 and route the user to a **billing page** (read-only/export still allowed for grace, your call).
- Add `GET /api/tenants/:id/subscription` and `POST /api/billing/checkout` (Stripe Checkout) + `POST /api/billing/webhook` (Stripe → update `Subscription.status`, `currentPeriodEnd`).
- A daily job flips expired trials to `PAST_DUE`/`SUSPENDED`.

### 3.5 Frontend
- New public **`/register`** page mirroring Payboy fields (no credit card). Posts to `/api/tenants/register`, stores returned JWT, redirects to the profile wizard.
- New **`/onboard/company`** setup wizard (company profile, logo, country/statutory config, invite first employees).
- **Trial banner** in the dashboard shell ("X days left in trial — Upgrade").
- **`/settings/billing`** page (plan, seats, upgrade, invoices).
- Login stays as-is but resolves the user's `tenantId` from credentials.

---

## 3A. Platform Admin (super-admin control plane)

A **platform operator** console — separate from any tenant — to run the SaaS: manage every company, billing, and which modules each company can use. This is "God mode" and is the most security-sensitive part of the system, so it lives in its **own auth realm and (preferably) its own service.**

### 3A.1 Identity & isolation — keep it OUT of the tenant data path
- New **`admin-service`** (control plane) — or, if you must, a guarded area of `auth-service`. Recommended: a dedicated `admin-service` so platform concerns never touch tenant query paths.
- Platform admins are **not** `User`s and have **no `tenantId`.** Their JWT carries `scope: "platform"` and a platform role, and is issued by a **separate login** (`POST /api/platform/login`).
- The tenant auto-scoping extension (section 2.4) must **explicitly recognize `scope: platform`** and allow deliberate, audited cross-tenant access. A platform token must never be accepted by tenant app routes, and a tenant token must never reach platform routes. Enforce this at the gateway by realm.
- **MFA mandatory** for all platform admins. Optional IP allowlist. Every action is audited (admin id + before/after + IP).

### 3A.2 New models (in `admin-service`)
```prisma
model PlatformAdmin {
  id           String   @id @default(uuid())
  email        String   @unique
  passwordHash String
  name         String
  role         PlatformRole @default(SUPPORT)
  mfaEnabled   Boolean  @default(false)
  mfaSecret    String?
  isActive     Boolean  @default(true)
  lastLoginAt  DateTime?
  createdAt    DateTime @default(now())
  @@map("platform_admins")
}
enum PlatformRole { SUPER_ADMIN BILLING SUPPORT }   // SUPER_ADMIN=all, BILLING=payments+plans, SUPPORT=read+impersonate

model Module {                        // catalog of toggleable HR modules
  code        String  @id            // "payroll", "leave", "claims", "attendance", "recruitment", ...
  name        String
  description String?
  isCore      Boolean @default(false)// core modules can't be disabled (e.g. employee, auth)
  @@map("modules")
}

model TenantModule {                  // per-company entitlement
  tenantId   String
  moduleCode String
  enabled    Boolean  @default(true)
  enabledAt  DateTime @default(now())
  @@id([tenantId, moduleCode])
  @@map("tenant_modules")
}

model PlatformAuditLog {
  id        String   @id @default(uuid())
  adminId   String
  action    String                   // "tenant.suspend", "module.toggle", "trial.extend", "refund", "impersonate"
  tenantId  String?
  before    Json?
  after     Json?
  ipAddress String?
  createdAt DateTime @default(now())
  @@index([adminId]) @@index([tenantId])
  @@map("platform_audit_logs")
}
```

### 3A.3 Capabilities (endpoints under `/api/platform/*`, platform-scope only)
- **Tenancy:** list/search tenants, view tenant detail, suspend / resume / cancel / delete a tenant, extend or reset a trial (`trialEndsAt`).
- **Payments:** view each tenant's subscription, plan, and invoices; change plan; issue refunds (via Stripe); see MRR / churn / trial-conversion overview. (Money-moving actions stay manual-confirm; never auto-charge.)
- **Modules per company:** toggle `TenantModule.enabled` for any tenant. Plans define a default module set; admins can override per tenant for upsell/trials.
- **Support:** time-boxed, audited **impersonation** of a tenant owner (issues a special token + visible banner, expires fast).
- **Observability:** per-tenant usage (employees, active users, last login), global platform audit log, system announcements.

### 3A.4 Module entitlement enforcement (the gateway is the choke point)
Map each route prefix to a module code in the `api-gateway` (e.g. `/api/payroll/* → "payroll"`). Before proxying a tenant request, the gateway checks `TenantModule.enabled` for that tenant+module; if disabled, return **403 module_disabled**. Core modules are always on. Cache entitlements per tenant with short TTL + cache-bust on toggle. The frontend also hides nav for disabled modules, but **the gateway is the source of truth** — never trust the client.

### 3A.5 Provisioning hook
When a tenant is created (section 3.3), seed its `TenantModule` rows from the chosen plan's default module set, so entitlements exist from day one.

### 3A.6 Frontend
A **separate** platform console, e.g. `frontend/src/app/platform/*` (or a standalone Next app on an internal host), behind platform login + MFA. Pages: tenants list, tenant detail (subscription, **module toggles**, usage, suspend/extend-trial actions), billing/MRR overview, plan & module catalog, platform audit log. This is operator-only — never linked from the tenant-facing app.

---

## 4. Migrating existing single-tenant data
Create one **"Default" tenant**, backfill `tenantId` on all existing rows to it, then add the `NOT NULL` constraint. Ship this as a one-off migration script so current data keeps working.

---

## 5. Suggested phasing (each phase shippable & testable)
1. **Tenant core:** `Tenant`/`Subscription`/`CompanyProfile` models in `auth-service`; `tenantId` in JWT; backfill Default tenant; per-tenant unique email/role.
2. **Isolation:** add `tenantId` + auto-scoping extension + indexes to every service; cross-tenant isolation test.
3. **Signup + provisioning:** `POST /api/tenants/register`, role/permission seed, provisioning fan-out, `/register` page + profile wizard.
4. **Billing:** trial enforcement middleware, Stripe checkout + webhook, billing page, daily trial-expiry job.
5. **Platform admin:** `admin-service` + `PlatformAdmin`/`Module`/`TenantModule` models, `/api/platform/*` endpoints, gateway module-entitlement enforcement, and the operator console. Seed `TenantModule` rows during tenant provisioning. (Module enforcement can land alongside Phase 2/3; the console UI after.)

## 6. Acceptance criteria
- Two companies register independently; neither can see the other's users, employees, payroll, or settings (proven by test).
- A fresh signup lands in a working, empty-but-seeded HR workspace within seconds, no credit card.
- Trial countdown is visible; after expiry without payment, app is paywalled but data is retained.
- Existing single-tenant data continues to work under the Default tenant.
- A platform admin (separate login + MFA) can list all tenants, suspend/extend-trial, view payments, and toggle a module for one company — and that toggle immediately blocks/allows that module at the gateway for that tenant only.
- A platform token is rejected by tenant app routes and vice versa; every platform action is recorded in `PlatformAuditLog`.
