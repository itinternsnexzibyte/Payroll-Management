# Module status — core and advanced modules

Status of the module list (12 core, 10 advanced) against this repository, 24 Oct 2026.

## Core modules

| # | Module | Status | Where |
|---|---|---|---|
| 1 | Dashboard | ✅ Implemented — employees, payroll month and status, pending reviews, net pay trend, recent activity | `/` |
| 2 | Employee management | ✅ Implemented — ID, name, department, designation, joining/exit, status, **contact email and phone (added)**, import/export | Employees |
| 3 | Salary structure | ✅ Implemented — fixed, percentage, monthly-input and approved-formula components; versioned per employee | Salary components, employee Salary tab |
| 4 | Monthly payroll processing | ✅ Implemented — month, Excel-like inputs, server calculation, employee-wise results | Payroll runs |
| 5 | Attendance & leave inputs | ✅ **Added** — admin daily attendance register; template download and CSV/XLSX import of any monthly input column (working days, attendance, unpaid leave…), plus fill from approved leave | Attendance records; Payroll run → Monthly inputs |
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
| Attendance integration | ✅ **Daily register + file import added** | The source attendance app's admin daily-register workflow is adapted to Payroll's own employees, permissions, audit log, and database. It does not import the source app's separate MySQL/auth stack or GPS/session tracking. Daily records do not alter payroll inputs automatically. Attendance files import through the monthly input import. **Attendance to payroll** writes a month's totals into the input columns chosen on that page (Draft/Calculated payroll only). The live sync API from the attendance application was removed |
| Workforce assignments | ✅ **Added** | Assignments link to canonical employee UUIDs; employees submit text or HTTPS links, managers can review submissions, and requested changes retain revision history. Access uses dedicated Workforce permissions and audit records. No source submissions/files are imported; no payroll inputs are changed |
| Calendar & in-app notifications | ✅ **Added** | Shared or employee-specific events, date/time/color, scoped employee views, personal events employees add for themselves, and read/unread notifications for calendar and assignment updates. Notifications are tied to Payroll employee UUIDs; no HR source records are imported |
| Bank salary export | ✅ **Added** | Payroll → Bank salary payments. Employee bank details stored encrypted (masked everywhere) with `BANK_DATA_KEY` or a server-generated key on the storage disk; employees can add their own under My account, configurable CSV/XLSX file layout, file for finalised payroll only, missing details listed, every file recorded. Set the layout to your bank's format before the first upload |

## Organisation, payslip, Form 16 and payroll intelligence (26 Oct 2026)

| Module | Where | Notes |
|---|---|---|
| Automatic salary structures | Payroll settings → Salary structure; employee Salary tab | A salary version is generated from one monthly gross (or annual CTC ÷ 12) by the template, e.g. Basic 50% of gross, HRA 40% of Basic, PT ₹200, Special allowance = balance. The gross is stored on the version. Bulk regeneration: `POST /salary-template/apply` |
| Run payroll automatically | Payroll runs → **Run payroll automatically** | Creates (or reuses) the month's run, applies the attendance register and the leave / advance / bonus mappings, and calculates. Review, approval and finalisation stay manual |
| PF / ESI wage band | Statutory deductions | Gross (ESI wage components) at or below the threshold (default ₹20,000): ESI and no PF. Above it: PF and no ESI. **Apply standard PF & ESI** fills EPF 12% + 12% (ceiling ₹15,000) and ESI 0.75% + 3.25%, records the confirming user and converts a plain "12% of basic" PF component to the statutory formula. Settings saved before the band existed keep it off |
| Proration and gratuity | Payroll settings → Salary structure | Proration (off by default) pays fixed earnings for days payable = days employed − loss-of-pay days (the input mapped to unpaid leave). Gratuity (default 4.81% of Basic) is an employer cost, never deducted |
| Branded payslip | Payroll settings → Payslip branding | Company name, address, logo and colours; employee number, joining date, manager, bank, IFSC, masked account, UAN, PF number, PAN; pay days; Earnings (A), Contributions (B: employee PF / ESI), Taxes & deductions (C); net in figures and words; employer PF / ESI / gratuity. Payslips already stored for finalised months are not regenerated |
| Organisation structure | People → Organisation structure; employee form "Reports to" | `employees.managerId`; loops and self-management are refused (`PUT /employees/:id/manager`) |
| Form 16 | Payroll → Form 16; My account → My Form 16 | From finalised payroll only, per financial year (April–March), new or old regime: Part A quarterly TDS, Part B salary and tax computation, month-wise table, PDF. The TRACES-issued Part A remains authoritative |
| Payroll digital twin | Payroll → Digital twin | Increments (all / by department), new hires (split by the template), bonus, overtime, closing departments and headcount reduction, simulated in memory with the real engine; baseline vs scenario, department and employee changes, projection, saved scenarios compared side by side (`payroll_scenarios`) |
| Calculation explainer | Payroll → Calculation explainer; payroll run → employee → "Explain" | Every line traced to its salary version value, rate and base, monthly input (who entered it), proration and statutory working, plus rounding; a fresh recalculation confirms the stored result (MATCH / DIFFERENT); audit-logged |
| Fraud investigation | Payroll → Fraud investigation | Shared bank accounts (full numbers compared when the bank key is configured), bank details changed shortly before payroll, large salary revisions before payroll, the same person changing salary and calculating/approving, pay after exit, duplicate PAN / UAN / email / phone, net pay spikes against the employee's history, repeated bank files, self-approved bonuses — each with evidence and an employee timeline |
| Policy testing lab | Configuration → Policy testing lab | Proposed PF / ESI rates and band, structure template, component rates, proration, gratuity and overtime tested against a past month or synthetic employees; per-employee before/after, flags and distribution. Nothing is saved |
| Readiness monitor | Payroll → Readiness monitor; dashboard card | Salary structures, template, bank details, PAN / UAN, attendance, pending leave and bonuses, statutory settings, run status, exceptions, stale calculations, alerts and approvals for the month that needs payroll next; refreshes every minute |

Migration `20261026200000_org_payslip_insights` (additive): `employees.managerId` (no self-reference),
`panNumber`, `uanNumber`, `pfNumber`; `employee_salary_versions.monthlyGross`;
`payroll_run_employees.calcSummary`; `payroll_scenarios`. No new permissions: the tools use
`payroll.view_amounts`, `reports.view`, `employees.view` / `employees.manage`, `settings.manage`
and `payroll.view`.

## How the modules reach payroll

Payroll settings → **Inputs from modules & email** maps four sources to numeric monthly input
columns: unpaid leave days, advance/loan recovery, bonus and incentive. On a payroll run (Draft or
Calculated), **Fill from leave, advances & bonuses** writes those amounts into the mapped columns
only, through the same validation as the grid, then the run is recalculated as usual. The salary
components that use those input columns decide how they affect pay.

## Permissions added

`leave.view`, `leave.manage`, `leave.approve`, `loans.manage`, `bonuses.manage`, `self.service`,
`bank.view`, `bank.manage`, `bank.export`, `workforce.view`,
`workforce.manage`, `workforce.submit`, `workforce.review`, `calendar.view`, `calendar.manage`,
`notifications.view` (bank, Workforce management/review, and calendar management
permissions are granted deliberately).
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

Migration `20261024120000_workforce_assignments` (additive): `work_assignments`,
`work_submissions`, and submission status enums. Migration `20261024130000_calendar_notifications`
(additive): `calendar_events` and `employee_notifications`. Only the Administrator role receives
new management permissions automatically. New installations give the Employee role
`workforce.submit`, `calendar.view`, and `notifications.view`; existing roles are unchanged and
require an Administrator to grant permissions.
See [HR integration architecture](INTEGRATION_ARCHITECTURE.md).
