# PRD Amendment A — Malaysia Edition & Multi-Country Tenancy

**Amends:** PRD-HRMS-001 v2.0 (GaDongHR — Singapore, Full Statutory Compliance Edition)
**Amendment reference:** PRD-HRMS-001-A
**Version:** 1.0
**Date:** 2026-08-02
**Status:** Approved for planning
**Classification:** Confidential

---

## A1. Purpose of this amendment

PRD-HRMS-001 v2.0 defines GaDongHR as a Singapore product: its Target Market is
"Singapore-based organisations", and §16 is a *Singapore* Regulatory Compliance
Matrix. This amendment extends the product to **Malaysia** and, in doing so,
generalises the tenancy model from one country per customer to **one tenant
holding several legal entities, each in its own country**.

It does not restate v2.0. Everything in v2.0 remains in force for Singapore
entities unless a clause below explicitly amends it.

### A1.1 What changes at the product level

| | v2.0 (today) | With this amendment |
|---|---|---|
| Target market | Singapore organisations | Singapore **and** Malaysia organisations |
| Country model | Implicitly Singapore everywhere | Explicit per **legal entity**; a tenant may hold both |
| Statutory engine | CPF/SDL/FWL only, in shared library | Per-country statutory services behind one contract |
| Statutory rates | Per-tenant rows, tenant-editable | **Platform-managed**, versioned, tenant read-only |
| Payroll run scope | Per tenant + period | Per **legal entity** + period |
| Currency | SGD assumed | Per entity — SGD or MYR |

### A1.2 Scope boundary for this amendment

**In scope:** Malaysian payroll statutory contributions and monthly tax; Malaysian
employment-terms rules (leave, overtime, holidays); Malaysian year-end and
periodic statutory filing; the multi-country tenancy model that carries them.

**Out of scope (v1), stated explicitly so it is not assumed:**

- **Sabah and Sarawak.** Employment in East Malaysia is governed by the Labour
  Ordinance (Sabah) Cap. 67 and Labour Ordinance (Sarawak) Cap. 76 — separate
  statutes from the Employment Act 1955, with different provisions. v1 supports
  **Peninsular Malaysia only**. `LegalEntity.state` is the designed hook for
  adding the ordinances later without rework. **This is a sales constraint:
  GaDongHR must not be represented as compliant for East Malaysian employment
  until those ordinances are implemented.**
- Malaysian equivalents of the Singapore-only modules — MYFutureJobs posting
  compliance (vs FCF), HRD Corp claimable-course administration (vs SkillsFuture
  grant claims), and SOCSO incident administration (vs WICA). The underlying
  HRD Corp *levy* is in scope (MYP-005); the claimable-course workflow is not.
  These modules become entity-contextual (ENT-005) rather than reimplemented.
- Non-statutory Malaysian payroll practices (EPF voluntary excess schemes beyond
  a flat employer-rate override, employer-borne PCB arrangements).

---

## A2. New requirement group: ENT — Multi-country tenancy

### ENT-001 — Legal entity as the country anchor

A tenant SHALL own one or more **legal entities**. Each legal entity SHALL carry
a country (`SG` | `MY`), a currency (`SGD` | `MYR`), a business timezone, a
registration number (UEN / SSM), and its country-specific employer statutory
registrations. For Malaysian entities it SHALL also carry a state.

Every employee SHALL belong to exactly one legal entity. Every payroll run SHALL
belong to exactly one legal entity, and therefore has exactly one country, one
currency, one statutory rule set and one approval chain.

**Acceptance:** a tenant can hold an SG entity and a MY entity simultaneously;
each entity's employees compute under their own country's rules; neither
entity's payroll run can include the other's employees.

### ENT-002 — Country resolution is server-derived, never client-supplied

Country SHALL be resolved from the legal entity recorded against the run or the
employee, retrieved server-side. It SHALL NOT be accepted from a request header,
query parameter or body, and SHALL NOT be carried as a JWT claim — a group HR
administrator legitimately operates across countries within one session, so a
token-level country would be wrong by construction.

**Acceptance:** a request that supplies a country field has it ignored; payroll
computes under the entity's recorded country in every case.

### ENT-003 — Existing tenants migrate without behaviour change

Every tenant existing at the time of migration SHALL receive exactly one primary
legal entity derived from its `CompanyProfile`, with country `SG` and currency
`SGD`. All existing employees and payroll runs SHALL be backfilled to it.

**Acceptance:** for every pre-existing tenant, payroll output after migration is
byte-identical to output before migration, and no user-visible change occurs.

### ENT-004 — Statutory rate tables are platform-managed

Statutory rate tables (CPF, SDL, FWL, EPF, SOCSO, EIS, PCB bands, HRD Corp)
SHALL be maintained by the platform operator, versioned by effective date, and
presented to tenants read-only. This amends v2.0's model in which each tenant
held its own editable copy.

Employer *elections* that the law genuinely permits remain configurable and are
not rate data: EPF employer rate above the statutory minimum and HRD Corp
registration status sit on the legal entity; voluntary EPF, zakat enrolment and
the PCB tax profile sit on the employee.

**Rationale:** under the per-tenant model, the January 2026 CPF revision required
`scripts/migrate-cpf-jan2026.js` to be executed against every deployment, and any
tenant could silently diverge from the statutory rates. Platform ownership makes
one update serve every tenant and removes the drift class entirely.

**Acceptance:** a rate update by the platform operator takes effect for all
tenants of that country without a per-tenant migration; no tenant-level UI can
alter a statutory rate.

### ENT-005 — Country-specific features are entity-contextual

Features that exist only in one jurisdiction SHALL be presented according to the
legal entity in context, not the tenant. Fair Consideration Framework compliance,
SkillsFuture grant claims and WICA incident reporting SHALL appear for Singapore
entities and be absent for Malaysian entities.

Tenant-level module entitlement (the existing `TenantModule` gateway
enforcement) is unchanged and remains the commercial lever; ENT-005 governs
jurisdictional applicability, which is a different concern.

**Acceptance:** in a tenant holding both entities, an HR administrator sees FCF
controls on a Singapore job requisition and does not see them on a Malaysian one;
single-entity tenants see no entity selector and no change of any kind.

### ENT-006 — Reproducibility of statutory computation

Every payroll line carrying a statutory amount SHALL record the version of the
rate table under which it was computed. A finalised payroll run SHALL be
immutable: a subsequent rate correction SHALL NOT retroactively alter it, and
restatement SHALL require a new run.

**Acceptance:** a payslip issued in 2026 can be reproduced in 2031 under the
rules in force at issue, after any number of intervening rate revisions.

---

## A3. New requirement group: MYP — Malaysia payroll statutory

> **Rate caveat — applies to all of §A3 and §A4.**
> Figures below are the structure plus a representative value at time of
> writing. Malaysian statutory parameters change (the EPF foreign-worker
> mandate and the SOCSO wage ceiling are both recent revisions). Implementation
> SHALL seed from the current official publications — KWSP Third Schedule,
> PERKESO Second Schedule, LHDN MTD specification and schedule — and a
> verification gate against those sources is a release condition (§A7).
> No figure in this document is a substitute for the official table.

### MYP-001 — EPF (Employees Provident Fund Act 1991)

EPF SHALL be computed by **wage-band lookup against the KWSP Third Schedule**,
not as a flat percentage of capped wages. The lookup is dimensioned by wage band,
employee age and citizenship status. Above the Third Schedule's upper bound the
statutory percentages apply directly.

Representative structure: employee ~11% and employer ~12–13% (rate varying by a
wage threshold) below age 60, with reduced rates above it; foreign workers now
in scope following the EPF Act amendment.

**Acceptance:** for every row of the published Third Schedule, computed employee
and employer amounts equal the published amounts exactly.

### MYP-002 — SOCSO / PERKESO (Employees' Social Security Act 1969)

SOCSO SHALL be computed by wage-band lookup against the PERKESO Second Schedule,
under two categories:

- **Category 1** — employee below 60: Employment Injury *and* Invalidity
  schemes; representative employer 1.75%, employee 0.5%.
- **Category 2** — employee 60 or above, and foreign workers: Employment Injury
  scheme only; employer contribution only, no employee share.

**Acceptance:** category assignment follows age and citizenship automatically;
every published band row reconciles exactly.

### MYP-003 — EIS / SIP (Employment Insurance System Act 2017)

EIS SHALL be computed by wage-band lookup, representative 0.2% employer and 0.2%
employee, and SHALL exclude employees aged 60 and above and foreign workers.

**Acceptance:** excluded categories produce zero; every band row reconciles.

### MYP-004 — PCB / MTD (Income Tax (Deduction from Remuneration) Rules 1994)

The system SHALL implement the **LHDN computerised calculation method** — not
schedule-table lookup — for monthly tax deduction.

Normal remuneration follows `MTD = [(P − M) × R + B − (Z + X)] / (n + 1)`, where
`P` is chargeable income for the year projected from current remuneration net of
allowable reliefs; `M`, `R` and `B` are the band floor, rate and cumulative tax
of the applicable band; `Z` is accumulated zakat paid; `X` is accumulated MTD
paid; and `n` is remaining months.

Reliefs SHALL include individual relief, spouse relief where the spouse is not
employed, relief per qualifying child, and EPF contributions subject to the
statutory annual cap. **Additional remuneration** (bonus, director's fee,
arrears) SHALL follow the separate additional-remuneration formula, not the
normal-remuneration formula.

Employees SHALL be classified into MTD category 1 (single), 2 (married, spouse
not employed) or 3 (married with employed spouse, or divorced).

This requirement has no Singapore analogue: IRAS assesses annually and the
employer only reports, whereas a Malaysian employer computes and remits monthly.

**Acceptance:** computed PCB reconciles to the official LHDN calculator at zero
tolerance across a matrix of categories 1–3 × income levels × child counts ×
bonus and non-bonus months. See §A7.

### MYP-005 — HRD Corp levy (PSMB Act 2001)

The levy SHALL be computed on the wages of **Malaysian employees only**:
mandatory 1% for employers with 10 or more Malaysian employees, 0.5% for
employers with 5 to 9 who have registered. Registration status is an entity-level
election under ENT-004.

**Acceptance:** headcount-driven rate selection is automatic; foreign employees
are excluded from the levy base; an unregistered employer below the mandatory
threshold produces zero.

### MYP-006 — Zakat

The system SHALL support a voluntary monthly zakat deduction per employee, and
SHALL apply it as a rebate within the PCB computation (`Z` in MYP-004).

**Acceptance:** an enrolled employee's PCB is reduced by zakat paid; zakat
appears as a distinct payslip line.

### MYP-007 — Payslip and payment output

Malaysian payslips SHALL be denominated in MYR and SHALL itemise EPF (employee
and employer), SOCSO (employee and employer), EIS (employee and employer), PCB
and zakat as distinct lines. Employer-borne contributions and the HRD Corp levy
SHALL be reported as employer cost, not deducted from the employee.

Bank payment output SHALL support Malaysian formats. GIRO (SG) is unchanged.

**Acceptance:** a Malaysian payslip shows every statutory line separately with
its own basis, and employer contributions never reduce employee net pay.

---

## A4. New requirement group: MYL — Malaysia employment terms

### MYL-001 — Service-tiered statutory leave (Employment Act 1955, as amended 2022)

Statutory leave entitlement SHALL be a function of completed service, amending
v2.0's flat annual entitlement per leave type:

| Leave | < 2 years | 2 to < 5 years | ≥ 5 years |
|---|---|---|---|
| Annual leave | 8 days | 12 days | 16 days |
| Sick leave (outpatient) | 14 days | 18 days | 22 days |

Hospitalisation leave SHALL be up to 60 days, inclusive of outpatient sick leave
taken.

**Acceptance:** entitlement recalculates as an employee crosses a service
threshold; the transition is applied from the correct date, not retrospectively.

### MYL-002 — Maternity and paternity

Maternity leave SHALL be **98 consecutive days**. Paternity leave SHALL be
**7 consecutive days**, available to a married employee with at least 12 months'
service, for up to 5 confinements.

Note the Singapore-specific leave types in v2.0 — childcare leave, extended
childcare leave, shared parental leave, national service leave, and the
government-paid leave reimbursement claims associated with them — have **no
Malaysian statutory equivalent** and SHALL NOT be presented for Malaysian
entities.

**Acceptance:** Malaysian entitlements are correct and consecutive-day (not
working-day) counted; Singapore-only leave types are absent for MY entities.

### MYL-003 — Overtime (Employment Act 1955 s.60A)

Overtime SHALL be computed at differentiated multipliers, amending v2.0's single
1.5× assumption:

| Day type | Multiplier |
|---|---|
| Normal working day | 1.5× |
| Rest day | 2.0× |
| Public holiday | 3.0× |

Normal weekly hours for Malaysian entities SHALL default to **45**, amending the
44-hour Singapore default.

**Acceptance:** the same overtime hours on a normal day, rest day and public
holiday produce three different amounts in the correct ratio.

### MYL-004 — Public holidays, federal and state

The system SHALL support a minimum of 11 gazetted public holidays for Malaysian
entities, of which 5 are compulsory (National Day, Birthday of the Yang
di-Pertuan Agong, Birthday of the Ruler or Federal Territory Day, Labour Day,
Malaysia Day), plus the applicable **state** holiday set determined by
`LegalEntity.state`.

A tenant holding entities in more than one country SHALL be able to hold
different holidays on the same calendar date. (v2.0's holiday model is unique per
tenant and date, which prevents this.)

**Acceptance:** a group tenant holds a Malaysian state holiday and a Singapore
holiday on the same date without conflict; each entity's payroll and leave
calculations observe only its own set.

### MYL-005 — Termination notice

Statutory minimum notice SHALL follow the Employment Act service bands (4, 6 or
8 weeks by length of service), where a contractual period is not longer.

**Acceptance:** offboarding proposes the correct statutory minimum for a
Malaysian employee's service length.

---

## A5. New requirement group: MYD — Malaysia employee data

### MYD-001 — Identity

The system SHALL support **MyKad** as an identity type for Malaysian citizens
and permanent residents, and passport for foreign employees, alongside the
existing NRIC and FIN types.

MyKad SHALL receive the same protection as NRIC — AES-256-GCM encryption at rest
— and SHALL be added to the AI assistant's PDPA redaction patterns, so it is
never transmitted to an external model provider.

**Acceptance:** MyKad is encrypted at rest and is redacted from assistant tool
results on the external-provider path.

### MYD-002 — Statutory registrations and tax profile

Malaysian employees SHALL carry EPF membership number, SOCSO number and income
tax reference number, and the tax profile PCB requires: marital status, whether
the spouse is employed, number of qualifying children, prior-relief position and
zakat enrolment.

Required fields SHALL be validated **before** a payroll run computes, and
missing data SHALL be reported as a list of affected employees rather than
surfacing as a mid-run failure.

**Acceptance:** a run containing an employee with an incomplete tax profile is
rejected up front, naming the employee and the missing fields, with no payslips
written.

### MYD-003 — Malaysian employer registrations

Each Malaysian legal entity SHALL carry its EPF employer number, SOCSO employer
code, LHDN employer number (E number) and HRD Corp registration where
applicable. These appear on statutory submission files.

**Acceptance:** submission files carry the correct employer registrations; an
entity missing a registration required by a file cannot generate that file.

---

## A6. New requirement group: MYF — Malaysia statutory filing

### MYF-001 — Monthly submissions

The system SHALL generate monthly statutory submissions, each due by the 15th of
the following month:

| Submission | Authority | Content |
|---|---|---|
| CP39 | LHDN | Monthly PCB by employee |
| Borang A | KWSP | Monthly EPF contributions |
| Borang 8A | PERKESO | Monthly SOCSO contributions |
| Lampiran 1 | PERKESO | Monthly EIS contributions |

**Acceptance:** each file is generated in the authority's published format from
finalised payroll only, and reconciles to the payroll run totals.

### MYF-002 — Annual returns

- **EA Form (CP8A)** — annual statement of remuneration to each employee, by the
  end of February.
- **Form E (CP8D)** — annual employer return to LHDN, by 31 March.

**Acceptance:** annual figures reconcile to the sum of that year's finalised runs
for the entity; EA Form is distributable to employees through the existing
payslip distribution path.

### MYF-003 — Event-driven notifications

- **CP22** — new employee notification, within 30 days of commencement.
- **CP22A** — cessation of employment, not less than 30 days before cessation.
- **CP21** — employee leaving Malaysia.

These SHALL reuse the existing statutory-submission lifecycle
(DRAFT → SUBMITTED → ACKNOWLEDGED / REJECTED) and deadline-urgency classification
defined in v2.0 for IRAS submissions, with Malaysian deadline rules. CP22A and
CP21 SHALL be triggered from offboarding, as IR21 is today.

**Acceptance:** the correct notification is raised automatically on hire and on
offboarding initiation, with the statutory deadline computed and urgency
escalating as it approaches.

---

## A7. Compliance verification gate (release condition)

The following SHALL be satisfied before Malaysian payroll is offered to a paying
customer. This is a release gate, not a testing preference.

1. **Rate provenance.** Every seeded EPF, SOCSO, EIS, PCB-band and HRD Corp value
   is traceable to a named official publication with its retrieval date recorded.
2. **Band reconciliation.** Every row of the published KWSP Third Schedule and
   PERKESO Second Schedule is covered by a test asserting the published amount.
   Expected values are transcribed from the publications, never hand-derived.
3. **PCB differential.** Computed PCB reconciles to the official LHDN calculator
   at **zero tolerance** across categories 1–3 × income levels × child counts ×
   bonus and non-bonus months.
4. **Singapore non-regression.** The complete existing Singapore payroll suite
   passes unchanged. No Singapore statutory output may differ by any amount.
5. **Filing format validation.** Each submission file is accepted by the relevant
   authority's validation tooling where one is published.

---

## A8. Amendments to existing v2.0 requirements

| v2.0 reference | Amendment |
|---|---|
| Target Market (§1.1) | Extends to Malaysia; Singapore compliance claims remain unchanged for SG entities |
| §16 Singapore Regulatory Compliance Matrix | Retained for SG entities; §A9 adds the Malaysia matrix |
| Payroll run identity | Scoped to legal entity + period, not tenant + period |
| Statutory rate administration | Moves from tenant-editable to platform-managed (ENT-004) |
| LEA-* entitlement model | Flat annual entitlement extended by service-tiered rules for MY (MYL-001) |
| Overtime computation | Single 1.5× multiplier extended to day-type multipliers for MY (MYL-003) |
| Public holiday model | Extended to permit differing holidays per country on the same date (MYL-004) |
| Employee identity types | Extended with MyKad and passport (MYD-001) |
| Currency | SGD assumption replaced by per-entity currency (ENT-001) |

---

## A9. Malaysia Regulatory Compliance Matrix

| Instrument | Obligation | Requirement |
|---|---|---|
| Employees Provident Fund Act 1991 | EPF contributions by Third Schedule band | MYP-001 |
| Employees' Social Security Act 1969 | SOCSO Category 1 / 2 contributions | MYP-002 |
| Employment Insurance System Act 2017 | EIS contributions | MYP-003 |
| Income Tax (Deduction from Remuneration) Rules 1994 | Monthly tax deduction (PCB/MTD) | MYP-004 |
| Income Tax Act 1967 | CP39, EA Form (CP8A), Form E (CP8D), CP21/22/22A | MYF-001–003 |
| PSMB Act 2001 | HRD Corp levy | MYP-005 |
| Employment Act 1955 (amended 2022) | Leave, hours, overtime, holidays, notice | MYL-001–005 |
| Personal Data Protection Act 2010 (MY) | Protection of employee personal data | MYD-001 |
| *Labour Ordinance (Sabah) Cap. 67* | *East Malaysian employment* | **Out of scope — §A1.2** |
| *Labour Ordinance (Sarawak) Cap. 76* | *East Malaysian employment* | **Out of scope — §A1.2** |

---

## A10. Assumptions and constraints

1. Statutory figures require verification against official sources before
   go-live (§A7). No figure in this amendment is authoritative.
2. Peninsular Malaysia only in v1. East Malaysian employment is not supported
   and must not be represented as compliant (§A1.2).
3. A tenant may hold entities in several countries, but a payroll run is always
   single-entity and therefore single-country.
4. Malaysia observes UTC+8 with no daylight saving, as Singapore does, so the
   existing business-timezone date handling applies unchanged with a per-entity
   timezone value.
5. Existing Singapore customers experience no functional change. Any Singapore
   statutory output difference is a defect, not an accepted consequence.
6. Statutory rate correctness after go-live depends on the platform operator
   applying published revisions. ENT-004 makes this a single action per country;
   it does not make it automatic.

---

*Amendment A to PRD-HRMS-001 v2.0. Engineering design: `docs/superpowers/specs/2026-08-02-malaysia-localization-design.md`.*
