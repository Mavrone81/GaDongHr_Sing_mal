# Implementation Status

**PRD Reference:** PRD-HRMS-001 v2.0  
**Last Updated:** 2026-05-26 _(Gap analysis vs SG HRMS market — 8 new modules added: FWA, OT Auth, WICA, E-Sign, PDPA, Benefits, Disciplinary, Staff Movement, Loans, Analytics, Surveys, Succession)_  
**Legend:** ✅ Done · ⚠️ Partial · ❌ Not Done

---

## Summary

| Module | Done | Partial | Not Done | Total |
|--------|------|---------|----------|-------|
| Payroll & CPF | 11 | 1 | 0 | 12 |
| Leave Management | 7 | 0 | 0 | 7 |
| Claims & Expenses | 4 | 0 | 0 | 4 |
| Recruitment & Onboarding | 5 | 0 | 0 | 5 |
| Time & Attendance | 5 | 0 | 0 | 5 |
| Performance Management | 6 | 0 | 0 | 6 |
| Training & Development | 3 | 1 | 0 | 4 |
| Asset Management | 4 | 0 | 0 | 4 |
| Offboarding | 5 | 0 | 0 | 5 |
| Reporting & Analytics | 3 | 0 | 0 | 3 |
| Support & Ticketing | 4 | 0 | 0 | 4 |
| **Compliance & Statutory** _(new)_ | 3 | 0 | 0 | 3 |
| **Benefits Administration** _(new)_ | 2 | 0 | 0 | 2 |
| **HR Case Management** _(new)_ | 1 | 0 | 0 | 1 |
| **Employee Services** _(new)_ | 3 | 0 | 0 | 3 |
| **Analytics & Engagement** _(new)_ | 2 | 0 | 1 | 3 |
| **Total** | **67** | **2** | **2** | **71** |

---

## Module 1: Payroll & CPF Management

### ✅ PAY-001 — Payroll Run Types & Workflow
**Status:** Done _(completed 2026-05-24)_  
Monthly run (initiate → compute → approve → finalise → lock), ad-hoc/off-cycle supplemental runs, maker-checker approval, variance report, period consolidation, EA s.20 working-day pro-rating for partial-month joiners/leavers.

**2026-05-24 additions (closing PAY-001):**
- **Bi-monthly run type** — `BIMONTHLY` added to `RunType` enum + new `PeriodHalf` enum (`FIRST` | `SECOND`) on `PayrollRun`. Unique constraint widened to `[period, runType, periodHalf]`. POST /runs validates: BIMONTHLY requires `periodHalf`; all other types reject `periodHalf`. Compute uses `computePeriodBoundaries(period, runType, periodHalf)` → FIRST=days 1-15, SECOND=days 16-end-of-month (Feb leap-year handled). FIRST and SECOND halves coexist for the same period; each gets its own run lifecycle.
- **Supplemental auto-trim** — On compute, ADHOC/BONUS/COMMISSION runs fetch published payslips from prior runs in the same period. For each employee already paid: `trimSupplementalEmployee()` zeroes `emp.ow / aw / grossPay` and carries forward YTDs from the prior payslip so CPF ceilings stay correct. The supplemental payslip then only carries the paycode delta (e.g., +$500 bonus AW), no double-count of base salary when `consolidatePeriod` later sums runs. Trimmed employees with no paycodes are auto-removed from the run. Response surfaces `autoTrimmedIds` and `autoRemovedIds`.
- **Maker-checker enforced at DB level** — `db-constraints.js` on service startup adds a PostgreSQL CHECK constraint `payroll_runs_maker_checker_diff` (`approved_by IS NULL OR approved_by <> initiated_by`), idempotently. The approve route translates a violation of this constraint into a 403 (in addition to the existing app-level check at `payroll.routes.js`).
- **Tests** — 18 new unit tests on the pure `run-types.js` engine (predicates, period boundaries incl. Feb leap-year, trim mutation, validation) + 12 new integration tests (K1-K6 bi-monthly POST validation; K7-K10 auto-trim behaviour on compute; K11-K12 maker-checker DB+app violations). Full payroll suite: **236 tests green**.

### ✅ PAY-002 — CPF Auto-Calculation
**Status:** Done  
All CPF age bands (SC/PR3+ all ages, PR Year 1/2, Foreigner), OW ceiling SGD 7,400/mth (Jan 2026), AW ceiling (SGD 102,000 − OW YTD), cents-rounding rule, rate table admin UI for Super Admin.

### ✅ PAY-003 — Gross Pay & OT Computation
**Status:** Done  
Gross pay formula, OT at 1.5× hourly basic rate, 72-hour monthly cap with HR override, rest day pay (employee/employer request rates), PH work pay + OIL, AWS pro-ration, shift differentials.

### ✅ PAY-004 — SDL & FWL Computation
**Status:** Done _(completed 2026-05-25)_  
SDL min(max(Gross × 0.25%, SGD 2.00), SGD 11.25) per employee, SDL submission file, FWL rate table per sector/tier/pass-type, and DRC (Dependency Ratio Ceiling) quota monitoring with MOM-compliance alerts.

**DRC engine (`src/engines/drc.engine.js`):** Pure — no DB. `groupBySector(employees)` classifies employees into `LOCAL` (SC/PR) / `WP` / `S_PASS` buckets per sector; EP/DP/LTVP holders are exempt. `computeDrcStatus(sectorGroups, quotas)` computes current ratio vs ceiling per sector × passType, returns `OK` / `WARNING` (≥80% of ceiling) / `EXCEEDED`, plus `remainingHeadroom`, `usagePct`, and `totalHeadcount`. Falls back to `MOM_DEFAULTS` when no DB quotas are seeded.

**MOM 2024 ceilings (built-in defaults):**
- Services: WP 15%, S-Pass 15%
- Construction / Marine / Process: WP 83%, S-Pass 18%
- Manufacturing: WP 60%, S-Pass 15%

**New schema model** `DrcQuota` (`sector`, `passType`, `maxRatioPct`, `alertThreshPct`, unique on `[sector, passType]`).

**New API routes (payroll-service):**
- `GET /payroll/drc-status` — fetches all active employees from employee-service, groups by sector, runs engine, returns `{ summary, results, asOf }`. 503 if employee-service unreachable.
- `GET /components/drc-quotas` — list quotas; returns MOM defaults with `isDefault=true` if table is empty.
- `POST /components/drc-quotas/seed` — upsert MOM 2024 DRC defaults (SUPER_ADMIN only, idempotent).
- `PUT /components/drc-quotas/:id` — update `maxRatioPct` / `alertThreshPct` with validation.

**Frontend (payroll/page.tsx):** `AdminPayrollDashboard` now loads `/payroll/drc-status` on mount and renders a banner at the top of the page when any sector is in `WARNING` or `EXCEEDED` state — red for EXCEEDED, amber for WARNING — listing each offending sector, current ratio, and ceiling.

**Tests:** 21 unit tests (`drc.engine.unit.test.js`) covering groupBySector (WP/S_PASS/local/EP-exempt/default-sector), computeDrcStatus (OK/WARNING/EXCEEDED/sort/headroom/fallback-to-defaults), MOM_DEFAULTS coverage. 19 integration tests (`drc-api.integration.test.js`) covering auth (403 EMPLOYEE), 503 on employee-service failure, usingDefaults flag, quota seeding idempotence, PUT validation. 40 tests total, all green.

### ✅ PAY-005 — Payslip Generation (MOM Mandatory)
**Status:** Done _(completed 2026-05-25)_  
Full MOM EA s.96 itemised payslip PDF, payment-date SLA tracking with daily sweep + HR alerts, multi-channel publish notifications (in-app + email + mobile push hint), and a 5-year archive with searchable index.

**PDF engine (`src/engines/pdf.engine.js`):** Pure wrapper around PDFKit. `buildPayslipPdf(stream, data)` renders an A4 MOM-compliant payslip with all 11 mandatory fields (employer name + UEN, employee name/ID/NRIC-last-4/department/designation, pay period dates, payment date, basic salary, itemised allowances, OT hours + rate + amount, itemised deductions including Employee CPF + NPL, net pay, Employer CPF, SDL, FWL, YTD Gross/Employee CPF/Employer CPF). Includes govt-paid leave line when present, EA s.96 compliance footer, and publication timestamp. `splitLineItems(items)` routes raw `PayrollLineItem` rows into allowances / OT / deductions based on `wageType` + amount sign + componentCode prefix.

**SLA engine (`src/engines/sla.engine.js`):** Pure — classifies one run's SLA state per MOM EA s.21 (salary paid within 7 days of period end). Three alert types: `PAYMENT_DATE_APPROACHING` (≤ 2 days, run not yet FINALISED, MEDIUM/HIGH based on day), `UNPUBLISHED_PAST_PAYMENT` (paymentDate ≤ now and some payslips still unpublished, severity ladders MEDIUM→HIGH→CRITICAL with daysOverdue), `LATE_PUBLICATION` (all published but latest publishedAt > paymentDate). `isAlertResolved` lets the sweep auto-resolve stored alerts when the violation goes away.

**Payment-date wiring:**
- `POST /payroll/runs` accepts `paymentDate`; defaults to period-end + 7 days (MOM cap)
- `PATCH /payroll/runs/:id` allows updating `paymentDate` until FINALISED (409 otherwise)
- Run finalise stamps `Payslip.publishedAt = finalisedAt` + fires fan-out notifications

**Publish notifications:** `sendPublishNotifications(run, authHeader)` resolves all published payslips → fetches employees via `EMPLOYEE_SERVICE_URL/employees/by-ids` → for each fires a `PAYSLIP_PUBLISHED` notification with `channels: ['IN_APP', 'EMAIL' (if email known), 'MOBILE_PUSH' (if phone known)]` to `NOTIFICATION_SERVICE_URL/notifications/send`. Stamps `Payslip.notifiedAt` on success. Failures logged but never block. Manual re-fire: `POST /payroll/runs/:id/notify-published` (409 if not FINALISED). Called automatically by the finalise route as fire-and-forget.

**Daily SLA sweep:** `POST /payroll/payslips/sla/sweep` runs the engine against all runs with `paymentDate ≥ now − 30 days`, upserts `PayslipSlaAlert` via `@@unique([runId, type])`, and resolves stored alerts whose violations are gone. **Scheduled daily at 00:15 SGT** (armed in service boot via `schedulePayslipSlaSweep()`, skipped under NODE_ENV=test). `GET /payroll/payslips/sla/alerts?type=&severity=&includeResolved=` returns active alerts (default excludes resolved) with `summary.byType/bySeverity`.

**5-year archive + search:** `GET /payroll/payslips/archive?employeeId=&fromYear=&toYear=&search=&page=&limit=` returns paginated payslip index with decrypted netPay/grossPay/ytdGross + payment dates. Default window: current year minus 4 (5-year window). Employees can only query own (`employeeId` query param is force-overwritten to `req.user.employeeId`); 403 if no employee profile linked. Admins (SUPER_ADMIN/HR_ADMIN/PAYROLL_OFFICER) can query anyone. `search` filters periods by substring (e.g. "2025-03" or "2025").

**Schema additions:** `PayrollRun.paymentDate DateTime?`; `Payslip.publishedAt DateTime?` + `Payslip.notifiedAt DateTime?` + index on `publishedAt`; new `PayslipSlaAlert` model (unique `(runId, type)`, severity/daysOverdue/unpublishedCount/message/resolvedAt fields, indexes on type + resolvedAt); new `SlaAlertType` enum.

**Route ordering note:** `PAYSLIP_RESERVED = {sla, archive, me}` guards `GET /payslips/:employeeId/:period` so the wildcard doesn't shadow sibling routes.

**Tests (37 new, 336 total green):** 14 unit tests on `sla.engine.js` (severityFor ladder, daysBetween UTC alignment, PAYMENT_DATE_APPROACHING window + finalised skip + TODAY elevation, UNPUBLISHED_PAST_PAYMENT count + daysOverdue + CRITICAL severity, LATE_PUBLICATION boundary + skip when on-time, paymentDate=null short-circuit, isAlertResolved positive + negative) + 6 unit tests on `pdf.engine.js` (sgd formatter, splitLineItems DEDUCTION wageType + negative-amount + OT sum + allowance fallback, buildPayslipPdf PDF header smoke + byte size scales with content + minimal-data resilience) + 17 integration tests P1-P17 (POST /runs paymentDate default + explicit, PATCH /runs/:id update + 409 finalised + 404 missing, SLA sweep create + idempotent update + auto-resolve, list filtering + default exclude resolved + includeResolved flag, notify-published fan-out + 409 + 404, archive admin + employee-self forced + 403 unlinked). Full payroll suite: **336 tests green** (37 new + 299 pre-existing — no regressions).

### ✅ PAY-006 — Bank GIRO File Generation
**Status:** Done _(completed 2026-05-26)_  
Bank-specific fixed-width GIRO formats for UOB (615-char), OCBC (1000-char), DBS (114-char); generic CSV stub for SCB/HSBC/Maybank (pending bank-spec receipt, flagged via `X-Bank-Format-Status` response header). ACK reconciliation: fire-and-forget payment ledger on file generation, `GET /bank-giro/:runId/payments` for live status dashboard, `POST /bank-giro/:runId/ack` parses CSV and DBS return files to mark RETURNED/SENT statuses with return codes.

**Schema:** `GiroPayment` model (`runId`, `employeeId`, `bank`, `bankCode`, `bankAccount`, `amountEnc`, `status` PENDING/SENT/RETURNED/FAILED, `returnCode`, `returnReason`, `generatedAt`, `processedAt`).

**Tests:** 15 integration tests GR-01–GR-15 — UOB/OCBC/DBS format validation, generic CSV for SCB/HSBC/Maybank, unknown-bank 400, non-finalised 400, payment ledger persistence, payments summary endpoint, CSV ACK 2-way match, DBS fixed-width ACK return code parse, missing fileContent 400, no-prior-records 400, unmatched account counting. All 448 payroll tests green.

### ✅ PAY-007 — CPF e-Submit & IRAS AIS Filing
**Status:** Done _(completed 2026-05-25)_  
Full submission tracking ledger covering CPF e-Submit, IR8A, Appendix 8A, Appendix 8B, IR21 — with auto-deadline computation, status workflow, IRAS / CPF reference number capture, file-integrity hashing, and a daily deadline-urgency dashboard. (Appendix 8A/8B + IR21 auto-population already shipped in PAY-010 + OFF-004.)

**Engine (`src/engines/iras-submission.engine.js`):** Pure — no DB. `computeDeadline(kind, scope)` returns the statutory deadline Date: CPF_E_SUBMIT → 14th of month following the wage period (handles Dec → Jan rollover); IR8A / APPENDIX_8A / APPENDIX_8B → 1 Mar of the year after the income year (IRAS AIS rule); IR21 → lastWorkingDate − 30 days (IRAS foreign-employee rule). `classifyUrgency(deadline, now)` ladders OVERDUE / CRITICAL (≤ 3 d) / WARNING (≤ 14 d) / NOTICE (≤ 30 d) / OK / UNSCHEDULED. `validateTransition(from, to)` guards the state machine `DRAFT → SUBMITTED → ACKNOWLEDGED / REJECTED` with `REJECTED → DRAFT` for resubmission. `buildTransitionPatch(toStatus, actor, extras)` returns the timestamp + actor + reference-number patch the route should merge.

**Routes (mounted at `/payroll/iras-submissions`):**
- `POST` — record / refresh a submission. Auto-computes deadline from `kind` + `scope`. Accepts `fileContentBase64` for auto SHA-256 hash + size capture (or accepts pre-computed `fileHash`). Idempotent on `(kind + scope)` — re-recording updates file metadata + deadline but never clobbers `status` or `referenceNumber`. Per-kind scope validation (period for CPF, year for IR8A/8A/8B, employeeId for IR21).
- `GET` — filtered list (`kind`, `status`, `period`, `year`, `employeeId`) with `summary.byStatus / byKind / byUrgency`.
- `GET /deadlines?withinDays=N` — dashboard of non-ACKNOWLEDGED submissions within window (default 60d), always includes OVERDUE. Returns urgency-bucketed summary.
- `GET /:id` — single submission with computed urgency.
- `PUT /:id` — transition status with mandatory checks: SUBMITTED requires `referenceNumber`, REJECTED requires `rejectedReason`. ACKNOWLEDGED is terminal. Allows reference-only updates without status change.
- `DELETE /:id` — only allowed while DRAFT (409 otherwise).
- `POST /sweep` — manual deadline urgency tally trigger.

**Auto-ledger on file generation:** existing `GET /payroll/cpf-file/:runId` and `GET /payroll/ir8a-file/:year` now upsert a DRAFT `IrasSubmission` row as a fire-and-forget side-effect — capturing fileHash (SHA-256), fileSize, fileName, runId. Finance later transitions the row to SUBMITTED with the CPF / IRAS reference number. Re-downloading the same file refreshes hash + deadline without overwriting status.

**Daily deadline sweep:** scheduled at 00:25 SGT in `src/index.js` (`scheduleIrasDeadlineSweep`, skipped under NODE_ENV=test). Runs `runDeadlineSweep()` which scans all non-ACKNOWLEDGED submissions with deadlines and logs counts per urgency band — wire-point for future notification fan-out.

**Schema additions:** `IrasSubmission` model (kind, period, year, employeeId, runId, fileName, fileHash, fileSize, status, referenceNumber, submittedBy/At, acknowledgedBy/At, rejectedReason/At, deadline, notes, createdBy) + indexes on kind/status/deadline/year/period. Enums `IrasSubmissionKind` (5 values) and `IrasSubmissionStatus` (4 values).

**Tests (57 new, 393 total green):** 32 unit tests on `iras-submission.engine.js` (KINDS + STATUSES whitelists, deadline computation for all 4 kinds incl. December → January wrap + invalid period + missing year + missing LWD + unknown kind, urgency classification across all 6 bands incl. UNSCHEDULED, validateTransition all permitted paths + ACKNOWLEDGED terminal + same-status reject + unknown-target reject, buildScopeKey for all kinds, buildTransitionPatch SUBMITTED/ACKNOWLEDGED/REJECTED stamps + DRAFT resubmission clears) + 25 integration tests I1-I25 (POST happy + idempotent refresh + auto-hash from base64 + scope validation per kind + role guard, GET list + summary + filter, deadlines dashboard non-ACKNOWLEDGED filter + withinDays honoured, GET :id urgency + 404, PUT transitions with required-field guards + 409 on invalid transitions + ACKNOWLEDGED terminal + reference-only update + ACKNOWLEDGED stamp + REJECTED → DRAFT clears, DELETE only-DRAFT + 409, sweep bucket counts). Full payroll suite: **393 tests green** (57 new + 336 pre-existing — no regressions).

### ✅ PAY-008 — Maker-Checker Approval & Audit Trail
**Status:** Done  
Two-level approval, variance report required before finalisation, payroll locked on finalise, ad-hoc correction run required to amend locked payroll, immutable audit log.

### ✅ PAY-009 — Salary Revision History & Back-Dating
**Status:** Done _(implemented 2026-05-23)_  
Full revision workflow: `POST /:id/salary-revisions` (PENDING), `PUT /:id/salary-revisions/:revId/approve` (applies salary + computes catch-up = Δsalary × months elapsed), `PUT /:id/salary-revisions/:revId/reject`, `GET /salary-revisions/pending` (HR-wide queue), `GET /salary-revisions/budget-envelope?year=YYYY` (Σ annual delta). Reason codes: PROMOTION, ANNUAL_INCREMENT, MARKET_ADJUSTMENT, ROLE_CHANGE, CORRECTION, OTHER. All salary data AES-256 encrypted. Frontend UI with revision modal, KPI cards, and status-aware table.

### ✅ PAY-010 — Benefits-in-Kind & Appendix 8A/8B Tracking
**Status:** Done _(implemented 2026-05-23)_  
BIK item CRUD with IRAS formula computation (`POST/GET/PUT/DELETE /payroll/bik-items`) covering all 4 PRD types: COMPANY_CAR (3/7 × purchase cost + optional 3/7 × running cost if employer provides fuel), HOUSING (IRAS-assessed AV less employee contribution), CLUB_MEMBERSHIP, GROUP_INSURANCE, OTHER (manual). Stock option lifecycle (`POST/GET/PUT/DELETE /payroll/stock-options`) and exercise events (`POST /payroll/stock-options/:id/exercises`) with taxable gain = max(0, (OMV − optionPrice) × shares). Annual aggregation endpoints: `GET /payroll/appendix-8a/:year`, `GET /payroll/appendix-8a-file/:year`, `GET /payroll/appendix-8b/:year`, `GET /payroll/appendix-8b-file/:year`, all in IRAS pipe-delimited flat-file format. Existing `GET /payroll/ir8a-data/:year` and `/ir8a-file/:year` now fold in BIK + ESOP totals per employee (regression-tested). All monetary fields AES-256 encrypted. 18 unit tests for IRAS formulas (`bik-engine.unit.test.js`) + 23 integration tests (`bik-api.integration.test.js`) including 2 IR8A regression tests.

### ✅ PAY-011 — Government-Paid Leave Integration
**Status:** Done _(completed 2026-05-24)_  
NPL auto-deduction, govt-paid leave type flags, CPF treatment differentiation, and full GPML/GPPL/CCL/SPL/NS make-up pay claim generation and tracking.

**Claim generation:** `POST /payroll/govt-leave-claims/generate?period=YYYY-MM` — calls leave service for approved govt-paid applications in the period, derives per-employee daily rate from the published payslip (`govtPaidAmount ÷ govtPaidDays`), groups by employee × leave type, and upserts one `GovtLeaveClaimPayroll` row per combination. Optional `nsAllowancePerDay` and `employerCpfRate` query params.

**MSF daily caps enforced per type:** ML/PL/SPL SGD 500/day, CCL SGD 100/day (configurable in engine). Rate above cap is clamped; clamped `claimableAmount` stored encrypted.

**NS make-up pay (NSL):** `claimableAmount = nsMakeupAmount = max(0, civilianDailyRate − nsAllowancePerDay) × days`. No MSF cap; MINDEF claim is net employer cost. `nsAllowancePerDay` defaults to 0 (full civilian rate claimed).

**CPF treatment differentiation:** `cpfOnGovtPaidEnc` on each claim row = `claimableAmount × employerCpfRate` — tracks the employer CPF obligation attributable to the govt-reimbursable days for reconciliation.

**Claim tracking:** Status machine PENDING → SUBMITTED → REIMBURSED (or REJECTED from either). `PUT /payroll/govt-leave-claims/:id` transitions status, stamps `submittedAt`/`reimbursedAt`, stores `submissionRef` and `reimbursedAmountEnc`.

**Endpoints:** `GET /payroll/govt-leave-claims` (filterable by period/status/leaveTypeCode/employeeId, paginated), `GET /payroll/govt-leave-claims/summary?period=` (totals by type and status, totalNsMakeup), `GET /payroll/govt-leave-claims/:id`.

**Schema:** New `GovtLeaveClaimPayroll` model with `@@unique([employeeId, period, leaveTypeCode])` + new `GovtClaimStatus` enum (PENDING/SUBMITTED/REIMBURSED/REJECTED).

**Tests:** 37 unit tests on `govt-leave-claims.engine.js` (DAILY_CAPS constants, claimable amount + MSF cap logic, NS formula incl. negative clamp and zero-allowance default, CPF on govt-paid, buildClaimRecord for ML vs NSL, groupLeavesByEmployeeAndType aggregation + exclusion of non-govt-paid types, full transition matrix) + 19 integration tests G1-G19 (period validation, leave-service 502 propagation, no-leave empty response, ML generate + upsert data assertions, employee-skip when no payslip, ML/CCL/PL cap enforcement, NS make-up with and without allowance, list filtering, summary aggregation, status transitions with timestamp stamps, 409 on invalid transitions including skip-step and terminal state). Full payroll suite: **299 tests green**.

### ✅ PAY-012 — Cost Centre & Payroll Journal
**Status:** Done _(implemented 2026-05-23)_  
Cost-centre master CRUD (`POST/GET/PUT/DELETE /cost-centres`) with per-CC GL account overrides (salary/CPF/SDL/FWL/bank). Employee allocations with split-by-percent (`POST /employees/:id/cost-centres`) enforced to sum to 100 ± 0.01. Auto-generated balanced double-entry journal on payroll finalise (Dr Salary Expense split by CC, Dr Employer CPF Expense, Cr Employee/Employer CPF Payable, Cr SDL/FWL Payable, Cr Bank/GIRO Payable, with `9999 Payroll Suspense` plug if unmodeled deductions exist). Idempotent regen via `POST /payroll/runs/:id/journal`. Export in 4 formats: `GET /payroll/runs/:id/journal/export?format=csv|xero|quickbooks|sap` — CSV (header + 2-dp amounts + CC code + employee ID), Xero (manual-journal CSV with debit-positive / credit-negative + tracking categories for cost centres), QuickBooks IIF (TRNS/SPL/ENDTRNS structure), SAP standard journal (debit + credit columns + profit centre). All entry amounts AES-256 encrypted. 18 unit tests for `journal.engine.js` + 20 integration tests including 1 finalise→journal regression. Cost-centre delete blocked if any active allocation exists.

---

## Module 2: Leave Management

### ✅ LEA-001 — Leave Entitlement Engine
**Status:** Done  
All 22 leave types configured; AL increments (7–14 days), sick leave proration by months of service, configurable entitlement per type, eligibility rules, upfront vs monthly accrual, document requirements.

### ✅ LEA-002 — Leave Proration
**Status:** Done  
New joiner pro-ration (join-month counted if on/before 15th), resignee pro-ration, excess leave deduction formula, leave encashment value passed to payroll module.

### ✅ LEA-003 — Approval Workflow
**Status:** Done  
Supervisor chain (ANY_ONE / SEQUENTIAL) per employee, 403 if no supervisors configured, HR Admin / Super Admin bypass, team calendar for coverage check, blackout date blocking, SLA escalation reminders.

### ✅ LEA-004 — MC & Document Tracking
**Status:** Done _(completed 2026-05-25)_  
Document/attachment upload and download per leave application, plus MC abuse pattern detection and sick leave trend analytics.

**Pattern engine (`src/engines/mc-pattern.engine.js`):** Pure — no DB. `expandWeekdays(start, end)` enumerates weekdays (Mon-Fri) in a date range. `detectPatterns(applications, thresholds)` aggregates per-employee Mon/Fri sick day counts, classifies pattern type (`MONDAY_PATTERN` / `FRIDAY_PATTERN` / `MONDAY_FRIDAY_PATTERN`) and severity (`HIGH` ≥75%, `MEDIUM` ≥50%, `LOW`), returns sorted flagged list. Default thresholds: `minOccurrences=3, minRatio=0.5`. `buildTrends(applications, employeeMap)` aggregates `totalDays` + `monthlyBreakdown` per employee and per department.

**New routes (leave-service):**
- `GET /leave/mc-patterns?months=N&minOccurrences=N&minRatio=F` — HR_ADMIN/HR_MANAGER/SUPER_ADMIN only; returns flagged employees enriched with name/dept from employee-service. Sick leave types identified by code pattern (`SICK`/`MC`/`MEDICAL`) or `requiresDocument=true`.
- `GET /leave/sick-leave-trends?months=N` — returns `byEmployee` (top 20) and `byDepartment` sorted by sick days descending.

**Frontend (`leave/page.tsx`):** HR roles (SUPER_ADMIN, HR_ADMIN, HR_MANAGER) now see a `HRLeaveAnalytics` component instead of the employee leave view. Two tabs: **MC Pattern Alerts** (table with pattern type, severity, Mon/Fri counts, ratio bar) and **Sick Leave Trends** (department bar chart + top-20 employee table with 6-month mini-bar sparklines). Month range selector (3/6/12/24) + manual refresh.

**Tests:** 21 unit tests (`mc-pattern.engine.unit.test.js`) covering `expandWeekdays`, `detectPatterns` pattern/severity/sort, `buildTrends` aggregation. 18 integration tests (`mc-patterns.integration.test.js`) covering auth (403 for EMPLOYEE), Monday pattern detection, graceful employee-service failure, empty-types short-circuit, top-20 cap, analysedMonths forwarding.

### ✅ LEA-005 — Government-Paid Leave Tracking & Claims
**Status:** Done _(completed 2026-05-25)_  
Configurable MSF cap engine on LeaveType, pure cap-clamp computation that picks the lowest binding ceiling (daily / weekly / period), full per-application claim lifecycle on the leave-service side complementing payroll PAY-011, plus a payroll-internal daily-rate lookup so leave-service can self-resolve rates without HR keying them in.

**Engine (`src/engines/msf-cap.engine.js`):** Pure — no DB. `computeClaimAmount({ totalDays, dailyRate, leaveType })` returns `{ uncappedAmount, capApplied: 'NONE'|'DAILY'|'WEEKLY'|'PERIOD', capValue, amount, notes }`. Cap precedence: builds candidate totals from every configured cap (5-day work week assumption), picks the SMALLEST as the binding cap, returns it with an explanatory note that quotes the savings. Period cap pro-rates by the fraction of the configured `msfPeriodWeeks` block the leave covers. `validateTransition(from, to)` guards the lifecycle `NOT_SUBMITTED → SUBMITTED → REIMBURSED / REJECTED` with `REJECTED → NOT_SUBMITTED` for resubmission and `NOT_APPLICABLE` / `REIMBURSED` as terminals. `buildClaimRecord(...)` shapes the persistence payload.

**Schema additions:**
- `LeaveType` gains four MSF cap fields — `msfDailyCap` (SGD/day, e.g. CCL 100), `msfWeeklyCap` (SGD/week, e.g. GPPL 2500 / CCL 500), `msfPeriodCap` (SGD per block, e.g. GPML 10000), `msfPeriodWeeks` (block length, GPML = 4).
- `LeaveApplication` gains 10 claim-tracking fields: `claimStatus` (NOT_APPLICABLE/NOT_SUBMITTED/SUBMITTED/REIMBURSED/REJECTED), `claimAmount`, `claimDailyRate`, `claimUncappedAmount`, `claimCapApplied`, `claimSubmissionRef`, `claimSubmittedAt`, `claimReimbursedAt`, `claimReimbursedAmount`, `claimRejectedReason`, `claimNotes` + index on `claimStatus`.
- New `ClaimStatus` enum.

**Routes:**
- `PUT /leave/leave-types/:id/msf-config` — configure caps + period weeks + isGovtPaid flag. Validates non-negative + positive period weeks. 404 on missing leave type, 403 for non-admin.
- `POST /leave/govt-claims/generate?period=YYYY-MM` — iterates APPROVED govt-paid applications in the period, resolves daily rate (via the new payroll-internal lookup or `dailyRateOverrides` body), runs the cap engine, writes the claim record as NOT_SUBMITTED. **Never touches** SUBMITTED / REIMBURSED rows — idempotent and safe to re-run. Returns generated / untouched / skipped counts plus per-row details.
- `GET /leave/govt-claims?period=&status=&leaveTypeCode=&employeeId=` — filtered list with `summary.byStatus / byLeaveType / totalClaimable / totalReimbursed`.
- `GET /leave/govt-claims/summary?period=YYYY-MM` — per-leave-type roll-up with days, claimable, reimbursed, and status breakdown.
- `PUT /leave/govt-claims/:applicationId/status` — walks the lifecycle with required fields: SUBMITTED needs `submissionRef` (stamps `claimSubmittedAt`), REIMBURSED needs `reimbursedAmount` (stamps `claimReimbursedAt`), REJECTED needs `rejectedReason`. NOT_SUBMITTED resubmission clears the prior rejection breadcrumb. 409 on illegal transitions; 400 when the leave type isn't `isGovtPaid`.

**Payroll cross-service wiring:** New internal endpoint `GET /payroll/internal/daily-rate/:employeeId/:period` (x-internal-service-key auth) returns `{ dailyRate, source }`. Prefers the payslip's exact govt-paid daily rate (`govtPaidAmountEnc ÷ govtPaidDays`) when present; falls back to `basicSalary ÷ 22` (SG standard working days/month). Falls through to the most recent published payslip if none in the exact period. Leave-service `resolveDailyRate()` calls this and fails soft to 0 (the row is then "skipped" with a clear reason rather than crashing the generate).

**Tests (48 new, 91 total green on leave-service · 393 still green on payroll):** 24 unit tests on `msf-cap.engine.js` (constants, no-cap / zero-input branches, DAILY clamp, WEEKLY pro-rate including fractional weeks, PERIOD cap full + pro-rated, multi-cap "smallest binds" precedence, notes content, buildClaimRecord shape, validateTransition all permitted paths + REIMBURSED terminal + NOT_SUBMITTED→REIMBURSED skip blocked + same-status reject + unknown from-state) + 24 integration tests M1-M24 (msf-config save / null-clear / validation / 404 / 403, generate happy + untouched-on-submitted + skip-when-no-rate + dailyRateOverrides honoured + period validation + role guard, list with summary + filter pass-through, summary aggregation per leave type, status transition with required-field guards + REJECTED-clears-on-resubmission + 409 on illegal + 404 on missing + 400 on non-govt-paid).

### ✅ LEA-006 — Leave Liability Report
**Status:** Done  
`GET /reports/leave-liability` aggregates unused leave days × (monthly basic ÷ 26) per employee. Department and organisation totals. Absenteeism rate formula included.

### ✅ LEA-007 — Carry-Forward & Year-End Processing
**Status:** Done _(implemented 2026-05-23)_  
Year-end carry-forward engine (`src/engines/year-end.engine.js`) computes per-employee unused balance, caps at `leaveType.maxCarryForward` (negative = unlimited; 0 = no carry-forward), forfeits excess into `expiredDays`. New `carryForwardExpiry` column on `leave_entitlements` (DateTime, indexed) — default 31 Dec 23:59:59 SGT of target year, fully overridable per year-end run via `expiryDate` parameter. Endpoints: `POST /leave/year-end/preview` (dry-run report), `POST /leave/year-end/process` (writes next-year entitlements with capped carry-forward + expiry stamp via transactional upsert), `POST /leave/year-end/expire` (manual expiry sweep — zeros `carryForward`, moves residual into `expiredDays`), `GET /leave/year-end/expiring?withinDays=N` (notification list with daysUntilExpiry per record). **Daily automatic sweep** scheduled on service boot at next 00:05 SGT, repeating every 24h — any unused carry-forward past its expiry timestamp is forfeited automatically. 16 unit tests for engine logic (SGT 31-Dec default, expiry boundary inclusivity, fractional days, unlimited mode, custom expiry) + 9 integration tests for the API endpoints.

---

## Module 3: Claims & Expenses

### ✅ CLM-001 — Claims Submission Portal
**Status:** Done  
Submit itemised claims with category, date, amount, GST toggle (9% calculation), vendor name, business purpose, receipt upload (multi-file). Submission deadline enforcement. Duplicate detection flag.  
**Note:** Mobile OCR (receipt auto-extraction) not yet implemented but not blocking.

### ✅ CLM-002 — Approval Workflow & Delegation
**Status:** Done  
Multi-level routing (L1 Line Manager → L2 Finance/HOD above threshold → L3 Director for entertainment). Hard/soft limits. SLA reminders and escalation. Batch approval.  
**Note:** Approver delegation during leave partially implemented (delegation period configuration missing).

### ✅ CLM-003 — Payroll Integration
**Status:** Done  
Approved claims aggregated per employee per payroll period, added to net pay as non-CPF reimbursement. Cut-off date logic. Claims marked Paid with payroll run reference. Payslip itemisation.

### ✅ CLM-004 — GST & Finance Reporting
**Status:** Done _(completed 2026-05-25)_  
Vendor GST registry with IRAS-format validation, auto-validation on claim submit, finance dashboards (GST summary by period/category/cost-centre, top claimants, spend-vs-budget).

**Engine (`src/engines/gst.engine.js`):** Pure — no DB. `validateGstNumber` accepts 3 IRAS forms (9-char GSTN like `M12345678X`, post-2009 UEN `T07LL1234X`, pre-2009 UEN `200012345A`), normalises case + strips whitespace/hyphens. `checkRegistryMatch` does format validation then registry lookup honouring `effectiveFrom`/`effectiveTo` window + `isActive` flag, returns `{ valid, reason, vendor, normalized }`. Plus pure aggregators: `aggregateGstByPeriod`, `aggregateByCostCentre`, `aggregateByCategory` (with categoryLookup enrichment), `rankTopClaimants` (deterministic tie-break), `computeCategoryBudgetUtilisation` (BREACH/APPROACHING/OK + UNBUDGETED rows).

**Vendor GST registry:** New `VendorGstRegistration` model (unique `gstNumber`, effective-window dates, isActive flag). Endpoints (FINANCE_ADMIN):
- `GET /claims/vendor-gst?search=` — search by gstNumber OR vendorName (insensitive)
- `POST /claims/vendor-gst` — create (auto-normalises gstNumber, 400 on invalid format, 409 on duplicate)
- `PUT /claims/vendor-gst/:id` — update any field
- `DELETE /claims/vendor-gst/:id` — soft-delete via `isActive=false`
- `POST /claims/vendor-gst/validate` — real-time format + registry check for the claim UI
- `POST /claims/vendor-gst/revalidate` — sweeps SUBMITTED + APPROVED claims, refreshes `gstValidated` flag (lets Finance catch claims submitted before the vendor was registered). Returns `{ scanned, updated, nowValid, nowInvalid }`.

**Auto-validation on submit:** `POST /claims` now accepts `vendorGstNumber`, `vendorName`, `costCentre` and:
- Validates the GST number against active registry as of `claimDate`
- Stamps `gstValidated` (boolean) + `gstValidationNote` (`"Matched <vendor>"` or `"Validation failed: <reason>"`)
- If no GST number supplied but category `isGstClaimable` and `gstAmount > 0`, notes `"GST claimed but no vendor GST number supplied"` — flagged for Finance follow-up.

**Category budgets:** New `CategoryBudget` model (unique `(categoryId, period)`). `GET /claims/budgets?period=&categoryId=`, `PUT /claims/budgets` upsert (rejects negative). Drives the spend-vs-budget dashboard.

**Finance dashboards (FINANCE_VIEW_ROLES):**
- `GET /claims/dashboard/gst-summary?from=&to=&periodEq=` — APPROVED+PAID claims filtered to `category.isGstClaimable=true`. Returns `{ totals: { claimCount, gstClaimableClaims, totalSpend, totalGst, validatedGst, unvalidatedGst, unvalidatedClaimCount }, byPeriod, byCategory, byCostCentre }`.
- `GET /claims/dashboard/top-claimants?from=&to=&limit=10` — ranks employees by reimbursement amount with deterministic tie-break.
- `GET /claims/dashboard/category-budget?period=YYYY-MM` — spend-vs-budget per category with utilisation %, BREACH/APPROACHING/OK status + UNBUDGETED rows for unbudgeted spend; summary surfaces breach count, approaching count, total budget/spend/remaining.

**Schema additions:** `Claim` 5 fields (`costCentre`, `vendorName`, `vendorGstNumber`, `gstValidated`, `gstValidationNote`) + indexes on `costCentre` and `payrollPeriod`. New models `VendorGstRegistration`, `CategoryBudget`.

**Service hardening:** `src/index.js` listen() now guarded by `require.main === module` so supertest can import the app without binding the port. Jest config + auth/generic mocks added (`__mocks__/`).

**Tests (47 new, 47 total green — claims-service had no prior tests):** 25 unit tests on `gst.engine.js` (3 GST format variants + lowercase/whitespace/hyphen normalisation + null/empty/short rejection, registry match with effective-window guards + active flag + invalid-format-rejected-before-lookup + future-effective guard, aggregators with deterministic ordering + UNASSIGNED/UNALLOCATED buckets + lookup enrichment for both Map and plain-object forms, rankTopClaimants tie-break, budget utilisation with OK/APPROACHING/BREACH + UNBUDGETED row + empty-claims fallback) + 22 integration tests V1-V22 (registry CRUD with auto-normalisation, 400 on bad format, 409 on duplicate, soft-delete, validate endpoint match + not-in-registry, 403 for non-admin POST, revalidate sweep flips flag in both directions, auto-validation on POST /claims happy + invalid + GST-without-vendor-note, budget validation + filter, dashboard gst-summary with validated/unvalidated split + APPROVED+PAID gate, top-claimants ranking, category-budget BREACH + UNBUDGETED surfaced, 403 for non-finance dashboard). Full claims suite: **47 tests green** (47 new + 0 pre-existing — first test coverage on this service).

---

## Module 4: Recruitment & Onboarding

### ✅ REC-001 — Applicant Tracking System (ATS) with Lifecycle Tracking
**Status:** Done  
Job requisitions, pipeline stages (Applied → Screened → Interviewed → Offered → Hired/Rejected), candidate pool (independent of jobs), stage timeline audit trail, resume upload/download/replace, interview scheduling (rounds + feedback), FCF compliance flag per job, candidate tag-to-job.  
**Note:** Offer letter PDF template generation and e-sign workflow are partial.

### ✅ REC-002 — FCF & MyCareersFuture Compliance
**Status:** Done _(completed 2026-05-25)_  
Hard-gated FCF 14-day enforcement on hire approval, formal exemption workflow with mandatory justification, full nationality + shortlisting + hiring + rejection audit on every candidate, and dashboard compliance report.

**Engine (`src/engines/fcf.engine.js`):** Pure — no DB. `evaluateFcfStatus(job, now)` returns one of NOT_POSTED / IN_PERIOD / COMPLIANT / EXEMPT with `daysSincePosting`, `daysRemaining`, `blocksShortlisting`, `blocksHire`. `classifyCitizenship(value)` buckets free-text nationality into CITIZEN / PR / FOREIGNER / UNSPECIFIED with friendly aliases (SC, Singaporean, Singapore → CITIZEN). `buildNationalityBreakdown(candidates)` tallies counts + per-nationality dict. `buildReportRow(job, candidates, now)` emits per-job audit row with FCF status, days advertised, candidate counts (total / shortlisted / hired / rejected), nationality breakdown, hiring decisions with rationales, and rejection audit with reasons. `buildFcfReport(jobs, byJob, now)` aggregates the rows plus dashboard summary (totalJobs, byStatus, totalHired, totalCitizens/PRs/Foreigners, complianceViolations — jobs that had hires while gate was blocking).

**Hire-gate (hard 14-day block):** `POST /candidates/:id/approve` now runs `evaluateFcfStatus` on the candidate's job. If `blocksHire`, returns **409** with structured payload `{ error, fcfStatus, daysRemaining, mcfDaysRequired, hint }`. Override is gated to SUPER_ADMIN via `fcfOverride: true` body flag (HR_ADMIN cannot override — still blocked). Hint message switches based on status (NOT_POSTED → "post on MCF first", IN_PERIOD → "wait N more days").

**Exemption workflow:** `PUT /jobs/:id/fcf-exempt` accepts `{ fcfExempt, fcfExemptReason, fcfExemptNote }` — both `reason` (whitelist: HIGH_SALARY | INTRA_CORPORATE | SHORTAGE_OCCUPATION | OTHER) and `note` (non-empty justification) are mandatory when granting. Stamps `fcfExemptBy/At`. Clearing exemption (`fcfExempt: false`) wipes all four fields. 403 for non-admin.

**Status check endpoint:** `GET /jobs/:id/fcf-status` returns the full evaluation result for the recruiter UI to display before submitting a work-pass application.

**Candidate audit fields:** `Candidate` gains `nationality`, `citizenStatus` (CITIZEN/PR/FOREIGNER), `shortlistingNotes`, `hiringRationale`, `rejectionReason`. New `PATCH /candidates/:id/audit` updates any subset (rejects unknown citizenStatus values, rejects empty body).

**Compliance report:** `GET /recruitment/fcf-report?from=&to=&jobId=` returns `{ summary, rows }` with per-job audit rows including hiring rationales + rejection reasons + nationality breakdown. Restricted to admin + RECRUITER roles. EMPLOYEE → 403.

**fcfNotes capture:** existing `POST /jobs/:id/fcf-compliance` now also captures free-text recruiter notes on the FCF posting.

**Schema additions:** `JobPosting` 6 fields (`fcfExempt`, `fcfExemptReason`, `fcfExemptNote`, `fcfExemptBy`, `fcfExemptAt`, `fcfNotes`) + indexes on `fcfCompliant` and `fcfExempt`. `Candidate` 5 fields (`nationality`, `citizenStatus`, `shortlistingNotes`, `hiringRationale`, `rejectionReason`) + index on `citizenStatus`. New `CitizenshipKind` enum.

**Tests (41 new, 113 total green):** 17 unit tests on `fcf.engine.js` (constants, UTC-day-aligned daysBetween, evaluateFcfStatus all 4 states + boundary at 14 days + EXEMPT short-circuit, classifyCitizenship aliases + null guard, buildNationalityBreakdown counts + explicit citizenStatus override, buildReportRow with hire/reject/shortlist counts + rationales, buildFcfReport summary aggregation + violation count) + 24 integration tests F1-F24 (fcf-status NOT_POSTED/IN_PERIOD/COMPLIANT/EXEMPT/404, fcf-exempt grant + reason whitelist + empty-note + clear-fields + role guard, candidate audit happy + invalid citizenStatus + empty-body + 404, fcf-report rows + summary + jobId filter + role guard, hire-gate blocks NOT_POSTED + IN_PERIOD + passes COMPLIANT + passes EXEMPT + SUPER_ADMIN override + HR_ADMIN cannot override, fcfNotes captured on fcf-compliance). REC-005 happy-path fixture updated so its job is FCF-compliant (mcfPostedAt 20 days ago). Full recruitment suite: **113 tests green** (41 new + 72 pre-existing — no regressions).

### ✅ REC-003 — Work Pass Tracking & Expiry Alerts
**Status:** Done _(completed 2026-05-25)_  
Full work-pass lifecycle: expiry alerts, DRC quota monitoring, and renewal workflow with checklist + outcome tracking.

**Engine (`src/engines/workpass.engine.js`):** Pure — no DB. Computes `daysUntilExpiry` (UTC-day-aligned), `pendingAlerts` (which of the 90/60/30/0 thresholds have been crossed), `urgencyBand` (EXPIRED/CRITICAL/WARNING/NOTICE/OK), `isForeignPass`, `consumesDrcQuota` (WP + S-Pass only — EP excluded per MOM rule), `computeDrcUsage` (per-sector × tier ratio + BREACH/APPROACHING/OK classification), `defaultRenewalChecklist` (8 base items + pass-type extras: medical exam + tier for WP, qualifications check for S_PASS).

**Work pass CRUD:** `POST /recruitment/work-passes` (create with sector + workerTier), `PUT /recruitment/work-passes/:id` (any field), `GET /recruitment/work-passes` (filters: passType, status, sector) — every response enriched with `daysUntilExpiry` + `urgency`. 409 on duplicate employeeId.

**Expiry alerts:** `WorkPassAlert` model with unique `(workPassId, threshold)` for idempotency. `POST /recruitment/work-passes/alerts/sweep` runs the upsert loop manually; **daily scheduled sweep at 00:20 SGT** (next-tick + 24h interval, armed on service boot, skipped under NODE_ENV=test) fires 90/60/30-day reminders for ACTIVE/RENEWING passes and auto-flips ACTIVE → EXPIRED for passes past expiry date. `GET /recruitment/work-passes/alerts` lists with `summary.byThreshold/byPassType`.

**DRC quota monitoring:** `DrcQuotaConfig` table (unique on `sector × workerTier`) holds MOM ratio limits per sector (e.g. SERVICES 0.35, CONSTRUCTION 0.83). `GET/PUT /recruitment/work-passes/drc-config` for admin config. `GET /recruitment/work-passes/drc-usage?totalHeadcount=N` returns per-sector usage with `currentRatio`, `utilisationPct`, status (BREACH if over cap, APPROACHING if ≥ alertThreshold default 85% of cap, OK otherwise) plus `summary.breachCount/approachingCount`. Excludes EXPIRED + CANCELLED passes and EP holders from quota count.

**Renewal workflow:** `POST /recruitment/work-passes/:id/renewal/initiate` flips status to RENEWING (409 if already renewing / CANCELLED / EXPIRED) and seeds the per-pass-type checklist transactionally. `GET /recruitment/work-passes/:id/renewal/checklist` + `PUT /recruitment/work-passes/:id/renewal/checklist/:itemId` (auto-stamps `completedAt/By`). `PUT /recruitment/work-passes/:id/renewal/outcome` records outcome (APPROVED / REJECTED / WITHDRAWN, 409 if not RENEWING): APPROVED flips back to ACTIVE, updates `expiryDate` if `newExpiryDate` provided, and clears historical alerts so the next cycle fires fresh; REJECTED → EXPIRED; WITHDRAWN → ACTIVE. Records `renewalReference` (MOM ref) + notes.

**Expiring dashboard:** `GET /recruitment/work-passes/expiring?withinDays=N` (default 90) returns passes within window enriched with urgency + `summary` count per urgency band.

**Schema additions:** `WorkPass` 7 fields (sector, workerTier, 5 renewal-lifecycle fields); new models `WorkPassAlert`, `WorkPassRenewalChecklist`, `DrcQuotaConfig`.

**Route ordering note:** `PUT /work-passes/:id` is mounted AFTER all `/work-passes/<specific>` subroutes (alerts, drc-config, drc-usage, expiring) so the `:id` wildcard doesn't shadow them.

**Tests (52 new, 72 total green):** 24 unit tests on `workpass.engine.js` (daysUntilExpiry incl. UTC-day alignment + null guard, urgencyBand classification, pendingAlerts threshold accumulation incl. CANCELLED skip + TODAY message, isForeignPass / consumesDrcQuota incl. EP exclusion, computeDrcUsage OK/APPROACHING/BREACH + status filter + EP exclusion + zero-headcount, defaultRenewalChecklist per pass type) + 28 integration tests W1-W28 (CRUD + 409/404, sweep idempotency + auto-expire + group summary, DRC config validation + role guard, DRC usage with breach count, renewal initiate happy + 409/404 + transactional checklist seed, checklist item update with stamp, outcome APPROVED with alert clear + new expiry, REJECTED → EXPIRED, 409 + 400 validation, expiring dashboard with within-days filter + urgency summary). Full recruitment suite: **72 tests green** (52 new + 20 pre-existing — no regressions).

### ✅ REC-004 — Digital Onboarding Workflow
**Status:** Done _(completed 2026-05-26)_  
Full digital onboarding lifecycle: task checklist, IT provisioning auto-creation (Day −5), HR buddy/mentor assignment with notification, 3-day incomplete alert sweep, and mandatory policy acknowledgements with HR dashboard.

**Onboarding task checklist:** `POST /onboarding/:employeeId/start` creates 11 default tasks; `GET /onboarding/:employeeId` returns the list; `PUT /onboarding/:employeeId/tasks/:taskId` marks done. IT provisioning auto-creation on Day −5 is wired into `POST /candidates/:id/approve` (REC-005): 5 IT tasks (`Active Directory/SSO`, laptop, corporate email, system access, MFA/VPN) with `dueDate = startDate − 5 days`.

**HR Buddy/Mentor assignment:** `POST /onboarding/:employeeId/buddy` (HR Admin) upserts assignment, enriches with names from employee-service (fail-soft), creates an `OnboardingTask` for the buddy meeting (due 3 days after start), and fires a `BUDDY_ASSIGNED` notification email to the buddy. `GET /onboarding/:employeeId/buddy` retrieves the assignment. `DELETE /onboarding/:employeeId/buddy` removes it. Re-assigning overwrites the existing record.

**Incomplete onboarding 3-day-before-start alert sweep:** `POST /onboarding/alert-sweep` (HR Admin) fetches all employees whose `startDate` matches today + `daysAhead` (default 3), checks each for incomplete onboarding tasks, and fires an `ONBOARDING_INCOMPLETE_ALERT` notification to HR roles for each employee with outstanding tasks. **Daily scheduled sweep at 00:35 SGT** (armed on service boot, skipped under NODE_ENV=test).

**Mandatory Policy Acknowledgements (new for REC-004 close):**

*Engine (`src/engines/acknowledgement.engine.js`):** Pure — no DB. `REQUIRED_DOCS` defines the 4 mandatory documents (HANDBOOK, HARASSMENT_POLICY, PDPA_CONSENT, IT_ACCEPTABLE_USE) with code, title, description. `computeAckSummary(acks)` returns `{ total, done, pending, allComplete }` — `allComplete` is only true when all records are ACKNOWLEDGED and total > 0.

**Schema additions:** `PolicyDocument` model (unique `code`, title, description, documentUrl, documentHash, version, isRequired, isActive, createdBy/updatedBy); `PolicyAcknowledgement` model (unique `[employeeId, documentId]`, status PENDING/ACKNOWLEDGED, acknowledgedAt, ipAddress, documentHash snapshot); `AckStatus` enum.

**Policy document management routes:**
- `GET /onboarding/policy-documents` — lists active docs (default); `?includeInactive=true` shows all. (Placed before `GET /onboarding/:employeeId` in route order to prevent param shadowing.)
- `POST /onboarding/policy-documents/seed` — idempotent seed of 4 REQUIRED_DOCS (HR Admin). Skips existing by code.
- `POST /onboarding/policy-documents` — create a custom doc (HR Admin). 409 on duplicate code.
- `PUT /onboarding/policy-documents/:docId` — update any field (HR Admin). 404 on missing.

**Employee acknowledgement routes:**
- `GET /onboarding/:employeeId/acknowledgements` — returns all ack records with enriched document info + `summary { total, done, pending, allComplete }`.
- `POST /onboarding/:employeeId/acknowledgements/:docId` — employee acknowledges a document. Captures IP address. 409 if already acknowledged; 404 if record not assigned.
- `GET /onboarding/acknowledgements/pending` — HR dashboard (HR Admin/HR Manager): all PENDING acks grouped by `employeeId` with `pendingDocuments` list. Returns `{ totalEmployees, totalPending, employees }`.

**Integration with candidate approval (step 7 of `POST /candidates/:id/approve`):** After email notification, a fire-and-forget step fetches all `isActive=true, isRequired=true` policy documents and calls `policyAcknowledgement.createMany` (skipDuplicates) to queue PENDING rows for the new employee. `triggers.acknowledgementsQueued` reported in response.

**Tests (19 new, 154 total green):** 5 unit tests (`acknowledgement.engine.unit.test.js`: REQUIRED_DOCS shape, computeAckSummary all-pending/all-done/mixed/empty) + 14 integration tests AK-01–AK-14 (seed creates 4 / idempotent, GET active-only / includeInactive, POST create + 403, PUT update, GET acks with summary, POST acknowledge happy + 409 + 404, allComplete true, pending dashboard grouping, candidate approval queues acks). All 135 pre-existing tests still green — no regressions.

### ✅ REC-005 — Employee Record Auto-Creation
**Status:** Done _(completed 2026-05-24)_

Full hire approval pipeline: `POST /candidates/:id/approve` (HR Admin/Super Admin) is the single entry point that orchestrates employee record creation and all downstream provisioning.

**Employee creation:** Calls `POST /employee-service/employees` with candidate details + body overrides (`startDate` required; optional: `department`, `jobTitle`, `basicSalary`, `managerId`, `probationMonths`). Returns 502 with propagated error if employee service fails or is unreachable; 409 with `employeeId` if candidate already hired; 400 if `startDate` missing.

**Candidate update (transactional):** Atomically updates candidate `stage=HIRED`, `isHired=true`, `employeeId` + writes `CandidateStageEvent` with approval note.

**Leave entitlement provisioning:** `POST /leave-service/leave/internal/provision-entitlements` (fire-and-forget — failure doesn't block approval; `triggers.leaveProvisioned` in response).

**IT provisioning tasks (Day −5):** Creates 5 `OnboardingTask` records (Active Directory/SSO, laptop, corporate email, system access, MFA/VPN) with `dueDate = startDate − 5 days`, `assignedTo=IT`. `triggers.itTaskCreated` in response.

**Payroll setup task:** Creates 1 `OnboardingTask` for Payroll Officer: configure bank account + CPF contribution type + FWL tier before first payroll run. `dueDate = startDate`. `triggers.payrollSetupQueued` in response.

**Probation tracking:** Creates 1 `OnboardingTask` (`dueDate = startDate + probationMonths`, default 3): Line Manager must complete probation appraisal. `triggers.probationStarted` in response.

**Confirmation email:** `POST /notification-service/notifications/email` with `NEW_HIRE_WELCOME` type (fire-and-forget). `triggers.emailSent` in response.

**All downstream triggers are fire-and-forget:** failures are captured in the `triggers` object but never block the 201 response.

**Tests:** 13 integration tests R1-R13 (happy path: employee created + HIRED stage + 5 IT tasks + payroll task + probation task with correct end date + auth header forwarded; validation: 404/409/400/502 unreachable/502 non-OK; resilience: approval succeeds when leave service or notification service is down; transaction called with 2 ops). Full recruitment suite: **20 tests green**.

---

## Module 5: Time & Attendance

### ✅ TAT-001 — Multi-Method Time Capture
**Status:** Done  
Face recognition (server-side via face-service, confidence score, enrollment by HR Admin), geofenced mobile clock-in (configurable locations, 200m default radius), web clock-in, manual entry with justification (L2 approval required). Clock-in with method, device/location recorded per event.

### ✅ TAT-002 — Work Schedule & Shift Configuration
**Status:** Done  
Shift templates (name, start/end, break, colour), roster grid (weekly 7-column, per-employee), bulk assignment, copy-week, flexi/compressed/WFH flags, WFH cap enforcement, shift patterns, Singapore PH calendar pre-loaded, per-employee location assignment, multi-project shift configuration.

### ✅ TAT-003 — OT, Rest Day & Public Holiday Computation
**Status:** Done  
OT hours = max(0, worked − contracted), 72h monthly cap, 60h alert, HR override with audit trail, OT pay (1.5× hourly basic rate), rest day pay (EA s.37 employee/employer request rates), PH work pay (normal + 1 day or OIL credit). All amounts auto-passed to payroll.

### ✅ TAT-004 — Attendance Anomaly Detection
**Status:** Done _(completed 2026-05-25)_  
Full anomaly classification engine, daily sweep, ack workflow, manager digest email, and real-time today dashboard.

**Anomaly engine (`src/engines/anomaly.engine.js`):** Pure classifier — no DB. Detects six types per (employee × date):
- `LATE_ARRIVAL` — clockIn ≥ scheduledStart + `lateThresholdMin` (default 15 min)
- `EARLY_DEPARTURE` — clockOut ≤ scheduledEnd − `earlyDepartThresholdMin` (default 15 min)
- `MISSING_CLOCK_OUT` — clockIn present, no clockOut, past `missingClockOutGraceHours` (default 2h) beyond scheduled end (or clockIn + 12h fallback when no schedule)
- `AWOL` — scheduled day with no clockIn at all, status ∉ {ON_LEAVE, PUBLIC_HOLIDAY}, day fully elapsed
- `EXCESSIVE_OT` — single-day OT ≥ `dailyOtThresholdHours` (default 4h), uses billableOtHours when present
- `MONTHLY_OT_BREACH` — Σ OT for the month ≥ `monthlyOtAlertHours` (default 60h — alert before MOM's 72h hard cap)

**Configurable thresholds:** Singleton `AnomalyThreshold` table (id=1). `GET /attendance/thresholds` + `PUT /attendance/thresholds` (HR Admin only). Engine reads via sweep route; falls back to defaults if no row.

**Idempotent daily sweep:** `POST /attendance/anomalies/sweep` (HR Admin+) accepts `{from, to}` YYYY-MM-DD. Iterates every record + every rostered employee in the window. Per-record anomalies upsert on `@@unique([employeeId, date, type])`; AWOL synthesises a no-clockin record for rostered employees with no `AttendanceRecord`; MONTHLY_OT_BREACH aggregates per (employee × month) and pins one row per month-start. Daily scheduled sweep at 00:30 SGT (next run + 24h interval) sweeps the prior day automatically — armed on service boot via `scheduleDailyAnomalySweep()` (skipped under NODE_ENV=test).

**Manager workflow:**
- `GET /attendance/anomalies?status=&type=&severity=&employeeId=&from=&to=` — paginated list (cap 1000) with `summary.byStatus/byType/bySeverity`
- `PUT /attendance/anomalies/:id/acknowledge` — manager flips PENDING → ACKNOWLEDGED, stamps `acknowledgedBy/At`
- `PUT /attendance/anomalies/:id/explain` — employee (own only) or any view-role manager flips → EXPLAINED with required `explanation` text
- `PUT /attendance/anomalies/:id/dismiss` — view-role manager flips → DISMISSED with optional `reason`. All terminal transitions reject DISMISSED → others with 409.

**Manager digest email:** `POST /attendance/anomalies/manager-summary` (internal-key OR HR Admin/HR Manager JWT) — groups PENDING anomalies for a target date (defaults yesterday) by `employee.reportingManagerId`, resolves manager email via employee-service `/employees/by-ids`, fires one `ATTENDANCE_ANOMALY_DIGEST` email per manager via notification-service. Fail-soft: per-manager exceptions logged but don't fail the run.

**Real-time today dashboard:** `GET /attendance/today/dashboard` returns `{ date, generatedAt, summary, buckets }` with 8 buckets: `IN`, `OUT`, `WFH`, `LATE`, `ON_LEAVE`, `NOT_CLOCKED_IN`, `PUBLIC_HOLIDAY`, `ABSENT`. WFH detected by `RosterEntry.note` containing "wfh". `ON_LEAVE` joined via new `GET /leave/internal/on-leave-today` endpoint (internal-key auth) — failure is fail-soft, dashboard still renders.

**Schema additions:** `AttendanceAnomaly` (uuid PK, unique on `(employeeId, date, type)`, severity LOW/MEDIUM/HIGH, status PENDING/ACKNOWLEDGED/EXPLAINED/DISMISSED, ack/explain/dismiss audit fields, optional `recordId` back-link); `AnomalyThreshold` singleton (id=1, 5 configurable thresholds); enums `AnomalyType`, `AnomalySeverity`, `AnomalyStatus`. Indexed on status/type/employeeId/date.

**Wiring:** `docker-compose.yml` exports `EMPLOYEE_SERVICE_URL`, `LEAVE_SERVICE_URL`, `NOTIFICATION_SERVICE_URL` to attendance-service. New leave-service endpoint `GET /leave/internal/on-leave-today` returns active APPROVED leaves for today.

**Tests (52 new, 131 total green):** 27 unit tests on `anomaly.engine.js` (mergeThresholds defaults/0-override/non-finite guard, buildAnomalyKey shaping, AWOL with/without schedule + leave/PH suppression + day-not-over guard, LATE_ARRIVAL boundary + custom threshold, EARLY_DEPARTURE, MISSING_CLOCK_OUT grace window + no-schedule fallback, EXCESSIVE_OT billableOt precedence, MONTHLY_OT_BREACH sum + custom threshold + billable precedence, multi-anomaly composition) + 25 integration tests T1-T25 (thresholds GET/PUT/validation/403, sweep validation/AWOL synthesis/MONTHLY_OT/idempotency/403, list + filters + summary, acknowledge/explain/dismiss happy + 404/409/403/empty-explanation, manager digest fan-out + role guard + empty list, today dashboard buckets/leave routing/fail-soft). Full attendance suite: **131 tests green** (52 new + 79 pre-existing — no regressions). Leave-service suite: **43 tests green** after new internal endpoint added.

### ✅ TAT-005 — Payroll Integration from Attendance
**Status:** Done _(implemented 2026-05-24)_  
End-to-end attendance → payroll pipeline with HR approval gate and scheduled-time reconciliation.

**Period lock + approval gate (attendance-service)** — new `AttendancePeriod` table (state machine `OPEN → LOCKED → APPROVED_FOR_PAYROLL`, `PeriodStatus` enum, indexed on status). Routes: `GET /attendance/periods`, `GET /attendance/periods/:period`, `POST /attendance/periods/:period/lock` (HR_MANAGER+), `POST /attendance/periods/:period/unlock` (HR_ADMIN+), `POST /attendance/periods/:period/approve-for-payroll` (HR_ADMIN+) — invalid transitions return 409; every state change writes an `AuditLog` entry.

**Scheduled-time reconciliation (attendance-service)** — every clock-in/clock-out is reconciled against the employee's roster entry (`RosterEntry` → `WorkingShift` / `ShiftTemplate` / `ShiftPattern`). Clocking in earlier than scheduled or out later than scheduled produces an `earlyMinutes` / `lateMinutes` delta with per-side status: `AUTO_APPROVED` if within shift grace (`graceMinutesEarly`/`graceMinutesLate`, default 15 min, configurable per shift), else `PENDING` for manager review. Short hours (clocking in late or out early) always count as actual time — no approval flow, deduction lands automatically. Manager workflow: `GET /attendance/pending-approvals` (filterable by employeeIds + period), `POST /attendance/records/:id/approve-early|late`, `POST /attendance/records/:id/deny-early|late` (with optional `reason`). Reconciler preserves `APPROVED`/`DENIED` decisions across re-runs triggered by fresh clock events. New `billableHours` and `billableOtHours` columns on `AttendanceRecord` materialize the approved time window — payroll reads these, never raw `hoursWorked`.

**Payroll auto-feed (payroll-service)** — `POST /payroll/runs/:id/compute` now fetches `GET /attendance/internal/period-summary/:period` via `INTERNAL_SERVICE_KEY` before iterating employees. **Hard gate:** if period status ≠ `APPROVED_FOR_PAYROLL` (or attendance fetch fails), returns **409** unless caller passes `attendanceOverride: true` (override skips the auto-feed and lets Payroll Officer manage paycodes manually). When the gate passes, per-employee line items are materialized into the existing `PayrollLineItem` table using the pre-seeded codes: `OT_PAY` (otHours × hourlyRate × 1.5, wageType `OW`, CPF-applicable), `ABSENCE_DED` (−dailyRate × absentDays, wageType `DEDUCTION`, non-CPF), `PH_WORK` (+dailyRate × phWorkedDays, wageType `OW`, CPF-applicable). **Manual Wins:** any employee/code combination that already has a manual line item is skipped (`autoFeedItemsByEmployee` + `skipped` arrays surfaced in the response for transparency). All amounts AES-256 encrypted; flow into the existing CPF/SDL/net-pay computation downstream.

**Wiring:** `docker-compose.yml` now exports `ATTENDANCE_SERVICE_URL` and `INTERNAL_SERVICE_KEY` to payroll-service, and `INTERNAL_SERVICE_KEY` to attendance-service.

**Tests:** 32 unit tests across two engines (`attendance-summary.engine.js`: billable-hours precedence, OT cap, half-day/PH classification; `time-reconciliation.engine.js`: grace boundary, manager-decision preservation, short-hours skip, overnight clock-out, configurable grace + hoursPerDay), 15 integration tests for the new period + approval routes (lock state machine, 403/409 transitions, manager approval triggers reconciler re-run, internal-key auth), 11 regression tests for payroll compute (approval gate enforcement, override behaviour, OT/ABSENCE/PH materialization, Manual Wins, missing pay component graceful skip, attendance-unreachable handling). Pre-existing payroll integration suite (53 tests) retrofitted with a URL-aware fetch dispatcher and all still pass.

---

## Module 6: Performance Management

### ✅ PMS-001 — Review Cycles & Goal Setting
**Status:** Done  
Configurable appraisal cycles (annual, mid-year, quarterly, probation), SMART goal setting, manager review/approval, goal weightings, probation review auto-triggered at 30/14/7 days, role-based appraisal views.

### ✅ PMS-002 — Appraisal Workflow
**Status:** Done  
Self-assessment submission, manager assessment, skip-level optional, notification timeline (7-day, 3-day reminders), configurable rating scale, weighted average overall rating, employee acknowledgement, dispute escalation to HR.

### ✅ PMS-003 — Calibration & Bell Curve
**Status:** Done _(completed 2026-05-26)_  
Full bell curve enforcement with configurable band targets, deviation warnings, and department-grouped calibration view.

**Engine (`src/engines/bellcurve.engine.js`):** Pure — no DB. `validateBands(bands)` enforces non-empty array, minScore ≤ maxScore, targetPct 0–100, sum-to-100 within 1-point tolerance. `effectiveScore(appraisal)` prefers `calibratedScore` over `overallScore` (null-safe). `computeDistribution(appraisals, bands)` counts members per band, computes `actualPct`, `deviation` (actualPct − targetPct), and `status` — `OVER` / `UNDER` when `|deviation| > deviationTolerance`, `WARNING` when `|deviation| > 60% of tolerance`, `OK` otherwise. `hasDeviation(distribution)` returns true if any band is OVER or UNDER. `groupByDepartment(appraisals, employeeMap, bands)` groups appraisals with `_employeeName` enrichment and per-department `distribution`; employees with no record fall into `Unassigned`.

**Default 5-band config (MAS/HR best practice, 1–5 scale):**
- Outstanding (4.5–5.0): target 10%, tolerance ±5%
- Exceeds (3.5–4.49): target 25%, tolerance ±7%
- Meets (2.5–3.49): target 50%, tolerance ±10%
- Needs Improvement (1.5–2.49): target 10%, tolerance ±5%
- Unsatisfactory (0–1.49): target 5%, tolerance ±5%

**Schema addition:** `BellCurveConfig` model — `cycleId` (unique FK to ReviewCycle), `bands` (Json), `createdBy`, `updatedBy`; `ReviewCycle` gains `bellCurveConfig BellCurveConfig?` relation. Applied via `prisma db push` on service startup.

**New routes:**
- `GET /performance/cycles/:id/bell-curve-config` — returns stored config or `{ bands: DEFAULT_BANDS, isDefault: true }` when none configured.
- `PUT /performance/cycles/:id/bell-curve-config` — upsert config; validates bands via engine; stamps `createdBy` / `updatedBy` from JWT sub. HR Admin + Super Admin only.
- `GET /performance/cycles/:id/calibration` — **enhanced**: now includes `bellCurve: { config, distribution, hasDeviation, totalRated }` in every response. Pass `?groupBy=department` to also receive `byDepartment` object keyed by department name — each department entry has `count`, `appraisals`, and `distribution`. Employee-service fetch is fail-soft (falls back to `Unassigned` grouping if unreachable).

**Tests (54 new, 187 total green):** 39 unit tests on `bellcurve.engine.js` (effectiveScore calibrated-prefers/fallback/null/zero-calibrated, validateBands accept/empty/non-array/missing-minScore/inverted/bad-pct/sum-check/tolerance/negative-dev-tol, computeDistribution counts/pct/deviation/status/null-score skip/empty appraisals/calibrated-wins, hasDeviation OVER/UNDER/OK+WARNING/empty, DEFAULT_BANDS sum/length/validates, groupByDepartment groups/counts/Unassigned/distribution/name-enrichment/missing-employee/null-bands) + 15 integration tests BC-01–BC-15 (GET config stored + default + 404, PUT create + update + 400-empty + 400-bad-sum + 404, calibration bell-curve analysis + stored-config + byDepartment null + groupBy happy + fail-soft on service down + hasDeviation true when OVER + totalRated excludes nulls). No regressions on pre-existing 133 tests.

### ✅ PMS-004 — Salary Increment Linkage
**Status:** Done  
Compensation matrix with increment proposals (`POST /cycles/:id/increment-proposals`), manager review and adjustment (`PUT /cycles/:id/increment-proposals/:pid`), budget envelope enforcement, `POST /cycles/:id/apply-increments` feeds salary revisions into PAY-009 workflow.

### ✅ PMS-005 — Probation Management
**Status:** Done  
Probation tracking per employee, 30/14/7-day reminders to Line Manager and HR, outcomes (Confirm / Extend / Terminate), permanent status change on confirmation, PIP creation and progress tracking.

### ✅ PMS-006 — 360-Degree Feedback
**Status:** Done _(completed 2026-05-24)_

Full 360-degree peer/subordinate/supervisor feedback lifecycle integrated into appraisal cycles.

**Schema additions:** `FeedbackQuestion` (RATING/TEXT, weight, displayOrder), `FeedbackRequest` (nomination → approval → submission state machine, @@unique per cycle × subject × reviewer), `FeedbackResponse` (@@unique per request × question). `ReviewCycle` gains `feedbackWeight Float`. `Appraisal` gains `score360 Float`. New enums: `FeedbackReviewerType`, `FeedbackRequestStatus`, `FeedbackQuestionType`.

**Question management (HR Admin):** `POST /performance/cycles/:id/360/questions` (RATING or TEXT, weight, category, displayOrder), `GET /performance/cycles/:id/360/questions`, `DELETE /performance/cycles/:id/360/questions/:qid`. `PUT /performance/cycles/:id/feedback-weight` sets the 360 blend weight (0.0–1.0).

**Nomination workflow:** `POST /performance/cycles/:id/360/nominations` — employee nominates one or more reviewers with type (PEER/SUBORDINATE/SUPERVISOR); self-nomination and duplicates are silently skipped in `skippedDetails`. `GET /performance/cycles/:id/360/nominations` (HR sees all, employee sees own). `PUT .../nominations/:nomId/approve` (HR Admin) + `PUT .../nominations/:nomId/decline` (with optional reason).

**Anonymous feedback submission:** `GET /performance/cycles/:id/360/my-reviews` — reviewer sees all APPROVED/SUBMITTED requests plus cycle questions. `POST /performance/360/submit/:requestId` — reviewer submits `[{questionId, ratingValue?, textValue?}]`; validates ratingValue 1–5; unknown question IDs silently ignored; previous responses cannot be re-submitted (409). Response contains no subject identification.

**Aggregate report (anonymised):** `GET /performance/cycles/:id/360/report/:employeeId` — HR Admin/HR Manager/Manager can view; employees see own only. Report includes respondentCount, respondentsByType, per-question avgRating/minRating/maxRating, and text comments — comments are suppressed (`revealComments=false`, empty array) when `respondentCount < 3` to prevent identity inference.

**Apply 360 scores:** `POST /performance/cycles/:id/360/apply` — computes weighted average 360 score per employee from all SUBMITTED requests, stores on `appraisal.score360`, and blends with `calibratedScore ?? overallScore` using `feedbackWeight`: `blended = (1-w)×appraisal + w×score360`. Returns per-employee results with `blendedOverallScore`.

**Tests:** 11 unit tests on `feedback360.engine.js` (compute360Score incl. weighted avg, null cases, TEXT exclusion; blendScores incl. clamping; buildReport incl. anonymity threshold, respondentsByType, text-reveal toggle) + 34 integration tests F1-F34 (question CRUD + type validation, feedback-weight range guard, nominations happy path + self-skip + duplicate + type-guard, nomination approve/decline + 409 guards, my-reviews with questions, submit happy path + 403/409/400/unknown-qId, aggregate report HR/employee/403/comment-suppression, apply-scores blend + skip + 404). Full performance suite: **133 tests green**.

---

## Module 7: Training & Development

### ✅ TRN-001 — Learning Management System (LMS)
**Status:** Done  
Course/program creation (classroom, e-learning, OJT, blended), training materials upload, enrollment workflow (nomination → manager/Training Manager approval → completion), attendance, assessment scores, completion status, certifications, training history per employee.

### ✅ TRN-002 — SDL Computation & Reporting
**Status:** Done  
SDL computed in every payroll run per eligible employee. SDL submission file in CPF Board format. Monthly SDL totals available in payroll run data.

### ✅ TRN-003 — Government Grant Claims & SkillsFuture
**Status:** Done _(completed 2026-05-24)_  
Full SSG / SkillsFuture compliance lifecycle for ETS course-fee grants, Absentee Payroll, SFEC, and personal SFC declarations.

**Grant configuration:** `TrainingProgram` now carries `isSsgFunded`, `ssgCourseCode` (TGS code), `etsEligible`, `sfecEligible`, `apHourlyRate` (default SGD 7.50/hr), `courseFee`, `grantPercentage` (0..1). Set via `PUT /training/programs/:id/grant-config`.

**Absentee Payroll (AP):** `PUT /training/enrollments/:id/training-hours` records actual hours + attendance date and auto-computes `apComputedAmount = hours × rate` (non-SSG programs → 0). `POST /training/grants/ap/compute?period=YYYY-MM` idempotently materialises one `GrantClaim` (type=AP) per completed SSG-funded enrollment whose attendance lies in the period. `GET /training/grants/ap/export?period=YYYY-MM` emits the SSG pipe-delimited flat file (`NRIC|EmployeeName|CourseCode|HoursAttended|HourlyRate|ClaimAmount|PeriodStartDate|PeriodEndDate`), accepting an `x-employee-lookup` JSON header for NRIC/name enrichment.

**ETS grant report:** `GET /training/grants/ets/report?from=...&to=...` aggregates all completed SSG-funded + ETS-eligible enrollments in the window, computes `grantAmount = courseFee × grantPercentage` per enrollment, returns total claimable and per-row breakdown for SSG portal submission.

**SkillsFuture Credit (SFC) — personal credit per employee:** `EmployeeSfcBalance` table tracks `balanceAmount`, `lifetimeReceived`, `lifetimeUsed`, `lastDeclaredAt`. Endpoints: `GET /training/sfc/balance/:employeeId` (employee-self or admin only), `PUT /training/sfc/balance/:employeeId` (admin sets from MOE statement), `POST /training/sfc/declarations` (employee declares use against a specific enrollment — transactional: decrements balance, writes SFC `GrantClaim`, bumps `sfcDeclaredAmount` on the enrollment; rejected if amount > balance).

**SkillsFuture Enterprise Credit (SFEC) — company singleton ledger:** `SfecLedger` row with `totalCredit` (default SGD 10,000), `usedAmount`. `GET /training/sfec/balance` shows ledger with computed `remainingAmount`. `PUT /training/sfec/balance` initialises it (Super Admin / HR Admin). `POST /training/sfec/claims` validates program is SFEC-eligible, applies `min(oopAmount × 90%, remaining)` coverage, transactionally decrements ledger + writes SFEC `GrantClaim`.

**Grant claims ledger:** Every grant lands in `GrantClaim` (type ∈ {ETS, AP, SFEC, SFC}, status ∈ {PENDING, SUBMITTED, APPROVED, PAID, REJECTED}). `GET /training/grant-claims` lists with `totalsByType` aggregation; `PUT /training/grant-claims/:id` transitions status (stamps `submittedAt`/`paidAt` automatically) and records `submissionRef`. `GET /training/grants/summary` returns dashboard KPIs (claimable + paid totals by type, SFEC remaining).

**Schema additions:** `TrainingProgram` 7 grant fields; `TrainingEnrollment` 5 fields (`trainingHours`, `attendanceDate`, `apComputedAmount`, `apClaimed`, `sfcDeclaredAmount`); new models `EmployeeSfcBalance`, `SfecLedger`, `GrantClaim`; new enums `GrantClaimType`, `GrantClaimStatus`.

**Tests:** 18 unit tests on `grant.engine.js` (AP/ETS/SFEC formulas, SFC validation, SSG flat-file format incl. pipe-sanitisation + default-rate fallback) + 20 integration tests (G1-G20: grant-config, training-hours, AP compute idempotency, SSG export, ETS report, SFC balance/declarations cross-employee guard, SFEC ledger init + 90% coverage + ineligible-program rejection, claim status transitions with auto-stamping, summary). Full training suite: **118 tests green**.

### ✅ TRN-004 — Certification Expiry & Competency
**Status:** Done  
Certification records with expiry date, `GET /certifications/expiring-soon`. Daily reminder sweep at 00:10 SGT fires 90/60/30-day reminders idempotently (unique (certId, threshold)). Competency framework: competencies, program→competency mapping (taughtLevel), job-family required levels, employee assessed levels, and `GET /employees/:id/competencies/gap?jobFamily=X` returning gap and recommended PUBLISHED programs. Auto-nomination: when the 60-day reminder first fires for a cert with `renewalProgramId`, the employee is enrolled in that program (`enrolledBy: system:cert-reminder`), with the existing-enrollment check preventing duplicates.

---

## Module 8: Asset & Logistics Management

### ✅ AST-001 — Asset Register & Assignment
**Status:** Done  
Full asset register (ID, category, serial, purchase date/cost, warranty, condition, assignee), digital handover acknowledgement, asset transfer (return + re-handover), full assignment history per asset.

### ✅ AST-002 — Logistics Requests & Inventory
**Status:** Done _(completed 2026-05-24)_  
Full logistics + inventory lifecycle backed by typed Prisma models and pure decision engine.

**Inventory master:** `InventoryItem` table (SKU unique, category, unit, currentStock, reorderPoint, reorderQty, unitCost, location). Endpoints: `GET /inventory`, `GET /inventory/:id` (returns `lowStock` flag), `POST/PUT/DELETE /inventory/:id` (soft-delete via `isActive=false`), `GET /inventory/low-stock` (engine-filtered with `suggestedReorderQty`).

**Employee request workflow:** `LogisticsRequest` + `LogisticsRequestLine` models. `POST /logistics/requests` (employee submits multi-line request with stationery/PPE/uniforms), `GET /logistics/requests?mine=true|status=...|requesterEmployeeId=...`, `GET /logistics/requests/:id`. State machine via dedicated routes: `PUT /logistics/requests/:id/approve` (manager/admin, PENDING → APPROVED, stamps `approvedBy`), `PUT /logistics/requests/:id/reject` (records reason), `PUT /logistics/requests/:id/fulfill` (Logistics Officer issues stock — transactional: decrements inventory, writes ISSUE `StockTransaction` per line, sets `quantityFulfilled`, triggers auto-PR if low-stock crossed), `DELETE /logistics/requests/:id` (owner/admin cancel only while PENDING). All transitions reject from non-applicable status with 409.

**Stock transactions ledger:** `StockTransaction` (txType ∈ {RECEIVE, ISSUE, ADJUST}, signed quantity, reference, employeeId, createdBy, createdAt). `POST /inventory/:id/transactions` validates via `applyStockTransaction()` engine (rejects negative-result ISSUE, validates positive quantities for RECEIVE/ISSUE, signed for ADJUST), atomically updates stock + writes ledger row, auto-creates PR if stock crossed low-stock boundary. `GET /inventory/:id/transactions` returns history.

**Auto purchase requests:** `PurchaseRequest` model with PR number (`PR-XXXX`), status pipeline (DRAFT→SUBMITTED→APPROVED→ORDERED→RECEIVED|CANCELLED). `POST /purchase-requests/auto-generate` sweeps all low-stock items and creates one PR each (`triggeredBy: system:low-stock`), idempotent via `shouldAutoCreatePr()` engine that checks for existing open PRs. `POST /purchase-requests` (manual), `PUT /purchase-requests/:id` (status update; setting `RECEIVED` auto-applies a RECEIVE `StockTransaction` and bumps inventory).

### ✅ AST-003 — Asset Expiry & Maintenance Alerts
**Status:** Done _(completed 2026-05-24)_  
Idempotent alert ledger for warranty, maintenance, return, and software licence expiry with daily sweep.

**Asset config additions:** `Asset.warrantyExpiry`, `Asset.nextMaintenanceAt`, `Asset.maintenanceIntervalDays`, `Asset.contractEndDate`. `AssetAssignment.offboardingDate` drives the 14-day return alert. Configurable via `POST /assets` and `PUT /assets/:id`.

**Maintenance records:** `AssetMaintenance` model (type ∈ {PREVENTIVE, REPAIR, INSPECTION}, scheduledAt, completedAt, performedBy, costAmount, notes). `POST /assets/:id/maintenance` records completion; if asset has `maintenanceIntervalDays`, automatically advances `nextMaintenanceAt = completedAt + intervalDays` and clears prior MAINTENANCE alerts for the asset so the next cycle fires fresh. `GET /assets/:id/maintenance` lists history.

**Software licences:** `SoftwareLicence` model (name, vendor, licenceKey, seatsTotal, seatsUsed, expiryDate, renewalCost). CRUD endpoints validate `seatsUsed ≤ seatsTotal`. `GET /licences` enriches each row with `seatsRemaining`, `daysUntilExpiry`, `urgency`. `GET /licences/expiring-soon?withinDays=N` (default 60) returns the dashboard list.

**Alert thresholds:** WARRANTY [60, 30, 7] · MAINTENANCE [30, 14, 7] · RETURN [14, 7, 1] · LICENCE [60, 30, 7] (configurable in `alert.engine.js`).

**Alert sweep + dashboard:** `AssetAlert` table with unique `(entityId, alertType, threshold)` for idempotency. `POST /assets/alerts/sweep` (manual) and the daily scheduled sweep at 00:15 SGT scan all 4 sources, compute days-remaining, and create rows for any not-yet-fired threshold crossed. `GET /assets/alerts?alertType=&sinceDays=` returns the dashboard with `{ total, summary: { WARRANTY, MAINTENANCE, RETURN, LICENCE }, alerts }`.

**Schema additions:** `Asset` 4 fields; `AssetAssignment` 1 field; new models `InventoryItem`, `LogisticsRequest`, `LogisticsRequestLine`, `StockTransaction`, `PurchaseRequest`, `AssetMaintenance`, `SoftwareLicence`, `AssetAlert`; new enums `LogisticsRequestStatus`, `StockTxType`, `PurchaseRequestStatus`, `MaintenanceType`, `AssetAlertType`.

**Tests (73 green):** 13 unit tests on `inventory.engine.js` (low-stock detection, reorder-qty fallback, signed stock transactions incl. negative-result rejection, auto-PR decision), 30 unit tests on `alert.engine.js` (threshold bands incl. correctness of "most-urgent crossed" semantics, urgency classification, idempotent `pendingThresholds()`, message formatting variants), 17 integration tests (L1-L17: inventory CRUD, low-stock filter, stock transactions, auto-PR on cross, full logistics-request state machine incl. 409 on wrong-state transitions, fulfillment with stock issuance, auto-generate sweep, PR RECEIVED auto-receive), 10 integration tests (A1-A10: maintenance recording + nextMaintenanceAt advancement, licence CRUD with seat validation, expiring-soon urgency, 4-type sweep counts per threshold (with idempotency on re-run), dashboard summary, asset CRUD regression, assignment with offboardingDate).

### ✅ AST-004 — Offboarding Asset Return
**Status:** Done  
On offboarding initiation, asset return checklist auto-generated from all current assignments. Logistics Officer marks each asset Returned/Not Returned/Written Off. Offboarding clearance blocked until all assets resolved. Asset return acknowledgement form generated.

---

## Module 9: Offboarding

### ✅ OFF-001 — Offboarding Initiation & Workflow
**Status:** Done  
Four triggers (resignation, termination, retirement, contract end), last working day computation from notice period, auto-created task checklist assigned to IT/Finance/HR/Logistics/Legal, employee access deactivation on last day, final payroll trigger.

### ✅ OFF-002 — Offboarding Checklist
**Status:** Done  
Full checklist items across IT, Finance, HR, Logistics, Legal. Per-item due date, completion tracking, N/A with justification, HR Manager final clearance approval. Real-time progress dashboard.

### ✅ OFF-003 — Final Pay Computation
**Status:** Done  
All EA components: salary for days worked (÷ working days in month), notice pay (÷26 × notice days), leave encashment (÷26 × unused AL days), excess leave deduction, outstanding approved claims, salary advance recovery. CPF on final OW/AW. Maker-checker approval, final payslip, GIRO file.

### ✅ OFF-004 — IR21 Tax Clearance (Foreign Employees)
**Status:** Done _(completed 2026-05-24)_  
Full IR21 compliance lifecycle for non-SC/non-PR employees.

**Auto-population from payroll YTD (off-004 additions):**
- New internal payroll endpoint `GET /payroll/internal/ir21-ytd/:employeeId/:year` (x-internal-service-key auth) aggregates employment income (max-YTD payslip), AW bonuses (line-item sum), BIK Appendix 8A, ESOP Appendix 8B, employee/employer CPF into a single `totalTaxableIncome` per employee.
- `POST /offboarding/:id/ir21-populate` calls this endpoint and stores snapshot in `ir21FormData` on the case.
- `GET /offboarding/:id/ir21-form` returns stored snapshot with deadline countdown and urgency classification.

**Money-withhold gate:**
- On `POST /offboarding/initiate`: if `isForeignEmployee=true`, automatically sets `moniesWithheld=true`, `ir21Status=PENDING`, and computes `ir21DeadlineDate = lastWorkingDate − 30 days` (IRAS rule).
- `POST /offboarding/:id/create-final-pay-run` is blocked with 409 (`"Final pay withheld pending IRAS IR21 clearance"`) while `ir21Status ∈ {PENDING, SUBMITTED}`. Response surfaces `ir21Status`, `ir21DeadlineDate`, `daysUntilDeadline`, and resolution instructions.
- `PUT /offboarding/:id/ir21-clearance` now sets `moniesWithheld=false` + `moniesToRelease=true` + validates SUBMITTED → CLEARANCE_ISSUED transition (rejects if not yet filed). Accepts optional `irasReference` stored in formData.

**Deadline dashboard:**
- `GET /offboarding/ir21/dashboard` — all IR21-required cases ordered by deadline, with `daysUntilDeadline`, urgency (`OVERDUE/CRITICAL/WARNING/OK`), `formPopulated`, `moniesWithheld`, and summary counts. Optional `?status=` filter.

**Daily reminder sweep:**
- Scheduled on service startup (next 00:05 SGT, repeating every 24h). Logs 30/14/7-day warnings and OVERDUE alerts for all PENDING/SUBMITTED foreign employees.

**Schema additions:** `ir21DeadlineDate DateTime?`, `ir21FormData Json?`, `moniesWithheld Boolean @default(false)` on `OffboardingCase`.

**Tests:** 24 unit tests (`ir21-engine.unit.test.js`: deadline boundary math incl. leap-year + year-boundary, urgency bands, withhold-status matrix, dashboard entry builder) + 15 integration tests (`ir21-api.integration.test.js`: I1-I15 covering initiate withhold, dashboard, populate, form, clearance transition, withhold gate, and local-employee bypass). Payroll service: 6 new integration tests (`ir21-ytd-internal.integration.test.js`: auth guard, full aggregation, zero-payslip case, max-YTD dedup, invalid year). Full payroll suite: **242 tests green**; full offboarding suite: **39 tests green**.

### ✅ OFF-005 — Exit Interview & Analytics
**Status:** Done  
Digital exit interview form (satisfaction rating, reason for leaving, open comments). `PUT /offboarding/:id/exit-interview` saves responses. `GET /offboarding/analytics/exit` returns attrition rate by department, tenure, reason, voluntary vs involuntary split.

---

## Module 10: Reporting & Analytics

### ✅ RPT-001 — Executive Workforce Dashboard
**Status:** Done _(completed 2026-05-25)_  
Full executive workforce dashboard with live KPI cards, 12-month hire/termination trend, headcount breakdowns, OT-by-department widget, training completion rate widget, and 5-minute auto-refresh.

**Backend endpoints (reporting-service):**
- `GET /reports/workforce-dashboard` — headcount KPIs (total, active, hires MTD, terms MTD, 12m attrition rate), 12-month rolling hire/termination trend, active headcount by department/employment-type/citizenship.
- `GET /reports/ot-by-department?months=N` — aggregates OT hours from attendance-service internal period summaries across N months (default 6), joins with employee-service for department mapping, returns top-8 departments by total OT with per-month arrays and totals.
- `GET /reports/training-summary` — proxies `/training/stats` from training-service; returns completionRate, completed, inProgress, totalEnrollments, mandatory count, and byCategory breakdown.

**Frontend (`WorkforceDashboardModal`):**
- 4 KPI cards: Total Headcount, Hires MTD, Terminations MTD, 12m Attrition Rate.
- 12-month SVG bar chart — hires (emerald) vs terminations (red) per month.
- Headcount by Department / Employment Type / Citizenship horizontal-bar panels (3-column grid).
- **OT by Department** — horizontal bars showing 6-month total per dept with current-month highlighted in amber.
- **Training Completion** — completion rate gauge, completed/in-progress/total counts, mandatory programme alert, programmes-by-category breakdown.
- **5-minute auto-refresh** with manual ↺ Refresh button and "Updated X ago" timestamp indicator.
- Print/PDF via `window.print()` with print-safe CSS.

### ✅ RPT-002 — Statutory Reports (Pre-Built)
**Status:** Done _(completed 2026-05-24)_

All pre-built statutory reports implemented, plus a persistent submission history ledger.

**FWL Report** — `GET /reports/fwl/:period`: fetches FINALISED payroll runs, aggregates payslip FWL amounts per employee (fwl > 0 only), enriches with employee name/NRIC/passType from employee service, returns total + `byPassType` breakdown (WP, S-Pass, etc.). Empty when no finalised runs.

**SDL Summary** — `GET /reports/sdl-summary/:period`: aggregates SDL per employee across all FINALISED runs for the period (highest-SDL payslip wins), returns `totalSdl`, per-employee `grossPay + sdlAmount`, and `ssgSubmissionNote` referencing the CPF e-Submit portal.

**MOM Monthly Headcount** — `GET /reports/mom-headcount?year=YYYY&month=M`: returns `summary` (totalActive, residents, foreigners, male, female, newHires, terminations, netChange), `byNationality`, `byEmploymentType`, `byPassType` (SC/PR/EP/S_PASS/WP/DP/OTHER). New hires = `joinDate` within the month; terminations = `lastWorkingDate` or `resignationDate` within the month.

**MOM Annual Manpower Survey** — `GET /reports/mom-manpower-survey?year=YYYY`: aggregate for MOM's annual survey — totalEmployees, newHires, terminations, `byOccupation` (jobTitle breakdown), `byAgeGroup` (Below 25 / 25-34 / 35-44 / 45-54 / 55-64 / 65+), plus `surveyNote` referencing MOM's stats.mom.gov.sg portal.

**Statutory Submission History** — new `StatutorySubmission` Prisma model (type ∈ {CPF_E_SUBMIT, SDL_SSG, FWL_MOM, IR8A_IRAS, MOM_HEADCOUNT, ANNUAL_MANPOWER_SURVEY}, status ∈ {DRAFT, SUBMITTED, ACKNOWLEDGED}, `referenceNumber`, `fileName`, `notes`, `submittedAt`, `acknowledgedAt`). Endpoints: `POST /reports/submissions` (create record, stamps `submittedAt` when status=SUBMITTED), `GET /reports/submissions` (filterable by type/period/status, total count), `GET /reports/submissions/:id`, `PUT /reports/submissions/:id` (transitions status, auto-stamps timestamps).

**Tests:** 20 integration tests S1-S20 (FWL: empty-run, fwl=0 exclusion, byPassType; SDL: total + fullName enrichment + empty; MOM headcount: new-hires in month, gender, residents/foreigners; Manpower survey: new-hires for year; Submission CRUD: type-missing + invalid + period-missing + create + list + update-with-timestamp). Full reporting suite: **102 tests green**.

### ✅ RPT-003 — Custom Report Builder & Scheduled Delivery
**Status:** Done _(Phase 2 implemented 2026-05-24)_

**Phase 1 (backend foundation):**
New Prisma schema: `ReportTemplate`, `ReportSchedule`, `ReportRun`. Query executor engine: 5 data sources (employees / payrollRuns / leaveApplications / attendance / claims), filter ops (eq/ne/gt/lt/gte/lte/in/contains), groupBy with count/sum/avg/min/max aggregations, multi-key sort, projection, limit cap (5k default, 50k max). Routes: template CRUD, run, preview, CSV/XLSX/PDF export, run history, schedule CRUD, seed-templates admin endpoint. Hourly scheduler tick with DAILY/WEEKLY/MONTHLY next-run calculation and ReportRun history. RBAC: owner-or-shared for non-admins.

**Phase 2 additions:**
- **Visual 3-step field-picker wizard** replaces JSON textarea: Step 1 = name + category + data source (5 options with field count), Step 2 = mode toggle (Field List with checkbox grid vs Grouped Summary with groupBy dropdown + aggregation builder), Step 3 = filter rows (field + op + value, in-op csv parsing) + sort rows + definition preview JSON panel.
- **PDF export** (`GET /reports/templates/:id/export.pdf`) — landscape A4 via pdfkit, dark header row, alternating row shading, multi-page support, row-count footer.
- **Real email delivery** — scheduler tick builds CSV/XLSX/PDF attachment when `REPORTING_INTERNAL_JWT` is set, delivers via nodemailer (SMTP_HOST/SMTP_PORT/SMTP_SECURE/SMTP_USER/SMTP_PASS/SMTP_FROM). Falls back gracefully with skipped=true when SMTP unconfigured.
- **4 pre-built seed templates** (seeded idempotently on startup + `POST /reports/seed-templates`): Active Headcount by Department, Attrition Analysis, Leave Usage by Type, Claims Spend by Category.
- **`FIELD_CATALOG`** per data source (key/label/type) exposed via `GET /reports/data-sources` → `fieldCatalog` — drives the wizard field picker.
- **Schedule management modal** on frontend: list/create/delete schedules per template with frequency + format (CSV/XLSX/PDF) + recipients.
- **PDF button** added to Saved Reports actions (alongside CSV/XLSX/Run/Sched/Del).
- **83 tests green**: 47 unit (query executor, CSV writer, schedule calculator) + 6 PDF unit + 3 email unit + 27 supertest integration (19 Phase 1 + 8 Phase 2: PDF export, field catalog, seed-templates, PDF schedule format).

---

## Module 11: Support & Ticketing

### ✅ SUP-001 — Ticket Submission (Employee)
**Status:** Done  
Submit with category, subject, body. Duplicate detection warning. Ticket lifecycle (OPEN → IN_PROGRESS → RESOLVED → CLOSED). Auto-generated ticket ID. In-app and email confirmation.

### ✅ SUP-002 — HR Admin Inbox & Triage
**Status:** Done  
Full inbox with filters (status, category, priority), summary stats (total, open, in-progress, urgent). Status and priority updates with audit trail. Thread-based messaging with author/role/timestamp.

### ✅ SUP-003 — Ticket Replies & Resolution
**Status:** Done  
Employee replies to non-CLOSED tickets. HR Admin replies to any ticket. CLOSED tickets are read-only. All messages in chronological thread.

### ✅ SUP-004 — Self-Service FAQ
**Status:** Done _(completed 2026-05-24)_  
Curated FAQ panel browsable before ticket submission, with admin CRUD + helpfulness analytics + idempotent seed of 6 common questions.

**Schema:** `FaqEntry` model (question, answer in markdown, category reusing `TicketCategory` enum, `isPublished`, `displayOrder`, `viewCount`, `helpfulCount`, `notHelpfulCount`, `createdBy`, `updatedBy`, timestamps) indexed on `[category, isPublished]` + `displayOrder`.

**Employee endpoints (all authenticated):**
- `GET /support/faqs?category=&search=` — published FAQs only, ordered by `displayOrder`; case-insensitive OR-match on question/answer for keyword search; validates category against the enum (400 on bogus)
- `GET /support/faqs/:id` — returns single entry, fire-and-forget viewCount increment; 404 hides unpublished entries from employees but lets admins see them
- `POST /support/faqs/:id/feedback` — `{ wasHelpful: true|false }` increments the corresponding aggregate counter; rejects non-boolean

**Admin endpoints (HR Admin / Super Admin):**
- `GET /support/faqs/admin/all` — full list including unpublished
- `POST /support/faqs` — create with category validation
- `PUT /support/faqs/:id` — edit any field; stamps `updatedBy`
- `DELETE /support/faqs/:id` — soft-delete via `isPublished=false`
- `POST /support/faqs/seed` — idempotent insert of 6 pre-loaded common questions: leave application, payslip access/download, expense claims with GST + receipts, personal details / bank account updates, approval queue follow-up, IT access (lockout / password / MFA). Already-existing questions (matched on question + category) are skipped.

**Tests:** 20 integration tests (F1-F20: list filters, search OR, category validation, viewCount increment, employee vs admin visibility of unpublished, helpful/not-helpful feedback, missing-fields rejection, edit + stamp, soft-delete, seed idempotency, 403 regression for non-admin POST). Full support suite: **38 tests green** (18 pre-existing + 20 new).

---

---

## Module 12: Compliance & Statutory

### ✅ FWA-001 — Flexi-Work Arrangements (MOM Dec 2024 Mandate)
**Status:** Done _(completed 2026-05-26)_  
**Statutory basis:** MOM Tripartite Guidelines on Flexible Work Arrangements (effective 1 Dec 2024). Employers with ≥10 employees must have a formal process. Employees have the right to request; employers must respond in writing within **2 months**. Retaliation is prohibited.

**Scope:**
- Three FWA types: **Flexi-Time** (flexible start/end), **Flexi-Load** (reduced hours/part-time), **Flexi-Place** (WFH/remote work)
- Employee request form with type-specific fields, reason, proposed start/end dates
- Manager/HR approval workflow with mandatory written decision
- 2-month response deadline enforced with escalating reminders (14d, 7d, OVERDUE)
- Daily sweep marks requests `EXPIRED` if no response past deadline
- HR dashboard: pending, overdue, approved/rejected summary
- Employee ESS: view own requests + status
- Notification fan-out: employee notified on decision; HR alerted on overdue

**Service:** attendance-service (new schema + routes + engine)  
**Frontend:** new FWA tab in My Attendance (employee) + HR FWA dashboard  

---

### ✅ FWA-002 — Overtime Pre-Authorization Workflow
**Status:** Done _(completed 2026-05-26)_  
**Statutory basis:** MOM EA s.38 — OT capped at 72h/month for workmen; employer must not compel excessive OT.

**Scope:**
- OT pre-authorization request (employee or supervisor initiates) via `POST /attendance/ot-auth/requests`
- Standard OT: must be requested before the planned OT date
- Emergency OT: post-hoc authorization accepted within 24 hours of the OT date (`isEmergency: true`)
- Monthly OT cap enforcement: hard block at 72h — `PUT /ot-auth/requests/:id/approve` returns 409 with cap breakdown when approval would breach the MOM cap
- OT budget per department (configurable via `PUT /ot-auth/budget`); budget overrun is a soft warning — approval proceeds but response includes `budgetWarning`
- Auto-link authorized OT to AttendanceRecord via `POST /ot-auth/requests/:id/link-record`
- Monthly OT summary report per employee and department: `GET /ot-auth/summary/:period` (YYYY-MM)
- Employee can cancel own PENDING request; manager can cancel any
- Daily sweep at **00:50 SGT** auto-expires PENDING requests past their `expiresAt`

**New schema:** `OtAuthorization`, `OtBudget`, `OtAuthStatus` enum (`PENDING | APPROVED | REJECTED | CANCELLED | AUTO_EXPIRED`), `OtRequestType` enum (`EMPLOYEE | SUPERVISOR`)  
**New engine:** `src/engines/ot-auth.engine.js` — pure: `checkMonthlyCap`, `checkBudget`, `isWithinEmergencyWindow`, `computeExpiresAt`, `buildMonthlyOtSummary`, `findExpiredOtRequests`  
**API routes (11):** POST/GET/PUT requests, approve/reject/cancel/link-record, GET summary, GET/PUT budget, POST sweep  
**Tests:** 18 unit (`ot-auth.engine.unit.test.js`) + 23 integration (`ot-auth.integration.test.js`) — all passing; full attendance suite: **223 tests green**

**Service:** attendance-service  

---

### ✅ FWA-003 — WICA Work Injury Compensation
**Status:** Done _(completed 2026-05-26)_  
**Statutory basis:** Work Injury Compensation Act 2019. Employers must report accidents to MOM via iReport: **fatal within 1 working day**, **hospitalisation / permanent incapacity within 10 working days**. Failure to report is a criminal offence.

**Scope:**
- Incident report submission (employee or supervisor) — `POST /attendance/wica/incidents`
- Four MOM categories: `MEDICAL_LEAVE_ONLY` (no MOM reporting), `HOSPITALISATION`, `PERMANENT_INCAPACITY`, `FATAL`
- `momReportDeadline` auto-computed in working days (Mon–Fri) per category; null for MEDICAL_LEAVE_ONLY
- MOM iReport status tracking: `REPORTED → UNDER_REVIEW → MOM_REPORTED → CLAIM_SUBMITTED → CLOSED`; `ireportRef` captured on `PUT /incidents/:id`
- WICA claim workflow via `POST /incidents/:id/claims` (medical expenses, leave days, permanent incapacity %, compensation amount, insurer details, claim lifecycle: `PENDING → INSURER_NOTIFIED → UNDER_ASSESSMENT → APPROVED → PAID | REJECTED`)
- Return-to-work tracking via `POST /incidents/:id/rtw` (FULL_DUTIES | LIGHT_DUTIES | PHASED_RETURN, restrictions, review date)
- Overdue dashboard: `GET /incidents/overdue`, full `GET /wica/dashboard` with summary + due + overdue lists
- Daily sweep at **01:00 SGT** alerts HR_ADMIN for every overdue-unreported incident
- Deadline urgency enrichment on all responses: `OVERDUE | CRITICAL | WARNING | OK | NOT_REQUIRED`

**New schema:** `WicaIncident`, `WicaClaim`, `WicaRtwRecord`; enums: `WicaCategory`, `WicaStatus`, `ClaimStatus`, `RtwType`  
**New engine:** `src/engines/wica.engine.js` — pure: `isReportableToMom`, `computeMomDeadline`, `classifyDeadlineUrgency`, `daysUntilMomDeadline`, `findOverdueIncidents`, `buildWicaDashboard`  
**API routes (12):** incidents CRUD, claims CRUD, RTW create/list, overdue list, dashboard, sweep  
**Tests:** 18 unit (`wica.engine.unit.test.js`) + 20 integration (`wica.integration.test.js`) — all passing; full attendance suite: **261 tests green**

**Service:** attendance-service  

---

## Module 13: Benefits Administration

### ✅ BEN-001 — Group Insurance & Medical Benefits
**Status:** Done 2026-05-26  
**Scope delivered:**
- New `benefits-service` on port 4016, registered in API gateway at `/api/benefits`
- **Plan master:** Six plan types (GHS, GTL, PA, DENTAL, OUTPATIENT, OTHER) with insurer details, coverage cap, employer/employee/dependent premiums, BIK-taxable flag, eligibility by grade & tenure, effective dates, soft-delete (blocked when active enrollments exist)
- **Enrollment lifecycle:** `POST /benefits/enrollments` — HR enrolls anyone; employees self-enroll only during ACTIVE open enrollment window. Duplicate active enrollment blocked. `PUT /enrollments/:id/cancel` requires reason; snapshot of annual employer/employee premium captured at enrollment time
- **Dependent management:** Employee adds spouse/child/parent/other (PDPA-compliant: stores only last 4 of NRIC), soft-delete
- **Claims:** `POST /benefits/claims` — auto-generated `CLM-YYYY-NNNNN` claim numbers, coverage-cap enforced, blocks if enrollment not ACTIVE. HR approve/reject (reason required), Finance reimburse (APPROVED → REIMBURSED only)
- **Open enrollment windows:** `POST /benefits/open-enrollment` with year/dates/plan whitelist; auto-status ACTIVE/SCHEDULED on creation; `PUT /:id/close` to close
- **BIK calculation:** Employer-paid premiums for taxable plans (incl. per-dependent premiums) computed for IR8A reporting
- **Insurer reconciliation:** `GET /benefits/reconciliation?planId=&insurerBilled=` — expected vs billed variance with %
- **Dashboard:** Active enrollments, claim totals, employer premium load, BIK by plan, current open enrollment window
- **Frontend:** Role-split `/benefits` page — employee sees plans/dependents/claims with in-window enrollment; HR sees plans grid, enrollments table, claims approval queue, open enrollment scheduling
- **Navigation:** "My Benefits" (⊕) added to every role nav's EMPLOYEE group; "Benefits" added to HR/Super_Admin FINANCIAL group
- **Tests:** 27 unit + 35 integration = 62/62 passing

**Service:** new benefits-service (port 4016)  

---

### ✅ BEN-002 — Flexi-Benefits Wallet
**Status:** Done 2026-05-26  
**Scope delivered:**
- **Engine (`src/engines/flexi-wallet.engine.js`):** Pure — no DB. `computeBalance` (credited − used − pending), `isWalletExpired` (status=EXPIRED or past expiresAt), `shouldAutoApprove` (≤threshold, threshold>0), `computeYearEndSummary` (ACTIVE only, byGrade), `buildWalletDashboard` (byGrade + byCategory, skips CANCELLED/REJECTED), `walletExpiresAt` (Dec 31 23:59:59 SGT = Dec 31 15:59:59 UTC)
- **Schema:** 4 new models — `FlexiWalletConfig` (grade → annualAmount + autoApproveThreshold), `FlexiCategory` (code/name/requiresReceipt), `FlexiWallet` (per employee per year, unique [employeeId,year]), `FlexiClaim` (FLX-YYYY-NNNNN auto-number, PENDING/APPROVED/REJECTED/CANCELLED); 2 new enums `WalletStatus` + `FlexiClaimStatus`
- **Six eligible categories:** GYM, DENTAL, OPTICAL, HEALTH_SCREENING, WELLNESS, PROFESSIONAL_DEVELOPMENT; all receipt-required by default
- **Grade defaults:** STAFF SGD 500, EXEC 1000, MGR 1500, DIR/VP/C_SUITE 2000
- **Wallet lifecycle:** `POST /flexi-wallets` (HR upserts); `POST /flexi-wallets/credit-batch` (fetches all active employees from employee-service, upserts by grade); `GET /flexi-wallets/me?year=` (employee own wallet + balance + pending claims); `GET /flexi-wallets` (HR all, employee own)
- **Year-end:** `GET /flexi-wallets/year-end-preview?year=` dry-run summary; `POST /flexi-wallets/year-end` marks ACTIVE → EXPIRED, sets forfeitedAmount or encashedAmount; `GET /internal/flexi-encashment?year=` (x-internal-service-key auth) for payroll pickup
- **Claims:** `POST /flexi-claims` — balance check (available = creditedAmount − usedAmount − ∑PENDING), auto-approve atomic $transaction (claim create + wallet.usedAmount update) for amounts ≤ autoApproveThreshold; `PUT /flexi-claims/:id/approve` — PENDING→APPROVED atomic; `PUT /flexi-claims/:id/reject` — reverses usedAmount if was APPROVED; `PUT /flexi-claims/:id/cancel` — PENDING only
- **Config:** `GET /flexi-config` (stored configs + DEFAULT_GRADE_AMOUNTS for missing grades, `isDefault:true`); `PUT /flexi-config` (upsert by grade)
- **Categories:** `POST /flexi-categories/seed` (idempotent 6-category seed); `GET /flexi-categories`; `POST /flexi-categories` (HR custom, 409 on dup code); `PUT /flexi-categories/:id`
- **Dashboard:** `GET /flexi-dashboard?year=` via buildWalletDashboard (byGrade + byCategory claim breakdown)
- **Frontend (employee):** Balance card (progress bar, credited/used/pending/remaining, expiry date, ACTIVE/EXPIRED badge), eligible category pills (6 colour-coded), "Submit Claim" button → FlexiClaimModal, My Flexi Claims table (category pill, auto-approved label, cancel for PENDING)
- **Frontend (HR):** Flexi Benefits tab in HR admin, 4 sub-tabs — Wallets (stats dashboard + wallet table + Credit Wallet / Batch Credit buttons), Claims (approval queue with Approve/Reject/Reverse), Config (grade table with Edit → prompt-based upsert), Year-End (preview + Forfeit / Encash buttons)
- **Modals:** `FlexiClaimModal` (category picker, receipt date, vendor, description, amount), `FlexiWalletCreditModal` (employee ID, name, grade, amount)
- **Tests:** 20 unit (`flexi-wallet.engine.unit.test.js`: CAT-01/02, DEF-01, CB-01–05, WE-01–04, SA-01–05, YE-01–03, BD-01–04) + 34 integration (`flexi.integration.test.js`: FW-01–34) = 54 new tests; total benefits suite **120/120 green**

**Service:** benefits-service (port 4016) — extended  

---

## Module 14: HR Case Management

### ✅ HRC-001 — Disciplinary & Grievance Management
**Status:** Done 2026-05-26  
**Scope delivered:**
- New `hr-case-service` on port 4017, registered at API gateway `/api/hr-cases`
- **Models:** HrCase (auto-numbered DSC-YYYY-NNNNN / GRV-YYYY-NNNNN), CaseIncident, CaseAction, CaseTimeline (immutable audit), CaseAppeal, InquiryCommittee (one per case), CaseAttachment — all cascade-delete on case removal
- **Progressive discipline ladder:** VERBAL → WRITTEN → FINAL → TERMINATION; `GET /hr-cases/:id/recommend-next-action` suggests next rung based on prior actions. Gross misconduct skips ladder to summary dismissal (EA s.14(1))
- **Action gating:** `canIssueAction` blocks TERMINATION on MINOR/INTAKE; allows it for GROSS_MISCONDUCT or once case reaches HEARING/DECISION stage
- **SLA & auto-escalation:** Severity-based SLAs (MINOR 30d, MODERATE 14d, SERIOUS 7d, GROSS_MISCONDUCT 3d). Daily sweep at 01:30 SGT auto-advances HR_ADMIN → HR_MANAGER → DIRECTOR → BOARD; manual `POST /hr-cases/sweep` available
- **Stage workflow:** INTAKE → INVESTIGATION → HEARING → DECISION → APPEAL → CLOSED. Auto-progression on key actions (SHOW_CAUSE/SUSPENSION → INVESTIGATION; TERMINATION → CLOSED; inquiry committee → INVESTIGATION; appeal filed → APPEAL)
- **Inquiry committee:** HR_MANAGER+ forms committee with chair + members + scope + hearing date; later submits report and recommendation
- **Show-cause letters & suspension:** Action type fields capture deadline / paid-vs-unpaid suspension
- **Subject acknowledgement:** Subject employee can `PUT /actions/:id/acknowledge` to confirm receipt (optional e-sign link)
- **Appeals:** Subject files appeal only when status=RESOLVED; HR_MANAGER decides UPHELD/PARTIALLY_UPHELD/REJECTED/WITHDRAWN
- **TAFEP / MOM auto-flag:** Discrimination category + harassment grievances of gross misconduct severity flip `isTafepReportable=true` on create/update
- **Union consultation tracking:** `isUnionised` + `unionConsulted` + `unionNotes` fields
- **Confidentiality:** Default `confidential=true`. Employee can only see (a) their own grievances they filed, (b) disciplinary cases where they are the subject (read-only). HR sees all
- **Resolution / Closure / Withdraw:** `PUT /resolve` (HR), `PUT /close` (HR), `PUT /withdraw` (case opener)
- **Timeline audit:** Every action writes a CaseTimeline row (CASE_OPENED, INCIDENT_LOGGED, ACTION_ISSUED:X, ESCALATED:LEVEL, APPEAL_FILED, RESOLVED, etc.) — immutable
- **Frontend:** `/hr-cases` list with type/severity filters + 3 tabs (all/open/overdue) + overdue SLA banner; `/hr-cases/:id` detail with stage progress, action bar (escalate/resolve/close/appeal/withdraw), three-panel layout (incidents/actions/timeline), inquiry committee panel, appeals panel; 4 action modals
- **Navigation:** "HR Cases" (⚖) added to HR/Super_Admin COMPLIANCE group; "My Cases" added to every role's EMPLOYEE group
- **Tests:** 28 unit + 32 integration = 60/60 passing

**Service:** new hr-case-service (port 4017)  

---

## Module 15: Employee Services

### ✅ ESV-001 — Staff Movement & Internal Transfer
**Status:** Done 2026-05-26  
**Scope delivered:**
- Extended `employee-service` with `StaffMovement` model + 2 enums (MovementType, MovementStatus); auto-numbered MOV-YYYY-NNNNN
- 7 movement types: DEPARTMENT_TRANSFER, LOCATION_TRANSFER, INTER_COMPANY_TRANSFER, ROLE_CHANGE, PROMOTION, REPORTING_CHANGE, COST_CENTRE_REALLOC
- Type-specific validation: each type requires its key field to change (e.g. DEPARTMENT_TRANSFER must change department); no-op blocked
- Before/after snapshot captured at initiation; applied on effective date so future-dated movements take effect automatically
- **Salary revision linkage:** Optional `hasSalaryRevision` with encrypted from/to salaries; on apply writes to `SalaryHistory` (existing model) with reasonCode and links via `Staff movement MOV-YYYY-NNNNN`
- **Approval gating (engine):** Inter-company transfers, > 30% salary jumps, and salary decreases require HR_MANAGER+ approval (HR_ADMIN blocked with 403 + reason)
- **Initiation permissions:** HR opens for anyone; line manager opens for subordinates; employee self-initiates (HR review required)
- **Daily effective-date sweep:** runs at 02:00 SGT — applies all APPROVED movements whose effectiveDate ≤ today. Updates Employee.department / designation / costCentre / reportingManagerId / employmentType + writes SalaryHistory if applicable. Failed applies capture `applyError` for HR review. Manual sweep: `POST /movements/sweep`
- **Transfer letter generation:** auto-generated on approval (HTML with before/after fields, effective date, reason). `GET /movements/:id/letter` returns or lazily generates
- **Notifications:** Fire-and-forget to HR on initiation, to employee on approval
- **Routes:** `POST /movements`, `GET /movements`, `GET /movements/summary`, `GET /movements/:id`, `GET /movements/:id/letter`, `PUT /movements/:id/approve|reject|cancel`, `POST /movements/:id/apply`, `POST /movements/sweep`
- **API gateway:** `/api/movements` proxied to employee-service
- **Frontend:** `/movements` page with 4 tabs (all/pending/upcoming/history); role-split header; HR stat cards (pending/approved/effective-today/upcoming-30d/applied-YTD); per-row before/after delta display. `/movements/[id]` detail page with before-after change cards, salary revision badge, status timeline, action bar (approve/reject/cancel/apply), inline transfer letter preview
- **Navigation:** "Movements" (↹) added to HR_ADMIN + SUPER_ADMIN WORKFORCE group
- **Tests:** 27 unit + 22 integration on movements = 49/49 passing; full employee-service suite **80/80 passing**

**Service:** employee-service (new schema + new routes file)  

---

### ✅ ESV-002 — Salary Advance & Staff Loans
**Status:** Done 2026-05-26  
**Scope delivered:**
- New `loans-service` on port 4018, registered at API gateway `/api/loans`
- **Models:** `SalaryAdvance` (single-month deduction), `StaffLoan` (multi-month with installment schedule), `LoanRepayment` (per-month rows with unique `(loanId, paymentNumber)`); 4 enums covering all states
- **Auto-numbered references:** ADV-YYYY-NNNNN / LN-YYYY-NNNNN
- **Salary advance flow:** Employee requests with monthlySalary snapshot → engine enforces 1× monthly salary cap (configurable via `MAX_ADVANCE_MULTIPLIER`) → HR/Finance approves with target deductionMonth (defaults to current YYYY-MM) → payroll-service callback marks DEDUCTED with payrollRunId
- **Duplicate prevention:** Employee blocked from raising a new advance while one is PENDING/APPROVED; blocked from a new loan while one is PENDING/APPROVED/ACTIVE
- **Staff loan flow:** request → approve (generates schedule + agreement) → activate (after agreement signed) → repayments per month → SETTLED on final or early payoff
- **Engine guards:** principal/tenure/interest rate validation (tenure ≤ 60 months, rate ≤ 10% p.a., affordability check that monthly instalment ≤ 30% of salary)
- **Simple-interest amortisation:** `monthlyInstalment = (principal + principal × rate × tenure/12) / tenure`; last instalment absorbs rounding remainder so schedule sum equals total repayable exactly
- **Auto-generated repayment schedule:** Each `LoanRepayment` row created with `scheduledDate` on the 1st of each month from `startDate`
- **Live outstanding balance:** `computeOutstandingBalance` updates on every repayment; loan auto-flips to SETTLED when outstanding ≤ 0.005
- **Early settlement:** `POST /loans/staff-loans/:id/settle` quotes today's outstanding, creates an EARLY_SETTLEMENT row, waives all remaining PENDING rows, flips loan to SETTLED
- **Loan agreement:** Generated HTML on approval (or lazily on `GET .../agreement`) with principal, rate, tenure, monthly instalment, total repayable, start + end dates — printable and ready for ESV-003 e-sign linkage via `esignRequestId`
- **Termination hook:** `GET /loans/termination-deductions/:employeeId` returns aggregate outstanding (active loans + approved advances) for offboarding final-pay computation; `mustDeductFromFinalPay` boolean
- **Payroll callback hooks:** `POST /loans/staff-loans/:id/repayments` and `POST /loans/advances/:id/mark-deducted` accept `payrollRunId` so payroll-service can mark deductions after each run
- **Dashboard:** `GET /loans/dashboard` — counts by status, total principal/outstanding/repaid, advances summary; restricted to HR/Finance/Super
- **Frontend:** `/loans` list with 2 tabs (Staff Loans / Salary Advances), HR/Finance stat cards, inline approve/reject/cancel actions on advances. `/loans/[id]` detail page with progress bar, meta grid, repayment schedule (responsive table → mobile cards), action bar (approve/reject/activate/cancel/settle), inline loan agreement preview with print
- **Navigation:** "Loans" added to SUPER_ADMIN + HR_ADMIN + FINANCE_ADMIN FINANCIAL group; "My Loans" added to every role nav's EMPLOYEE group
- **Tests:** 23 unit + 29 integration = 52/52 passing

**Service:** new loans-service (port 4018)  

---

### ✅ ESV-003 — E-Signature & Document Acknowledgement
**Status:** Done 2026-05-26  
**Scope delivered:**
- New `esign-service` on port 4015, registered in API gateway at `/api/esign`
- Template management: `POST/GET/PUT /esign/documents` — HR creates templates with `{{key}}` placeholders, version, type, `annualRenewal` flag, `expiresInDays`
- Signing requests: `POST /esign/requests` — bulk dispatch to multiple signatories; skips duplicates for same (documentId, signatoryId, documentVersion)
- Signatory actions: `PUT /esign/requests/:id/sign` (records SHA-256 hash of personalizedHtml, signatory name, timestamp), `PUT /esign/requests/:id/decline` (reason required)
- Personalisation: `{{key}}` placeholders replaced from `variables` map at request creation; unmatched placeholders left intact
- Audit trail: immutable `ESignAuditLog` rows for every action (CREATED, VIEWED, SIGNED, DECLINED, EXPIRED, REVOKED, REMINDER_SENT)
- `viewedAt` auto-recorded on first GET by signatory
- Compliance dashboard: `GET /esign/compliance` — per-document sign/pending/declined/expired counts + complianceRate
- Daily sweep at 01:10 SGT: expires PENDING past `dueDate`, sends reminders at 3d and 1d before due
- Annual renewal: `POST /esign/documents/:id/renew` — re-creates pending requests for the new year with versioned `${version}-${year}`
- **Frontend:** Full `/documents` page (employee queue + HR compliance view with 4 tabs: Pending/Templates/Compliance/Signed Archive); `/documents/sign/[id]` signing experience (scroll-gated, typed name, agreement checkbox, sign/decline)
- **Navigation:** My Documents (◭) added to all role navs; Documents (◭) added to HR Compliance group
- **Tests:** 17 unit + 25 integration = 42/42 passing

**Service:** new esign-service (port 4015)  

---

## Module 16: Analytics & Engagement

### ✅ ENG-001 — Employee Engagement Survey
**Status:** Done 2026-05-26  
**Scope delivered:**
- New `survey-service` on port 4019, registered at `/api/surveys` in the gateway
- **5 Prisma models:** `Survey` (DRAFT/ACTIVE/CLOSED + anonymous flag + minResponsesToShow + targetDepartment/MinTenure filter), `SurveyQuestion` (LIKERT_5 / NPS / TEXT / MULTI_CHOICE with displayOrder + scaleLabels + category), `SurveyResponse` (snapshots department/tenure/employmentType so segmentation survives later employee changes; `respondentEmployeeId` is null when anonymous; ipHash for de-dup), `SurveyAnswer` (cascade-deletes via response), `SurveyAction` (manager follow-up items: title, description, status, due date)
- **Pure engine (8 functions):**
  - `computeENPS(scores)` — promoters (9-10), passives (7-8), detractors (0-6); eNPS = %promoters − %detractors
  - `computeLikertStats` — average + 5-rung distribution + positivePct (≥4)
  - `computeMultiChoiceStats` — counts + percentages with out-of-range filtering
  - `aggregateBySegment` — by department / tenure-bucket (`<1y`/`1-3y`/`3-5y`/`5y+`) / employmentType
  - `suppressLowSample` — wipes any aggregate with `total < minN` (default 3) to protect anonymity
  - `buildSurveyDashboard` — per-question stats + segment counts, applies suppression to both
  - `validateAnswers` — required + type-correctness checks (Likert 1-5, NPS 0-10, choice index in range, required-text presence)
- **Routes (18 endpoints):** survey CRUD + `publish` (blocks if no questions) + `close`; question CRUD; response submission (anonymous-safe, single-response de-dup for identified surveys); per-user "have I responded?" check; HR dashboard with N-suppression; action items CRUD; `POST /surveys/exit-trigger` returning the active EXIT survey for offboarding callbacks
- **Frontend:** `/surveys` list (role-split: employees see ACTIVE only with "Take" CTA; HR sees all + create modal). `/surveys/[id]` HR detail page with 3 tabs (Questions / Results / Actions) + publish/close/add-question/add-action modals. `/surveys/[id]/take` mobile-friendly take-survey form with 5-button Likert scale, 11-button NPS scale with promoter/passive/detractor colour coding, multi-choice radio cards, and free-text. Results tab shows per-question visualisations: Likert distribution bar chart with average + positive%, NPS score with promoters/passives/detractors split, multi-choice horizontal bars, raw text comments with display-cap and suppression banner
- **Navigation:** "Surveys" (◊) added to HR/Super_Admin COMPLIANCE; "My Surveys" added to every role nav's EMPLOYEE group
- **Tests:** 22 unit + 18 integration = 40/40 passing

**Service:** new survey-service (port 4019)  

---

### ✅ ENG-002 — HR Analytics Dashboard
**Status:** Done 2026-05-26  
**Scope delivered:**
- Extended `reporting-service` with 9 new analytics endpoints under `/reports/analytics/*` — restricted to HR_ADMIN / HR_MANAGER / SUPER_ADMIN (Finance gets payroll/budget views)
- **Budget store:** `POST/GET /reports/analytics/budget` — HR/Finance sets headcount targets, recruitment spend, annual revenue per period (YYYY-MM for headcount, YYYY for the others)
- **Headcount analytics:** `GET /reports/analytics/headcount?period=YYYY-MM` — active count + budget + variance + variance% + by-department drill-down
- **12-month attrition:** `GET /reports/analytics/attrition?months=12` — leaver count, attrition rate (leavers / avg-headcount), by-department, by-tenure bucket
- **Cost per hire:** `GET /reports/analytics/cost-per-hire?period=YYYY` — recruitment spend ÷ new hires in that year
- **Leave utilisation heatmap:** `GET /reports/analytics/leave-heatmap?year=YYYY` — monthly days-taken array + by-leave-type breakdown
- **6-month OT cost trend:** `GET /reports/analytics/ot-cost-trend?months=6` — pulls from attendance-service `/ot-summary/:period` per month
- **Training ROI:** `GET /reports/analytics/training-roi?year=YYYY` — total cost, hours, completions, cost-per-hour, cost-per-completion (graceful fallback if training-service unavailable)
- **Payroll / revenue ratio:** `GET /reports/analytics/payroll-revenue-ratio?period=YYYY` — aggregates 12 monthly payroll runs and divides by revenue budget
- **PDPA retention dashboard:** `GET /reports/analytics/pdpa-retention` — flags ex-employee records past 6.5 years post-termination (7-year SG retention cap), returns daysSinceTermination per record
- **Summary fan-out:** `GET /reports/analytics/summary` — single call returning all top KPIs for fast initial page load
- **Frontend:** New `/reports/analytics` page with period/year selectors + budget modal. KPI strip (headcount vs budget, attrition rate with red/green colour by 15% threshold, cost-per-hire, payroll/revenue %). Sections: headcount by department (horizontal bars), attrition by tenure + department (split bars), 12-month leave heatmap (intensity-coloured grid by month), 6-month OT cost trend (vertical bar chart), training ROI 4-KPI grid, PDPA retention list with "approaching 7-year limit" alerts
- **Navigation:** "Analytics" (◧) added to HR/Super_Admin COMPLIANCE group
- All endpoints use existing JWT auth and fan out to employee/leave/attendance/training/payroll services via authenticated axios calls

---

### ❌ ENG-003 — Succession Planning
**Status:** Not Done  
**Scope:**
- Key position identification (flagged by HR Admin on any job title)
- Talent pool management: HR nominates high-potential employees
- Readiness assessment per nominee: Ready Now / 1 Year / 2 Years
- Development plan linkage: connect readiness gaps to training programs
- 9-box grid (Performance × Potential) fed from appraisal scores
- Succession risk report: positions with no ready successor flagged as HIGH RISK
- Manager view: own team succession status

**Service:** extend performance-service  

---

## Outstanding Items Priority List

### Statutory / Legal Risk (do first)
| ID | Feature | Statutory Basis | Risk if Missing |
|---|---|---|---|
| ~~FWA-002~~ | ~~OT Pre-Authorization~~ | ✅ Done 2026-05-26 | — |
| ~~FWA-003~~ | ~~WICA Incident Reporting~~ | ✅ Done 2026-05-26 | — |
| ~~ESV-003~~ | ~~E-Signature / Document Acknowledgement~~ | ✅ Done 2026-05-26 | — |

### High Business Value (do next)
| ID | Feature | Why |
|---|---|---|
| ~~BEN-001~~ | ~~Group Insurance & Medical Benefits~~ | ✅ Done 2026-05-26 |
| ~~HRC-001~~ | ~~Disciplinary & Grievance~~ | ✅ Done 2026-05-26 |
| ~~ESV-001~~ | ~~Staff Movement / Transfer~~ | ✅ Done 2026-05-26 |
| ~~ESV-002~~ | ~~Salary Advance & Staff Loans~~ | ✅ Done 2026-05-26 |

### Analytics Layer (do last)
| ID | Feature | Why |
|---|---|---|
| ~~ENG-001~~ | ~~Employee Engagement Survey~~ | ✅ Done 2026-05-26 |
| ~~ENG-002~~ | ~~HR Analytics Dashboard~~ | ✅ Done 2026-05-26 |
| ENG-003 | Succession Planning | Longer planning horizon, lower urgency |

---

_Document auto-maintained — update this file when a requirement moves to Done._
