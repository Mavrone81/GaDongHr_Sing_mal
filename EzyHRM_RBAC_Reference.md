# EzyHRM RBAC Reference
**Version 2.1 — Updated May 2026**

---

## 1. Permission Codes

### AUTH Module
| Code | Name | Description |
|---|---|---|
| `user:manage` | Manage Users | Create, update, and deactivate user accounts |
| `role:manage` | Manage Roles | Create and customise roles and permissions |

### EMPLOYEE Module
| Code | Name | Description |
|---|---|---|
| `employee:view` | View Employees | View basic employee profiles |
| `employee:manage` | Manage Employees | Create and update employee records |
| `employee:sensitive` | View Sensitive Data | View salaries, bank details, and personal info |

### PAYROLL Module
| Code | Name | Description |
|---|---|---|
| `payroll:view` | View Payroll | View payroll records and history |
| `payroll:run` | Process Payroll | Run monthly payroll cycles |

### LEAVE Module
| Code | Name | Description |
|---|---|---|
| `leave:view` | View Leaves | View leave applications |
| `leave:approve` | Approve Leaves | Approve or reject leave requests |

### CLAIMS Module
| Code | Name | Description |
|---|---|---|
| `claims:view` | View Claims | View expense claims |
| `claims:approve` | Approve Claims | Approve or reject expense claims |

### ATTENDANCE Module
| Code | Name | Description |
|---|---|---|
| `attendance:view` | View Attendance | View clock-in/out records |
| `attendance:manage` | Manage Attendance | Manage employee shifts and overtime |
| `roster:view` | View Roster | View daily roster and shift schedules |
| `roster:manage` | Manage Roster | Create and edit shift schedules for team members via the weekly shift scheduler |

### RECRUITMENT Module
| Code | Name | Description |
|---|---|---|
| `recruitment:manage` | Manage Recruitment | Manage job postings, candidate pool, ATS pipeline, and resume uploads |

### REPORTING Module
| Code | Name | Description |
|---|---|---|
| `report:view` | View Reports | Access standard system reports |
| `report:financial` | View Financial Reports | Access payroll summary and CPF reports |

---

## 2. System Roles

### SUPER_ADMIN
> Full system access. All permissions granted.

All 18 permissions above.

---

### ADMIN
> General administrative access.

`employee:view` · `employee:manage` · `leave:view` · `leave:approve` · `attendance:view` · `claims:view` · `report:view` · `roster:view` · `roster:manage`

---

### HR_ADMIN
> Full HR management access.

`employee:view` · `employee:manage` · `employee:sensitive` · `leave:view` · `leave:approve` · `attendance:view` · `attendance:manage` · `roster:view` · `roster:manage` · `report:view`

---

### HR_MANAGER
> HR operations management with claims oversight and scheduling.

`employee:view` · `employee:manage` · `leave:view` · `leave:approve` · `attendance:view` · `attendance:manage` · `roster:view` · `roster:manage` · `claims:view` · `claims:approve` · `report:view`

---

### PAYROLL_OFFICER
> Payroll processing and financial reporting.

`employee:view` · `employee:sensitive` · `payroll:view` · `payroll:run` · `attendance:view` · `roster:view` · `report:financial`

---

### LINE_MANAGER
> Team lead with scheduling, approval, and attendance view rights.

`employee:view` · `leave:view` · `leave:approve` · `claims:view` · `claims:approve` · `attendance:view` · `roster:view` · `roster:manage`

**Notes:**
- Has full access to the Shift Scheduler for their team
- Can view the Daily Roster tab (read-only overview)
- Cannot access Work Locations configuration (HR Admin only)
- Cannot access payroll, sensitive employee data, or system reports

---

### RECRUITER
> Recruitment and ATS access.

`employee:view` · `recruitment:manage`

**Notes:**
- Can manage all job postings, candidate pool, ATS pipeline stages, and resume files
- Cannot approve leave, run payroll, or access sensitive compensation data

---

### EMPLOYEE
> Standard employee self-service access.

`employee:view` · `leave:view` · `claims:view` · `attendance:view`

---

## 3. Role × Permission Matrix

| Permission | SUPER_ADMIN | ADMIN | HR_ADMIN | HR_MANAGER | PAYROLL_OFFICER | LINE_MANAGER | RECRUITER | EMPLOYEE |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| user:manage | ✓ | | | | | | | |
| role:manage | ✓ | | | | | | | |
| employee:view | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| employee:manage | ✓ | ✓ | ✓ | ✓ | | | | |
| employee:sensitive | ✓ | | ✓ | | ✓ | | | |
| payroll:view | ✓ | | | | ✓ | | | |
| payroll:run | ✓ | | | | ✓ | | | |
| leave:view | ✓ | ✓ | ✓ | ✓ | | ✓ | | ✓ |
| leave:approve | ✓ | ✓ | ✓ | ✓ | | ✓ | | |
| claims:view | ✓ | ✓ | | ✓ | | ✓ | | ✓ |
| claims:approve | ✓ | | | ✓ | | ✓ | | |
| attendance:view | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | ✓ |
| attendance:manage | ✓ | | ✓ | ✓ | | | | |
| roster:view | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | |
| roster:manage | ✓ | ✓ | ✓ | ✓ | | ✓ | | |
| recruitment:manage | ✓ | | | | | | ✓ | |
| report:view | ✓ | ✓ | ✓ | ✓ | | | | |
| report:financial | ✓ | | | | ✓ | | | |

---

## 4. Module Access Summary

| Module / Page | SUPER_ADMIN | ADMIN | HR_ADMIN | HR_MANAGER | PAYROLL_OFFICER | LINE_MANAGER | RECRUITER | EMPLOYEE |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Employees | ✓ | ✓ | ✓ | ✓ | View | View | View | Own only |
| Payroll | ✓ | | | | ✓ | | | |
| Leave | ✓ | ✓ | ✓ | ✓ | | ✓ | | Own only |
| Claims | ✓ | View | | ✓ | | ✓ | | Own only |
| Attendance Records | ✓ | ✓ | ✓ | ✓ | View | View | | Own only |
| **Shift Scheduler** | ✓ | ✓ | ✓ | ✓ | | **✓** | | |
| **Daily Roster** | ✓ | ✓ | ✓ | ✓ | View | **View** | | |
| Work Locations | ✓ | | ✓ | ✓ | | | | |
| Recruitment / ATS | ✓ | | | | | | ✓ | |
| **Candidate Pool** | ✓ | | | | | | **✓** | |
| Reports | ✓ | ✓ | ✓ | ✓ | Financial | | | |
| Settings | ✓ | | | | | | | |

---

## 5. Attendance / Roster Tab Visibility

The `/attendance/registry` page enforces role-based tab visibility:

| Tab | SUPER_ADMIN | HR_ADMIN | HR_MANAGER | PAYROLL_OFFICER | LINE_MANAGER |
|---|:---:|:---:|:---:|:---:|:---:|
| Daily Roster | ✓ | ✓ | ✓ | ✓ | View only |
| Shift Scheduler | ✓ | ✓ | ✓ | | ✓ |
| Work Locations | ✓ | ✓ | ✓ | | |

Line Managers land on the Shift Scheduler tab by default and cannot access Work Locations configuration.

---

## 6. Recruitment Module Tabs

| Tab | HR_ADMIN | HR_MANAGER | RECRUITER |
|---|:---:|:---:|:---:|
| Job Openings | ✓ | ✓ | ✓ |
| Candidate Pool | ✓ | ✓ | ✓ |
| Pipeline | ✓ | ✓ | ✓ |
| Interviews | ✓ | ✓ | ✓ |

---

## 7. Revision History

| Version | Date | Changes |
|---|---|---|
| 1.0 | Mar 2025 | Initial RBAC matrix |
| 2.0 | Apr 2026 | Added HR_MANAGER, LINE_MANAGER, RECRUITER system roles; added `roster:view`, `roster:manage` permissions; added `claims:approve` to LINE_MANAGER |
| 2.1 | May 2026 | Updated Recruiter scope to include Candidate Pool, ATS lifecycle tracking, and resume management; updated LINE_MANAGER to include Shift Scheduler access and tab visibility rules |
