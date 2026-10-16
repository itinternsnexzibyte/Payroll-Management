# Module status — core and advanced modules

Status of the module list (12 core, 8 advanced) against this repository, 16 Oct 2026.

## Core modules

| # | Module | Status | Where |
|---|---|---|---|
| 1 | Dashboard | ✅ Implemented — employees, payroll month and status, pending reviews, net pay trend, recent activity | `/` |
| 2 | Employee management | ✅ Implemented — ID, name, department, designation, joining/exit, status, **contact email and phone (added)**, import/export | Employees |
| 3 | Salary structure | ✅ Implemented — fixed, percentage, monthly-input and approved-formula components; versioned per employee | Salary components, employee Salary tab |
| 4 | Monthly payroll processing | ✅ Implemented — month, Excel-like inputs, server calculation, employee-wise results | Payroll runs |
| 5 | Attendance & leave inputs | ✅ **Added** — template download and CSV/XLSX import of any monthly input column (working days, attendance, unpaid leave…), plus fill from approved leave | Payroll run → Monthly inputs |
| 6 | Calculation engine | ✅ Implemented — formulas wait for the client workbook (`FORMULA` components stay blocked until coded) | — |
| 7 | Review & approval | ✅ Implemented — exceptions, alerts, reconciliation, submit, approve, finalise, re-open | Payroll run |
| 8 | Payslip generation | ✅ Implemented — stored PDFs, bulk print; layout provisional until the client format arrives | Payroll run → Payslips |
| 9 | Payroll reports | ✅ Implemented + **Monthly payroll register (added)**: every earning and deduction per employee with gross, deductions, net and totals; employee salary statement | Reports |
| 10 | Payroll history | ✅ Implemented — all months, finalised snapshots, employee payroll history | Payroll runs, employee page |
| 11 | Roles & permissions | ✅ Implemented — configurable permission sets; **Employee** role added for self-service | Roles & permissions |
| 12 | Audit trail | ✅ Implemented — append-only; every new module writes audit entries | Audit log |

## Advanced modules

| Module | Status | Notes |
|---|---|---|
| Leave management | ✅ **Added** | Leave types (paid/unpaid, yearly days), per-employee allowance overrides, requests within one month, overlap and allowance checks, approval by someone other than the person who entered it, balances, cancellation |
| Employee self-service | ✅ **Added** | `Employee` role; an Administrator links the account to an employee record in Users. The employee sees only their own payslips (finalised months), details and leave, and can request or cancel their own leave. All `/me/*` endpoints are scoped by the linked record |
| Statutory payroll (PF, ESI, TDS) | ✅ **Added — off until configured** | Configuration → Statutory deductions. No rates are built in: the payroll team enters rates, ceilings, limits and tax slabs, records who confirmed them, then switches each section on. PF, ESI and TDS are deducted for every employee with a salary structure; employer shares go to the Statutory deductions report. See [statutory-bank-attendance.md](statutory-bank-attendance.md) |
| Loan & salary advance | ✅ **Added** | One active loan/advance per employee with a monthly instalment. Instalments fill the mapped input; recovered and outstanding amounts are read from finalised payroll months |
| Bonus & incentives | ✅ **Added** | Amounts per employee and month, proposed and approved by different people; approved amounts fill the mapped inputs. Incentive *formulas* are the client's and are not calculated here |
| Email notifications | ✅ **Added** | Approvers on submission, finalisers on approval, employees when their payslip is available and when leave is decided. Each can be switched off; emails never contain amounts |
| Attendance integration | ✅ **File import + live sync added** | Attendance files import through the monthly input import. **Live sync:** the attendance application sends each month to `POST /integrations/attendance` with an API key; fields are mapped to input columns, reviewed and applied (or applied automatically) to Draft/Calculated payroll only |
| Bank salary export | ✅ **Added — needs `BANK_DATA_KEY`** | Payroll → Bank salary payments. Employee bank details stored encrypted (masked everywhere), configurable CSV/XLSX file layout, file for finalised payroll only, missing details listed, every file recorded. Set the layout to your bank's format before the first upload |

## How the modules reach payroll

Payroll settings → **Inputs from modules & email** maps four sources to numeric monthly input
columns: unpaid leave days, advance/loan recovery, bonus and incentive. On a payroll run (Draft or
Calculated), **Fill from leave, advances & bonuses** writes those amounts into the mapped columns
only, through the same validation as the grid, then the run is recalculated as usual. The salary
components that use those input columns decide how they affect pay.

## Permissions added

`leave.view`, `leave.manage`, `leave.approve`, `loans.manage`, `bonuses.manage`, `self.service`,
`bank.view`, `bank.manage`, `bank.export`, `integrations.manage` (bank and integration permissions
are given to Administrators only).
Administrators receive new permissions automatically. **Existing** roles are never changed
automatically: grant the new permissions to the Payroll User role in Roles & permissions if
wanted (new installations include `leave.view`, `leave.manage`, `loans.manage` and
`bonuses.manage` for Payroll User). Bonus approval uses the existing *Approve payroll* permission.

## Database

Migration `20261016150000_payroll_modules` (additive): employee contact columns, `users.employeeId`
(unique, one account per employee), `leave_types`, `leave_entitlements`, `leave_requests`,
`loans`, `bonus_entries`, with check constraints on dates, days, amounts and months.

Migration `20261016180000_statutory_bank_attendance` (additive): `employee_bank_accounts`
(encrypted account number), `bank_exports` (append-only), `integration_keys` (hashed),
`attendance_batches`.
