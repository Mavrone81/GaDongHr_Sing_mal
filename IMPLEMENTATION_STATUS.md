# Implementation Status

**PRD Reference:** PRD-HRMS-001 v2.0  
**Last Updated:** 2026-05-24 _(OFF-004 completion — IR21 auto-population, money-withhold gate, deadline dashboard, daily reminder sweep)_  
**Legend:** ✅ Done · ⚠️ Partial · ❌ Not Done

---

## Summary

| Module | Done | Partial | Not Done | Total |
|--------|------|---------|----------|-------|
| Payroll & CPF | 6 | 6 | 0 | 12 |
| Leave Management | 5 | 2 | 0 | 7 |
| Claims & Expenses | 3 | 1 | 0 | 4 |
| Recruitment & Onboarding | 1 | 4 | 0 | 5 |
| Time & Attendance | 4 | 1 | 0 | 5 |
| Performance Management | 4 | 1 | 1 | 6 |
| Training & Development | 2 | 1 | 1 | 4 |
| Asset Management | 2 | 0 | 2 | 4 |
| Offboarding | 5 | 0 | 0 | 5 |
| Reporting & Analytics | 1 | 2 | 0 | 3 |
| Support & Ticketing | 3 | 0 | 1 | 4 |
| **Total** | **36** | **17** | **6** | **59** |

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

### ⚠️ PAY-004 — SDL & FWL Computation
**Status:** Partial  
**Done:** SDL min(max(Gross × 0.25%, SGD 2.00), SGD 11.25) per employee, SDL submission file.  
**Outstanding:**
- FWL rate table configuration by sector and worker tier exists but DRC quota alerts not yet implemented
- FWL dependency ratio ceiling (DRC) warning to HR when approaching MOM quota limit missing

### ⚠️ PAY-005 — Payslip Generation (MOM Mandatory)
**Status:** Partial  
**Done:** All MOM-mandatory fields (name, NRIC, employer, period, basic salary, allowances, OT, deductions, CPF YTD, net pay) generated per employee per run. Payslip viewable via ESS portal (`/payslips/me`).  
**Outstanding:**
- PDF download rendering (data returned as JSON; PDF template not yet implemented)
- Payslip issued-by-payment-date SLA enforcement and HR alert missing
- Mobile app push notification on payslip publication missing
- 5-year archive with searchable index not yet implemented

### ⚠️ PAY-006 — Bank GIRO File Generation
**Status:** Partial  
**Done:** GIRO file endpoint (`GET /bank-giro/:runId`) exists; generates payment file per employee with bank code, branch, account, net pay.  
**Outstanding:**
- Only one generic format; bank-specific formats (DBS IDEAL, OCBC Velocity, UOB BIBPlus, SCB, HSBC, Maybank) not differentiated
- Bank acknowledgement file reconciliation (failed credit flagging) not yet implemented

### ⚠️ PAY-007 — CPF e-Submit & IRAS AIS Filing
**Status:** Partial  
**Done:** CPF flat-file generation (`GET /cpf-file/:runId`), IR8A data aggregation and IRAS-format file generation (`GET /ir8a-data/:year`, `GET /ir8a-file/:year`).  
**Outstanding:**
- CPF e-Submit portal upload workflow (confirmation reference number storage) not automated — manual upload only
- Appendix 8A (BIK) and Appendix 8B (stock options) not yet computed (depends on PAY-010)
- IR21 auto-populated from payroll YTD data partially done (offboarding service triggers IR21 but full auto-population incomplete)
- IRAS AIS e-Service submission workflow not automated

### ✅ PAY-008 — Maker-Checker Approval & Audit Trail
**Status:** Done  
Two-level approval, variance report required before finalisation, payroll locked on finalise, ad-hoc correction run required to amend locked payroll, immutable audit log.

### ✅ PAY-009 — Salary Revision History & Back-Dating
**Status:** Done _(implemented 2026-05-23)_  
Full revision workflow: `POST /:id/salary-revisions` (PENDING), `PUT /:id/salary-revisions/:revId/approve` (applies salary + computes catch-up = Δsalary × months elapsed), `PUT /:id/salary-revisions/:revId/reject`, `GET /salary-revisions/pending` (HR-wide queue), `GET /salary-revisions/budget-envelope?year=YYYY` (Σ annual delta). Reason codes: PROMOTION, ANNUAL_INCREMENT, MARKET_ADJUSTMENT, ROLE_CHANGE, CORRECTION, OTHER. All salary data AES-256 encrypted. Frontend UI with revision modal, KPI cards, and status-aware table.

### ✅ PAY-010 — Benefits-in-Kind & Appendix 8A/8B Tracking
**Status:** Done _(implemented 2026-05-23)_  
BIK item CRUD with IRAS formula computation (`POST/GET/PUT/DELETE /payroll/bik-items`) covering all 4 PRD types: COMPANY_CAR (3/7 × purchase cost + optional 3/7 × running cost if employer provides fuel), HOUSING (IRAS-assessed AV less employee contribution), CLUB_MEMBERSHIP, GROUP_INSURANCE, OTHER (manual). Stock option lifecycle (`POST/GET/PUT/DELETE /payroll/stock-options`) and exercise events (`POST /payroll/stock-options/:id/exercises`) with taxable gain = max(0, (OMV − optionPrice) × shares). Annual aggregation endpoints: `GET /payroll/appendix-8a/:year`, `GET /payroll/appendix-8a-file/:year`, `GET /payroll/appendix-8b/:year`, `GET /payroll/appendix-8b-file/:year`, all in IRAS pipe-delimited flat-file format. Existing `GET /payroll/ir8a-data/:year` and `/ir8a-file/:year` now fold in BIK + ESOP totals per employee (regression-tested). All monetary fields AES-256 encrypted. 18 unit tests for IRAS formulas (`bik-engine.unit.test.js`) + 23 integration tests (`bik-api.integration.test.js`) including 2 IR8A regression tests.

### ⚠️ PAY-011 — Government-Paid Leave Integration
**Status:** Partial  
**Done:** NPL auto-deduction from approved leave passed to payroll (daily rate × NPL days deduction line). Govt-paid leave type flags in leave module.  
**Outstanding:**
- CPF treatment differentiation (employer-paid portion vs government pass-through) not yet applied automatically
- GPML/GPPL/NS make-up pay claim generation and tracking not yet implemented
- NS make-up pay formula (civilian daily rate − NS allowance × NS days) not yet automated

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

### ⚠️ LEA-004 — MC & Document Tracking
**Status:** Partial  
**Done:** Document/attachment upload and download per leave application (MC, hospital memo, birth certificate).  
**Outstanding:**
- MC pattern detection (repeated Monday/Friday sick leave flagging) not yet implemented
- Sick leave frequency trend dashboard per employee and department missing

### ⚠️ LEA-005 — Government-Paid Leave Tracking & Claims
**Status:** Partial  
**Done:** Govt-paid leave types (GPML, GPPL, CCL, SPL, Extended CCL, Infant Care, Adoption) exist in entitlement engine with separate govt-paid flags.  
**Outstanding:**
- Auto-generation of reimbursement claim data (NRIC, leave dates, daily rate, reimbursable amount capped per MSF schedule) not yet implemented
- Claim status tracking (Not Submitted / Submitted / Reimbursed) missing
- MSF daily cap configurable fields (GPML SGD 10,000/4-week, GPPL SGD 2,500/week, CCL SGD 500/week) not yet wired to claim computation

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

### ⚠️ CLM-004 — GST & Finance Reporting
**Status:** Partial  
**Done:** `GET /claims/report` returns claims with GST amounts broken out. Per-claim GST computation (9÷109 formula).  
**Outstanding:**
- Finance dashboard (GST-claimable totals by period, category, cost centre) not yet built on frontend
- Vendor GST registration number validation against IRAS GST list not implemented
- Claims analytics (spend by category vs budget, top claimants trend) not yet on analytics dashboard

---

## Module 4: Recruitment & Onboarding

### ✅ REC-001 — Applicant Tracking System (ATS) with Lifecycle Tracking
**Status:** Done  
Job requisitions, pipeline stages (Applied → Screened → Interviewed → Offered → Hired/Rejected), candidate pool (independent of jobs), stage timeline audit trail, resume upload/download/replace, interview scheduling (rounds + feedback), FCF compliance flag per job, candidate tag-to-job.  
**Note:** Offer letter PDF template generation and e-sign workflow are partial.

### ⚠️ REC-002 — FCF & MyCareersFuture Compliance
**Status:** Partial  
**Done:** `POST /jobs/:id/fcf-compliance` records FCF posting date and flag per job.  
**Outstanding:**
- 14-day elapsed enforcement that blocks EP application trigger not yet wired to work-pass application workflow
- FCF audit trail (nationality breakdown of applicants, shortlisting notes, hiring decision rationale) not fully captured
- FCF Compliance Report (all jobs with posting status, days advertised, nationality breakdown) not yet built

### ⚠️ REC-003 — Work Pass Tracking & Expiry Alerts
**Status:** Partial  
**Done:** `GET /recruitment/work-passes` endpoint; pass type, number, expiry date stored per employee in Employee model.  
**Outstanding:**
- Automated expiry alerts at 90/60/30 days (scheduled job) not yet implemented
- DRC quota monitoring and MOM quota alert not yet implemented
- Pass renewal workflow (initiate, checklist, outcome update) not yet built

### ⚠️ REC-004 — Digital Onboarding Workflow
**Status:** Partial  
**Done:** `POST /onboarding/:employeeId/start`, `GET /onboarding/:employeeId`, `PUT /onboarding/:employeeId/tasks/:taskId` — onboarding task lifecycle tracking. Pre-boarding portal for personal particulars and document upload.  
**Outstanding:**
- IT provisioning request auto-creation on Day −5 not implemented
- HR Buddy/Mentor assignment not implemented
- Incomplete onboarding 3-day-before-start-date HR alert missing
- Mandatory acknowledgements (handbook, harassment policy, PDPA) e-sign not fully implemented

### ⚠️ REC-005 — Employee Record Auto-Creation
**Status:** Partial  
**Done:** `POST /applications/:id/approve` creates employee record with unique Employee ID. Leave entitlement provisioned via internal auto-provision call. Employee activated on start date.  
**Outstanding:**
- IT access provisioning trigger on approval not implemented
- Payroll setup (bank details, CPF profile) automatic wiring on approval incomplete
- Assets-to-issue list auto-creation on approval missing
- Probation tracking auto-start on activation missing
- Confirmation email to new employee and Line Manager not yet sent

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

### ⚠️ TAT-004 — Attendance Anomaly Detection
**Status:** Partial  
**Done:** Attendance records stored; late/early/missing-clock-out anomalies implicitly detectable from records.  
**Outstanding:**
- Automated anomaly classification (late arrival, early departure, AWOL, missing clock-out, excessive OT) with configurable thresholds not yet implemented
- Manager daily summary email of team anomalies not implemented
- Anomaly acknowledgement/explanation workflow (manager review) not built
- Real-time attendance dashboard (who's in/WFH/absent/late) not yet on frontend

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

### ⚠️ PMS-003 — Calibration & Bell Curve
**Status:** Partial  
**Done:** Calibration view and individual rating adjustment (`PUT /cycles/:id/appraisals/:appraisalId/calibrate`), calibration lock (`POST /cycles/:id/lock-calibration`).  
**Outstanding:**
- Bell curve enforcement (configurable distribution targets, % per band) and deviation warning not yet implemented
- Department/level grouping for calibration session view not yet built

### ✅ PMS-004 — Salary Increment Linkage
**Status:** Done  
Compensation matrix with increment proposals (`POST /cycles/:id/increment-proposals`), manager review and adjustment (`PUT /cycles/:id/increment-proposals/:pid`), budget envelope enforcement, `POST /cycles/:id/apply-increments` feeds salary revisions into PAY-009 workflow.

### ✅ PMS-005 — Probation Management
**Status:** Done  
Probation tracking per employee, 30/14/7-day reminders to Line Manager and HR, outcomes (Confirm / Extend / Terminate), permanent status change on confirmation, PIP creation and progress tracking.

### ❌ PMS-006 — 360-Degree Feedback
**Status:** Not Done  
**Outstanding:**
- Peer/subordinate reviewer nomination by employee
- HR Admin reviewer list approval
- Anonymous feedback form (configurable per question type)
- Aggregate competency report without identifying reviewers
- 360 score factored into overall appraisal rating at configurable weight

---

## Module 7: Training & Development

### ✅ TRN-001 — Learning Management System (LMS)
**Status:** Done  
Course/program creation (classroom, e-learning, OJT, blended), training materials upload, enrollment workflow (nomination → manager/Training Manager approval → completion), attendance, assessment scores, completion status, certifications, training history per employee.

### ✅ TRN-002 — SDL Computation & Reporting
**Status:** Done  
SDL computed in every payroll run per eligible employee. SDL submission file in CPF Board format. Monthly SDL totals available in payroll run data.

### ❌ TRN-003 — Government Grant Claims & SkillsFuture
**Status:** Not Done  
**Outstanding:**
- ETS eligibility flag on SSG-funded courses and ETS grant claim report generation
- Absentee Payroll (AP) computation (training hours × SGD 7.50/hr per employee) and SSG export
- SkillsFuture Credit (SFC) declaration and utilisation tracking per employee
- SFEC (SGD 10,000 enterprise credit) balance tracking and programme flagging

### ✅ TRN-004 — Certification Expiry & Competency
**Status:** Done  
Certification records with expiry date, `GET /certifications/expiring-soon`. Daily reminder sweep at 00:10 SGT fires 90/60/30-day reminders idempotently (unique (certId, threshold)). Competency framework: competencies, program→competency mapping (taughtLevel), job-family required levels, employee assessed levels, and `GET /employees/:id/competencies/gap?jobFamily=X` returning gap and recommended PUBLISHED programs. Auto-nomination: when the 60-day reminder first fires for a cert with `renewalProgramId`, the employee is enrolled in that program (`enrolledBy: system:cert-reminder`), with the existing-enrollment check preventing duplicates.

---

## Module 8: Asset & Logistics Management

### ✅ AST-001 — Asset Register & Assignment
**Status:** Done  
Full asset register (ID, category, serial, purchase date/cost, warranty, condition, assignee), digital handover acknowledgement, asset transfer (return + re-handover), full assignment history per asset.

### ❌ AST-002 — Logistics Requests & Inventory
**Status:** Not Done  
**Outstanding:**
- Employee logistics request submission (stationery, PPE, uniforms) via ESS portal
- Manager approval and Logistics Officer fulfilment workflow
- Inventory stock level tracking with low-stock alerts
- Auto-generated purchase request on stock-alert trigger
- Stock transactions log (receive, issue, adjust) with user and timestamp

### ❌ AST-003 — Asset Expiry & Maintenance Alerts
**Status:** Not Done  
**Outstanding:**
- Warranty expiry alerts at 60 days to Logistics Officer and IT Admin
- Scheduled maintenance alerts at 30 days before due date; maintenance completion recording
- Asset return alert 14 days before contract end / offboarding date
- Software licence expiry alerts with seat count and renewal cost tracking

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

### ⚠️ RPT-001 — Executive Workforce Dashboard
**Status:** Partial  
**Done:** Headcount by department/nationality/pass type (`/reports/headcount`), payroll cost summary per period (`/reports/payroll-summary`), leave utilisation rate (`/reports/leave-utilisation`), work-pass expiry dashboard (`/reports/work-pass-expiry`), leave liability value (`/reports/leave-liability`), IR8A data (`/reports/ir8a-data`).  
**Outstanding:**
- KPI widgets frontend dashboard (drag-and-drop configurable) not yet built
- Monthly new hires vs terminations, attrition rate (12-month rolling) widget missing
- OT hours by department trend, training completion rate widget missing
- PDF/PowerPoint export of dashboard missing
- Real-time data refresh (max 5-minute delay) not yet confirmed

### ⚠️ RPT-002 — Statutory Reports (Pre-Built)
**Status:** Partial  
**Done:** CPF contribution flat-file (`/cpf-file/:runId`), SDL amounts in payroll run data, IR8A annual data and IRAS-format file, leave-liability report, work-pass expiry report.  
**Outstanding:**
- FWL Report (per WP/S-Pass employee FWL amounts) separate report not yet built
- MOM Monthly Headcount Report in MOM-prescribed format not yet implemented
- Annual MOM Manpower Survey data export missing
- SDL monthly computation summary as standalone SSG submission report missing
- Submission history storage (dates, reference numbers, file copies, receipts) not yet tracked per report type

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

### ❌ SUP-004 — Self-Service FAQ
**Status:** Not Done  
**Outstanding:**
- Pre-loaded FAQ panel with common HR questions (leave application, payslip access, expense claim, personal details update, approval queries)
- HR Admin extensible FAQ management (add/edit/remove questions)
- FAQ panel visible before ticket submission to reduce ticket volume

---

## Outstanding Items Priority List

### Must Have (critical path)
_(all resolved)_

### Should Have (high value)
7. **TRN-003** — Government grant claims (SkillsFuture, ETS, Absentee Payroll — SSG compliance)
8. **AST-002** — Logistics requests & inventory management
9. **AST-003** — Asset expiry & maintenance alerts
10. **PMS-006** — 360-degree feedback
11. **SUP-004** — Self-service FAQ (reduces support ticket volume)
12. **RPT-002 (completion)** — FWL Report, MOM Manpower Survey, SDL summary report
13. **REC-005 (completion)** — Full auto-trigger on employee record approval

### Nice to Have
14. **CLM-004 (completion)** — GST analytics dashboard and vendor GST validation
15. **PAY-005 (completion)** — PDF payslip rendering, SLA enforcement
16. **LEA-005 (completion)** — Government-paid leave claim generation with MSF caps
17. **TAT-004 (completion)** — Anomaly detection automation and manager dashboard
18. **RPT-001 (completion)** — Drag-and-drop KPI dashboard frontend

---

_Document auto-maintained — update this file when a requirement moves to Done._
