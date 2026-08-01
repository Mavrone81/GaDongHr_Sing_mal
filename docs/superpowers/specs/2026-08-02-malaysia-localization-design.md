# Malaysia Localization — Engineering Design

**Date:** 2026-08-02
**Status:** Approved
**Requirements:** `PRD_AMENDMENT_MY.md` (PRD-HRMS-001-A)
**Supersedes for country concerns:** nothing — this is the first country-aware design

---

## 1. Problem

Vorkhive must sell in Malaysia. A tenant labelled Malaysian must compute
Malaysian payroll, apply Malaysian employment terms, and file Malaysian returns —
without Singapore customers experiencing any change.

### 1.1 Starting position

The country switch is **half-built and entirely inert**. `Tenant.country` and
`CompanyProfile.country` are captured at signup and validated against
`['SG','MY','HK','ID','TH','PH','VN']` (`services/auth-service/src/routes/tenants.routes.js:63`).
Nothing reads either field. There is no country branch anywhere in any service.

Singapore is baked in at ten seams:

| Seam | Location |
|---|---|
| CPF / SDL / FWL computation | `shared/payroll-utils/index.js`, called at `services/payroll-service/src/routes/payroll.routes.js:525-527` |
| Statutory rate tables | `CpfRate`, `SdlConfig`, `FwlRate` in `services/payroll-service/prisma/schema.prisma` |
| Employee statutory fields | `nricType`, `citizenshipStatus`, `passType`, `workPassSector`, `cpfPrYear`, `weeklyHours` (44) |
| Year-end filing | `services/payroll-service/src/engines/iras-submission.engine.js` |
| Cessation filing | `services/offboarding-service/src/engines/ir21.engine.js` |
| Statutory leave | `scripts/seed-leave-types.js`, `ccl.engine.js`, `msf-cap.engine.js` |
| Overtime | `computeOtPay` default multiplier 1.5 |
| Public holidays | `PublicHoliday`, unique per tenant + date |
| Recruitment compliance | `services/recruitment-service/src/engines/fcf.engine.js` |
| Training grants | `services/training-service/src/engines/grant.engine.js` (SkillsFuture) |

### 1.2 Two pre-existing defects this work must fix

Found during design; both block multi-entity and one is a live multi-tenancy bug.

**`PayrollRun.@@unique([period, runType, periodHalf])`** — `schema.prisma:58`, not
tenant-scoped. Two tenants cannot both run January 2026 monthly payroll; the
second receives a P2002, which `payroll.routes.js:170` renders as *"A payroll run
for this period already exists"* — a cross-tenant collision wearing a plausible
error message. `FwlRate.@@unique([sector, passType])` has the same defect.

**`PublicHoliday.@@unique([tenantId, date])`** — `schema.prisma:303`. A tenant
cannot hold a Malaysian and a Singapore holiday on the same date, which blocks
multi-entity outright.

---

## 2. Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | Scope: payroll, leave, year-end forms. SG-only modules become entity-contextual, not reimplemented | What a Malaysian buyer evaluates |
| 2 | One tenant may hold several country legal entities | Group customers: SG HQ + MY subsidiary, one workspace, consolidated reporting |
| 3 | A payroll run belongs to exactly one legal entity | Keeps engines single-country internally; lowest risk to existing SG payroll |
| 4 | Full LHDN computerised PCB calculation | Anything less breaks the customer's year-end reconciliation |
| 5 | Statutory rate tables are platform-managed, tenant read-only | Removes the per-deployment migration and the compliance-drift class |
| 6 | Country logic in **separate statutory services**, one per country | Deployment isolation: Malaysian code cannot break Singapore payroll |

### 2.1 On decision 6

The alternative considered was a full parallel `payroll-service-my`. Rejected
because `payroll.routes.js` is 2,295 lines of which the statutory computation is
three (525-527) — the rest is run lifecycle, status guards, payslips, SLA alerts,
cost centres, journals, PDF. A country-boundary split duplicates 90% to vary 10%,
and every subsequent lifecycle fix lands twice.

Splitting on the **layer** boundary instead yields the same isolation: Malaysian
statutory code lives in its own service, its own database, its own deploy, and
has no path to Singapore payroll — while the lifecycle stays single-sourced.

A consequence worth noting: because `payroll-service` remains shared, the gateway
needs **no** entity-aware routing. Country resolution is entirely internal.

---

## 3. Architecture

```
                 ┌─────────────────┐
                 │  api-gateway    │   unchanged — no country awareness
                 └────────┬────────┘
                          │
                 ┌────────▼────────┐
                 │ payroll-service │   run lifecycle, single-sourced
                 │  (shared)       │
                 └────┬───────┬────┘
        resolveEntity │       │ compute (by entity country)
                      │       ├──────────────┐
             ┌────────▼───┐   │              │
             │auth-service│   │              │
             │ LegalEntity│   │              │
             └────────────┘   │              │
                    ┌─────────▼──────┐ ┌─────▼──────────┐
                    │ statutory-sg-  │ │ statutory-my-  │
                    │   service      │ │   service      │
                    │ hrms_statutory │ │ hrms_statutory │
                    │      _sg       │ │      _my       │
                    └────────────────┘ └────────────────┘
```

### 3.1 Country resolution

Country is a property of the **entity**, not the user. A group HR administrator
legitimately works across both countries in one session, so a JWT country claim
would be wrong by construction. The JWT is unchanged.

```
run created with legalEntityId
  → payroll-service: resolveEntity(id)     TTL cache, internal-key auth
  → { country: 'MY', currency: 'MYR', state: 'SGR', statutoryIds: {...} }
  → select upstream by country
  → POST {statutory-my}/statutory/compute-batch
```

`resolveEntity` reuses the caching shape already proven by `getEntitlements` at
`services/api-gateway/src/index.js:149` — same internal-key auth, short TTL.
**Cache semantics differ deliberately:** entitlements fail open, entity
resolution fails closed (§3.4).

### 3.2 The statutory contract

Both services implement one interface. `payroll-service` never branches on
country.

```
POST /statutory/compute-batch
  { period:  { year, month },
    entity:  { country, state, statutoryIds },
    employees: [ { employeeId, profile, remuneration } ] }
→ { results: [ { employeeId,
                 employeeDeductions:    [ {code, label, amount, basis} ],
                 employerContributions: [ {code, label, amount, basis} ],
                 employerLevies:        [ {code, label, amount, basis} ] } ],
    rateVersion: "MY-2026.1" }

GET  /statutory/schema           → identity + profile fields, validation rules
GET  /statutory/employment-rules → leave tiers, OT multipliers, normal hours,
                                   notice bands, compulsory holidays
POST /statutory/validate         → pre-run completeness check
POST /statutory/year-end         → IR8A / EA Form payloads
POST /statutory/submission-file  → CPF e-Submit / CP39 / Borang A bytes
GET  /health
```

`/statutory/employment-rules` is what makes MYL-001 (service-tiered leave),
MYL-003 (day-type overtime multipliers) and MYL-005 (notice bands) implementable
without leave-service or attendance-service learning any country logic. It is
read at **entity provisioning** to seed defaults, and read at computation time by
attendance-service for overtime — never inlined as constants.

Batched deliberately: a 500-employee run makes one call, not 500.

`basis` carries which band row or rate applied — the audit trail that makes a
figure defensible years later.

### 3.3 Rate ownership

Statutory tables live **in the statutory service that uses them**, global (no
`tenantId`), effective-dated. `hrms_statutory_sg` holds `cpf_rates`, `sdl_config`,
`fwl_rates`; `hrms_statutory_my` holds `epf_bands`, `socso_bands`, `eis_bands`,
`pcb_config`, `hrdf_config`.

The platform console edits them via `admin-service`, which proxies to the owning
statutory service. Adding a country becomes one service plus one database,
touching no existing schema.

Employer *elections* the law permits are not rate data and live elsewhere: EPF
employer-rate override and HRD Corp registration on `LegalEntity`; voluntary EPF,
zakat and PCB profile on the employee.

### 3.4 Failure behaviour

The dangerous failure in payroll is not a crash but a silent wrong number.

| Condition | Behaviour |
|---|---|
| Statutory service unreachable | 503; run stays DRAFT; nothing partially written |
| Entity resolution fails | 503; run does not proceed |
| No effective rate row for period | **Hard fail.** Never fall back to a default or nearest row |
| Employee missing required profile fields | Rejected up front via `/statutory/validate`, listing employees and fields |
| Employee's country ≠ entity's country | Rejected at employee assignment, not at payroll time |
| Rate corrected after finalisation | Finalised run immutable; restatement requires a new run |

---

## 4. Data model

### 4.1 `LegalEntity` — auth-service

```prisma
model LegalEntity {
  id             String   @id @default(uuid())
  tenantId       String
  name           String
  code           String
  country        String   // SG | MY
  currency       String   // SGD | MYR
  timezone       String   // Asia/Singapore | Asia/Kuala_Lumpur
  state          String?  // MY only — drives state holiday set
  registrationNo String?  // UEN / SSM
  statutoryIds   Json?    // country-specific employer registrations
  isPrimary      Boolean  @default(false)
  isActive       Boolean  @default(true)

  @@unique([tenantId, code])
  @@index([tenantId])
}
```

`statutoryIds` is untyped **on purpose**. SG needs a CPF Submission Number; MY
needs EPF employer no., SOCSO code, LHDN E-number, HRD Corp registration. Typing
them here drags country knowledge into auth-service. The shape is declared by
each statutory service's `/statutory/schema` and validated there, so auth-service
stays country-agnostic and a third country adds no columns.

Placed in auth-service beside `CompanyProfile` because that is already where
tenancy is owned. `CompanyProfile` becomes the *first* legal entity rather than a
peer concept.

### 4.2 Employee — employee-service

Adds `legalEntityId` (required after backfill) and `statutoryProfile Json`.
`NricType` extends with `MYKAD` and `PASSPORT`.

MyKad inherits the existing `nricEncrypted` AES-256-GCM treatment, and
`services/assistant-service/src/mask.js` gains MyKad patterns so it is redacted
on the external-provider path.

MY profile carries what PCB requires — marital status, spouse employed,
qualifying children, prior reliefs, zakat enrolment — plus EPF/SOCSO/tax numbers.
Without these PCB is not computable, which is why `/statutory/validate` runs
before compute rather than discovering it mid-run.

### 4.3 Payroll — generic by addition, not replacement

`Payslip` keeps `employeeCpfEnc`, `employerCpfEnc`, `sdlAmountEnc`, `fwlAmountEnc`
exactly as they are, and gains a child table:

```prisma
model PayslipStatutoryLine {
  id          String @id @default(uuid())
  tenantId    String
  payslipId   String
  code        String   // EPF_EE | SOCSO_ER | PCB | CPF_EE | SDL | ...
  label       String
  party       Party    // EMPLOYEE | EMPLOYER
  kind        Kind     // DEDUCTION | CONTRIBUTION | LEVY
  amountEnc   String
  basis       Json
  rateVersion String

  @@unique([payslipId, code])
  @@index([tenantId])
}
```

SG runs **dual-write** both representations for one release, so every existing
reader — PDF engine, IRAS engine, reporting — keeps working untouched. MY runs
write only the child table. A later release moves SG readers across and drops the
columns.

This is slower than migrating outright and leaves redundant columns for a
release. That is the point: the Malaysian build cannot corrupt existing Singapore
payslip history.

`PayrollRun` gains `legalEntityId`, denormalised `country` and `currency`, and
`rateVersion`.

`rateVersion` is recorded at **both** levels deliberately: on the run, it is the
version resolved once at compute time; on each statutory line, it is the
per-figure guarantee ENT-006 requires. They are equal for a normal run — the
line-level copy exists so that reproducing a single payslip never depends on its
parent run surviving unchanged.

### 4.4 Constraint corrections

```
PayrollRun    @@unique([period, runType, periodHalf])
           →  @@unique([tenantId, legalEntityId, period, runType, periodHalf])

FwlRate       @@unique([sector, passType])           → scoped (moves to statutory-sg)

PublicHoliday @@unique([tenantId, date])
           →  @@unique([tenantId, legalEntityId, date])
              + country, state columns
```

### 4.5 Leave

`LeaveType` gains `entitlementRule Json?` for service-tiered entitlement
(MY: 8/12/16 annual, 14/18/22 sick). The existing flat `annualEntitlement`
remains valid for SG and for non-statutory types.

**Source of truth, to avoid a duplicated rule set:** the statutory service owns
the *statutory minimum* and exposes it via `/statutory/employment-rules`.
`LeaveType.entitlementRule` holds the *tenant's configured* rule, seeded from
that minimum when the entity is provisioned. Employers routinely grant above the
minimum, so the configured value must be able to exceed it — but never silently
fall below. Validation on save compares the configured rule against the current
statutory minimum for the entity's country and rejects a shortfall.

Overtime multipliers move from the `1.5` default in `computeOtPay` into the
country's statutory service, since MY differentiates 1.5× / 2× / 3× by day type.
attendance-service reads them per entity rather than holding constants.

---

## 5. Migration

One script, ordered, idempotent, dry-runnable — following the precedent of
`scripts/migrate-cpf-jan2026.js`.

1. Create one primary `LegalEntity` per existing tenant from its
   `CompanyProfile`: country `SG`, currency `SGD`, timezone `Asia/Singapore`.
2. Backfill `Employee.legalEntityId` and `PayrollRun.legalEntityId`.
3. Backfill `PublicHoliday.legalEntityId`, country `SG`.
4. Apply the constraint corrections (§4.4).
5. Hoist each tenant's `cpf_rates` / `sdl_config` / `fwl_rates` into the global
   `hrms_statutory_sg` tables, deduplicated against the canonical Jan 2026
   values.

**Step 5 emits a divergence report** naming any tenant whose rates differ from
canonical. Because `migrate-cpf-jan2026.js` had to be run per deployment, some
tenants may never have received it — that report identifies exactly which
customers have been computing CPF incorrectly. It is worth producing regardless
of Malaysia.

Rollback: steps 1–3 are additive and reversible; step 4 is reversible; step 5
copies rather than moves, leaving the per-tenant rows intact until a later
release drops them.

---

## 6. Testing

### 6.1 Tier 1 — Singapore proves the refactor

`shared/payroll-utils` moves into `statutory-sg-service` carrying its existing
unit tests. The full Singapore payroll E2E suite — CPF rate matrix, the five
AW-ceiling scenarios, SDL bounds and boundaries, EA s.20 pro-ration, the
OT/OIL/deduction paycode branches — must pass **unchanged** across the new HTTP
boundary.

Green means the boundary is behaviour-preserving. **This gate closes before any
Malaysian code merges.** It is the entire safety argument for the refactor.

### 6.2 Tier 2 — golden vectors

Every row of the published KWSP Third Schedule and PERKESO Second Schedule
becomes a test case, mirroring the suite's existing "one E2E per CPF rate-table
row" pattern.

Expected values are **transcribed from the publications, never hand-derived** —
hand-computed expectations are how compliance bugs get enshrined in tests.

### 6.3 Tier 3 — PCB differential

LHDN publishes an official calculator. PCB reconciles against it at **zero
tolerance** across categories 1–3 × income levels × child counts × bonus and
non-bonus months.

PCB is the highest compliance exposure in this build and the one component with
an authoritative oracle available. It should be checked against it.

### 6.4 Cross-cutting

- **Contract tests** both statutory services must satisfy, so a third country
  cannot drift from the interface.
- **Multi-entity isolation tests**, mirroring the existing cross-tenant isolation
  suite: an SG run must never pull a MY employee, and vice versa.
- **Fail-closed test:** statutory service down → run stays DRAFT, 503 returned,
  no partial payslips written.
- **Migration test:** for a representative tenant, payroll output after migration
  is byte-identical to output before.

---

## 7. Rollout

| Phase | Ships | Customer-visible change |
|---|---|---|
| **P0** | `LegalEntity`, backfill migration, constraint corrections | none |
| **P1** | `statutory-sg-service` extracted; payroll calls it over HTTP | none |
| **P2** | `statutory-my-service` — EPF, SOCSO, EIS, HRD Corp | MY tenants computable |
| **P3** | PCB engine + LHDN differential gate | MY payroll sellable |
| **P4** | MY leave, overtime, state holidays, entity-contextual modules | MY HR complete |
| **P5** | CP39, Borang A, Borang 8A, Lampiran 1, EA Form, Form E, CP21/22/22A | MY filing complete |

P0 and P1 reach production carrying **zero Malaysian code**. That is the risk
containment: if P1 is green, the interface is proven safe and everything after it
is additive.

### 7.1 Deployment note

Both statutory services must be added to `docker-compose.yml`, not merely created
under `services/`.

This repository already contains six services — `benefits`, `esign`, `hr-case`,
`loans`, `support`, `survey` — that are routed by the gateway and have live
frontend pages but were **never added to compose** (`git log -S` confirms they
never had an entry). A statutory service missing from compose is a payroll
outage, not a missing page.

Once in compose, the cron-pull deploy maps `services/<name>/` → container
automatically, so no CD change is required.

---

## 8. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Statutory rates wrong at go-live | High | Verification gate (PRD §A7); provenance recorded per value; platform-managed tables make correction a single action |
| PCB computed incorrectly | High | Zero-tolerance differential against LHDN's own calculator |
| Refactor breaks Singapore payroll | High | P1 gate: full SG suite unchanged before any MY code; dual-write preserves payslip history |
| Statutory service omitted from compose | Medium | Explicit deploy step; local precedent of six such services |
| Rate revisions missed after go-live | Medium | ENT-004 makes it one action per country — but not automatic; needs an operational owner |
| East Malaysia sold as compliant | Medium | Scope boundary stated in PRD §A1.2 as a sales constraint, not only an engineering one |
| Group-tenant reporting complexity | Low | Runs stay single-entity; consolidation aggregates across runs |

---

## 9. Open items

1. **Operational owner for statutory rate revisions.** ENT-004 makes updating
   rates a single platform action; it does not make anyone responsible for
   noticing that KWSP or LHDN published a change. This needs a named owner and a
   review cadence before go-live.
2. **Sabah / Sarawak.** Deferred by decision. Reconsider immediately if an East
   Malaysian prospect appears — it is a scope change, not a configuration one.
3. **`LegalEntity` placement.** Sited in auth-service by the `CompanyProfile`
   precedent. A dedicated org-service would be defensible if entity metadata
   grows substantially.
