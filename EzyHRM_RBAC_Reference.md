# EzyHRM RBAC Reference
**Version 3.1 — Updated May 2026**

> This document mirrors the actual permission set seeded by
> `services/auth-service/scripts/seed-rbac.js` and the `ROLES` enum in
> `shared/auth-middleware/index.js`. See §8 *Known Divergences* for places
> where the running app still gates access by role check instead of by
> permission code.

---

## 1. Permission Codes

### AUTH Module
| Code | Name | Description |
|---|---|---|
| `user:manage` | Manage Users | Create, update, and deactivate user accounts |
| `role:manage` | Manage Roles | Create and customise roles and permissions |
| `settings:manage` | Manage Settings | Configure org settings, SSO, MFA policy, and data purge |

### EMPLOYEE Module
| Code | Name | Description |
|---|---|---|
| `employee:view` | View Employees | View basic employee profiles and org chart |
| `employee:manage` | Manage Employees | Create, update, and terminate employee records |
| `employee:sensitive` | View Sensitive Data | View salaries, bank details, NRIC, and payroll data |
| `document:manage` | Manage Documents | Upload and delete employee documents and contracts |

### PAYROLL Module
| Code | Name | Description |
|---|---|---|
| `payroll:view` | View Payroll | View payroll runs, payslips, and history |
| `payroll:run` | Process Payroll | Run, compute, approve, and finalise payroll cycles |

### LEAVE Module
| Code | Name | Description |
|---|---|---|
| `leave:view` | View Leaves | View team and organisation leave applications |
| `leave:approve` | Approve Leaves | Approve or reject leave requests |

### CLAIMS Module
| Code | Name | Description |
|---|---|---|
| `claims:view` | View Claims | View expense claim submissions |
| `claims:approve` | Approve Claims | Approve or reject expense claims |

### ATTENDANCE Module
| Code | Name | Description |
|---|---|---|
| `attendance:view` | View Attendance | View clock-in/out records and overtime |
| `attendance:manage` | Manage Attendance | Correct attendance records and manage work locations |
| `roster:view` | View Roster | View shift schedules and project assignments |
| `roster:manage` | Manage Roster | Create and edit shifts, patterns, and rosters |

### RECRUITMENT Module
| Code | Name | Description |
|---|---|---|
| `recruitment:view` | View Recruitment | View job postings and candidate pipeline |
| `recruitment:manage` | Manage Recruitment | Post jobs, manage candidates, interviews, and onboard |

### ASSET Module
| Code | Name | Description |
|---|---|---|
| `asset:view` | View Assets | View asset inventory and assignment history |
| `asset:manage` | Manage Assets | Create assets and manage assignments and returns |

### OFFBOARDING Module
| Code | Name | Description |
|---|---|---|
| `offboarding:manage` | Manage Offboarding | Initiate offboarding, manage checklists, and trigger IR21 |

### REPORTING Module
| Code | Name | Description |
|---|---|---|
| `report:view` | View Reports | Access headcount, leave utilisation, and operational reports |
| `report:financial` | View Financial Reports | Access payroll summary, CPF submission, and bank GIRO files |

**Total: 24 permissions across 9 modules.**

---

## 2. System Roles

### SUPER_ADMIN
> Full system access — all modules and settings.

All 24 permissions.

---

### ADMIN
> General administrative access for HR-adjacent staff who don't need full HR data.

`employee:view` · `employee:manage` · `leave:view` · `leave:approve` · `attendance:view` · `claims:view` · `report:view` · `roster:view` · `roster:manage`

---

### IT_ADMIN
> User management, system settings, SSO, MFA, and IT asset oversight.

`user:manage` · `role:manage` · `settings:manage` · `employee:view` · `asset:view` · `asset:manage` · `report:view`

**Notes:**
- IT_ADMIN is the only non-SUPER_ADMIN role with `user:manage`, `role:manage`, and `settings:manage`
- Cannot approve leave, claims, or access payroll/sensitive employee data

---

### HR_ADMIN
> Full HR operations — employees, leave, claims, recruitment, offboarding, attendance, and financial reports (excluding payroll processing).

`employee:view` · `employee:manage` · `employee:sensitive` · `document:manage` · `leave:view` · `leave:approve` · `payroll:view` · `claims:view` · `claims:approve` · `attendance:view` · `attendance:manage` · `roster:view` · `roster:manage` · `recruitment:view` · `recruitment:manage` · `asset:view` · `offboarding:manage` · `report:view` · `report:financial`

---

### HR_MANAGER
> HR operations management — no payroll, no sensitive data.

`employee:view` · `employee:manage` · `document:manage` · `leave:view` · `leave:approve` · `claims:view` · `claims:approve` · `attendance:view` · `attendance:manage` · `roster:view` · `roster:manage` · `recruitment:view` · `recruitment:manage` · `asset:view` · `report:view`

---

### PAYROLL_OFFICER
> Full payroll cycle, CPF, bank GIRO, and employee financial data.

`employee:view` · `employee:sensitive` · `payroll:view` · `payroll:run` · `attendance:view` · `roster:view` · `report:view` · `report:financial`

---

### FINANCE_ADMIN
> Claims approval, payroll visibility, and financial reporting.

`employee:view` · `claims:view` · `claims:approve` · `payroll:view` · `asset:view` · `report:view` · `report:financial`

---

### LINE_MANAGER
> Team lead — approve leave and claims, manage roster for direct reports.

`employee:view` · `leave:view` · `leave:approve` · `claims:view` · `claims:approve` · `attendance:view` · `roster:view` · `roster:manage` · `asset:view`

**Notes:**
- Full access to the Shift Scheduler for their team
- Read-only view of the Daily Roster overview
- Cannot access Work Locations configuration (HR Admin only)
- Cannot access payroll, sensitive employee data, or system reports

---

### RECRUITER
> End-to-end recruitment — job postings, candidates, interviews, and onboarding.

`employee:view` · `recruitment:view` · `recruitment:manage`

**Notes:**
- Full ATS lifecycle: job postings, candidate pool, interview pipeline, resume management
- Cannot approve leave, run payroll, or access sensitive compensation data

---

### EMPLOYEE
> Standard employee self-service.

`employee:view` · `leave:view` · `claims:view` · `attendance:view` · `asset:view`

---

### TRAINING_MANAGER
> Training oversight role.

`employee:view` · `report:view`

**Notes:**
- Seeded with a minimal permission set so the role is usable.
- The Training module itself is still role-gated (no `training:*` permission codes exist yet) — see §8.1.

---

## 3. Role × Permission Matrix

| Permission | SUPER_ADMIN | ADMIN | IT_ADMIN | HR_ADMIN | HR_MANAGER | PAYROLL_OFFICER | FINANCE_ADMIN | LINE_MANAGER | RECRUITER | TRAINING_MANAGER | EMPLOYEE |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| user:manage          | ✓ |   | ✓ |   |   |   |   |   |   |   |   |
| role:manage          | ✓ |   | ✓ |   |   |   |   |   |   |   |   |
| settings:manage      | ✓ |   | ✓ |   |   |   |   |   |   |   |   |
| employee:view        | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| employee:manage      | ✓ | ✓ |   | ✓ | ✓ |   |   |   |   |   |   |
| employee:sensitive   | ✓ |   |   | ✓ |   | ✓ |   |   |   |   |   |
| document:manage      | ✓ |   |   | ✓ | ✓ |   |   |   |   |   |   |
| payroll:view         | ✓ |   |   | ✓ |   | ✓ | ✓ |   |   |   |   |
| payroll:run          | ✓ |   |   |   |   | ✓ |   |   |   |   |   |
| leave:view           | ✓ | ✓ |   | ✓ | ✓ |   |   | ✓ |   |   | ✓ |
| leave:approve        | ✓ | ✓ |   | ✓ | ✓ |   |   | ✓ |   |   |   |
| claims:view          | ✓ | ✓ |   | ✓ | ✓ |   | ✓ | ✓ |   |   | ✓ |
| claims:approve       | ✓ |   |   | ✓ | ✓ |   | ✓ | ✓ |   |   |   |
| attendance:view      | ✓ | ✓ |   | ✓ | ✓ | ✓ |   | ✓ |   |   | ✓ |
| attendance:manage    | ✓ |   |   | ✓ | ✓ |   |   |   |   |   |   |
| roster:view          | ✓ | ✓ |   | ✓ | ✓ | ✓ |   | ✓ |   |   |   |
| roster:manage        | ✓ | ✓ |   | ✓ | ✓ |   |   | ✓ |   |   |   |
| recruitment:view     | ✓ |   |   | ✓ | ✓ |   |   |   | ✓ |   |   |
| recruitment:manage   | ✓ |   |   | ✓ | ✓ |   |   |   | ✓ |   |   |
| asset:view           | ✓ |   | ✓ | ✓ | ✓ |   | ✓ | ✓ |   |   | ✓ |
| asset:manage         | ✓ |   | ✓ |   |   |   |   |   |   |   |   |
| offboarding:manage   | ✓ |   |   | ✓ |   |   |   |   |   |   |   |
| report:view          | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |   |   | ✓ |   |
| report:financial     | ✓ |   |   | ✓ |   | ✓ | ✓ |   |   |   |   |

---

## 4. Module Access Summary

| Module / Page | SUPER_ADMIN | ADMIN | IT_ADMIN | HR_ADMIN | HR_MANAGER | PAYROLL_OFFICER | FINANCE_ADMIN | LINE_MANAGER | RECRUITER | EMPLOYEE |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Employees             | ✓ | ✓ | View | ✓ | ✓ | View | View | View | View | Own only |
| Payroll               | ✓ |   |   | View¹ |   | ✓ | View |   |   |   |
| Leave                 | ✓ | ✓ |   | ✓ | ✓ |   |   | ✓ |   | Own only |
| Claims                | ✓ | View |   | ✓ | ✓ |   | ✓ | ✓ |   | Own only |
| Attendance Records    | ✓ | ✓ |   | ✓ | ✓ | View |   | View |   | Own only |
| Shift Scheduler       | ✓ | ✓ |   | ✓ | ✓ |   |   | ✓ |   |   |
| Daily Roster          | ✓ | ✓ |   | ✓ | ✓ | View |   | View |   |   |
| Work Locations        | ✓ |   |   | ✓ | ✓ |   |   |   |   |   |
| Recruitment / ATS     | ✓ |   |   | ✓ | ✓ |   |   |   | ✓ |   |
| Assets                | ✓ |   | ✓ | View | View |   | View | View |   | View |
| Offboarding           | ✓ |   |   | ✓ |   |   |   |   |   |   |
| Reports               | ✓ | ✓ | ✓ | ✓ | ✓ | Financial | Financial |   |   |   |
| Settings              | ✓ |   | ✓ |   |   |   |   |   |   |   |

¹ HR_ADMIN holds `payroll:view` only — see §8 *Known Divergences* regarding sidebar exposure.

---

## 5. Attendance / Roster Tab Visibility

The `/attendance/registry` page enforces role-based tab visibility:

| Tab | SUPER_ADMIN | HR_ADMIN | HR_MANAGER | PAYROLL_OFFICER | LINE_MANAGER |
|---|:---:|:---:|:---:|:---:|:---:|
| Daily Roster      | ✓ | ✓ | ✓ | ✓ | View only |
| Shift Scheduler   | ✓ | ✓ | ✓ |   | ✓ |
| Work Locations    | ✓ | ✓ | ✓ |   |   |

Line Managers land on the Shift Scheduler tab by default and cannot access Work Locations configuration.

---

## 6. Recruitment Module Tabs

| Tab | HR_ADMIN | HR_MANAGER | RECRUITER |
|---|:---:|:---:|:---:|
| Job Openings    | ✓ | ✓ | ✓ |
| Candidate Pool  | ✓ | ✓ | ✓ |
| Pipeline        | ✓ | ✓ | ✓ |
| Interviews      | ✓ | ✓ | ✓ |

---

## 7. Backend Role Enum

The authoritative role identifiers live in `shared/auth-middleware/index.js`:

```
SUPER_ADMIN · ADMIN · IT_ADMIN · HR_ADMIN · HR_MANAGER ·
PAYROLL_OFFICER · FINANCE_ADMIN · LINE_MANAGER · RECRUITER ·
TRAINING_MANAGER · EMPLOYEE
```

JWTs carry the role string in their payload; backend routes use
`authorize(ROLES.X, ROLES.Y, …)` to gate access. Permission-code checks
(`hasPermission('leave:approve')`) read from the DB-seeded role→permission
mapping defined in `seed-rbac.js`.

---

## 8. Known Divergences

The implementation has grown ahead of (or sideways from) the permission
catalogue. These are tracked here so the doc remains an honest record
rather than an aspirational policy.

### 8.1 Modules without permission codes
The following modules ship UI and routes but are gated by **role check
only** — there is no corresponding `*:view` / `*:manage` permission code:
- **Performance** (`/performance`)
- **Training** (`/training`)
- **Support** (`/support`, `/support/admin`)

If these modules need finer-grained delegation in future, permission codes
(e.g. `training:manage`, `performance:view`) should be added to
`seed-rbac.js` and the corresponding service routes converted to use
`authorize` + permission checks.

### 8.2 Sidebar vs permission scope mismatches
- **HR_ADMIN — Payroll module:** sidebar exposes the full Payroll module
  including processing actions, but HR_ADMIN only holds `payroll:view`. The
  backend route still blocks `payroll:run` correctly, so the inconsistency
  is cosmetic (UI link visible, server-side enforcement intact). Either
  hide the run actions in the UI for HR_ADMIN or grant `payroll:run` to
  match.

### 8.3 Frontend role-name normalisation (resolved in v3.1)
Earlier revisions of `AuthContext` silently promoted any user with role
`ADMIN` to `SUPER_ADMIN` on the frontend, contradicting this doc's
scoped ADMIN definition. Fixed: only `SUPER_ADMIN` (and the literal
system-admin emails) are now elevated.

---

## 9. Revision History

| Version | Date | Changes |
|---|---|---|
| 1.0 | Mar 2025 | Initial RBAC matrix |
| 2.0 | Apr 2026 | Added HR_MANAGER, LINE_MANAGER, RECRUITER system roles; added `roster:view`, `roster:manage` permissions; added `claims:approve` to LINE_MANAGER |
| 2.1 | May 2026 | Updated Recruiter scope to include Candidate Pool, ATS lifecycle tracking, and resume management; updated LINE_MANAGER to include Shift Scheduler access and tab visibility rules |
| 3.0 | May 2026 | Rewrite to mirror `seed-rbac.js`. Added 6 missing permissions (`settings:manage`, `document:manage`, `recruitment:view`, `asset:view`, `asset:manage`, `offboarding:manage`). Added IT_ADMIN, FINANCE_ADMIN role rows and TRAINING_MANAGER note. Recorded ADMIN as a seeded role (added to backend in this revision). Expanded HR_ADMIN, HR_MANAGER, RECRUITER, EMPLOYEE, LINE_MANAGER, PAYROLL_OFFICER permission sets to match seed. Added §8 Known Divergences. |
| 3.1 | May 2026 | Closed the four user-management divergences: TRAINING_MANAGER now seeded with `employee:view` + `report:view`; sidebar nav defined for ADMIN / IT_ADMIN / FINANCE_ADMIN / LINE_MANAGER / RECRUITER / TRAINING_MANAGER (was falling back to Employee nav); user-management role badge colours extended to cover all 10 seeded roles; AuthContext no longer silently promotes ADMIN to SUPER_ADMIN. |
