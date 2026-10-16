| Area | Method | Path | Purpose | Permission |
|---|---|---|---|---|
| Auth | `POST` | `/auth/login` | Sign in with email and password (sets an httpOnly session cookie) | public |
| Auth | `POST` | `/auth/logout` | Sign out and revoke the current session | signed in |
| Auth | `GET` | `/auth/me` | Current user, role and permissions | signed in |
| Auth | `POST` | `/auth/change-password` | Change own password (revokes other sessions) | signed in |
| Auth | `GET` | `/auth/signup/config` | Whether self-service sign-up is available | public |
| Auth | `POST` | `/auth/signup/start` | Step 1: send a 6-digit verification code to the email address | public |
| Auth | `POST` | `/auth/signup/verify` | Step 2: check the code; returns a short-lived sign-up token | public |
| Auth | `POST` | `/auth/signup/complete` | Step 3: set name and password and create the account (Payroll User, or an Administrator request awaiting approval) | public |
| Users & Roles | `GET` | `/users` | List users | users.manage |
| Users & Roles | `POST` | `/users` | Create a user with a temporary password (must be changed at first sign-in) | users.manage |
| Users & Roles | `PUT` | `/users/{id}` | Update a user (name, role, status) | users.manage |
| Users & Roles | `POST` | `/users/{id}/reset-password` | Set a temporary password, unlock the account and revoke sessions | users.manage |
| Users & Roles | `POST` | `/users/{id}/unlock` | Clear a sign-in lockout | users.manage |
| Users & Roles | `POST` | `/users/{id}/approve` | Approve a pending account request (activates it with its requested role) | users.manage |
| Users & Roles | `POST` | `/users/{id}/reject` | Reject a pending account request (the account is disabled, never deleted) | users.manage |
| Users & Roles | `GET` | `/roles` | List roles with permissions | users.manage |
| Users & Roles | `GET` | `/permissions` | Permission catalogue | users.manage |
| Users & Roles | `PUT` | `/roles/{id}/permissions` | Replace a role's permissions (applies the client's confirmed permission matrix) | users.manage |
| Audit | `GET` | `/audit-logs` | Search the audit log | audit.view |
| Masters | `GET` | `/departments` | List departments | employees.view, settings.manage |
| Masters | `POST` | `/departments` | Create a department | settings.manage, employees.manage |
| Masters | `PUT` | `/departments/{id}` | Rename or (de)activate a department | settings.manage, employees.manage |
| Masters | `GET` | `/designations` | List designations | employees.view, settings.manage |
| Masters | `POST` | `/designations` | Create a designation | settings.manage, employees.manage |
| Masters | `PUT` | `/designations/{id}` | Rename or (de)activate a designation | settings.manage, employees.manage |
| Masters | `GET` | `/payroll-input-definitions` | List monthly input definitions (columns of the payroll input grid) | payroll.view, settings.manage, salary.view |
| Masters | `POST` | `/payroll-input-definitions` | Create a monthly input definition | settings.manage |
| Masters | `PUT` | `/payroll-input-definitions/{id}` | Update a monthly input definition (the key cannot change) | settings.manage |
| Settings | `GET` | `/settings` | Payroll business settings and configuration status | payroll.view, settings.manage |
| Settings | `PUT` | `/settings` | Update payroll business settings (rounding, approval policy, version selection, warnings) | settings.manage |
| Employees | `GET` | `/employees` | List and search employees | employees.view |
| Employees | `POST` | `/employees` | Create an employee | employees.manage |
| Employees | `GET` | `/employees/export` | Export employees (current filters) as CSV or XLSX | employees.view |
| Employees | `GET` | `/employees/import/template` | Download a blank import template | employees.manage |
| Employees | `POST` | `/employees/import/preview` | Upload a CSV/XLSX file and preview validation results (nothing is saved yet) | employees.manage |
| Employees | `POST` | `/employees/import/{id}/validate` | Re-validate a previewed import with a different column mapping | employees.manage |
| Employees | `POST` | `/employees/import/{id}/commit` | Import all valid rows; invalid rows are kept in a downloadable error report | employees.manage |
| Employees | `GET` | `/import-jobs` | Recent import jobs | employees.manage |
| Employees | `GET` | `/import-jobs/{id}/errors` | Download failed rows with error messages (correct and re-import this file) | employees.manage |
| Employees | `GET` | `/employees/{id}` | Employee details | employees.view |
| Employees | `PUT` | `/employees/{id}` | Update an employee (Employee ID is fixed once used in payroll) | employees.manage |
| Employees | `POST` | `/employees/{id}/deactivate` | Deactivate or mark an employee as exited (records are never hard-deleted) | employees.manage |
| Employees | `POST` | `/employees/{id}/reactivate` | Reactivate an inactive employee | employees.manage |
| Salary | `GET` | `/salary-components` | List salary components | salary.view, payroll.view, settings.manage |
| Salary | `POST` | `/salary-components` | Create a salary component | salary.manage |
| Salary | `PUT` | `/salary-components/{id}` | Update a salary component (the code cannot change) | salary.manage |
| Salary | `GET` | `/employees/{id}/salary` | Employee's current (and any future-dated) salary version | salary.view |
| Salary | `POST` | `/employees/{id}/salary` | Create a new salary version effective from a date (earlier versions are kept, never overwritten) | salary.manage |
| Salary | `GET` | `/employees/{id}/salary-history` | All salary versions with change summaries | salary.view |
| Payroll Runs | `GET` | `/payroll-runs` | List payroll runs (history) | payroll.view |
| Payroll Runs | `POST` | `/payroll-runs` | Start a payroll run for a month (status Draft). One run per month. | payroll.input |
| Payroll Runs | `GET` | `/payroll-runs/eligible-employees` | Employees eligible for a payroll month (for selection when starting a run) | payroll.input |
| Payroll Runs | `GET` | `/payroll-runs/{id}` | Payroll run details: employees, results, exceptions, events and allowed actions | payroll.view |
| Payroll Runs | `PUT` | `/payroll-runs/{id}/employees` | Add or remove employees from a draft/calculated run | payroll.input |
| Payroll Runs | `GET` | `/payroll-runs/{id}/inputs` | Monthly input grid (columns = active input definitions) | payroll.view |
| Payroll Runs | `PUT` | `/payroll-runs/{id}/inputs` | Save monthly input cells (valid cells are saved even if others fail; errors are returned per cell) | payroll.input |
| Payroll Runs | `POST` | `/payroll-runs/{id}/calculate` | Calculate payroll on the server (deterministic; safe to repeat) | payroll.calculate |
| Payroll Runs | `POST` | `/payroll-runs/{id}/submit-review` | Submit calculated payroll for review | payroll.calculate |
| Payroll Runs | `POST` | `/payroll-runs/{id}/return` | Return a run under review / approved back to Calculated (reason required) | payroll.approve, payroll.finalise, payroll.calculate |
| Payroll Runs | `POST` | `/payroll-runs/{id}/approve` | Approve a payroll run under review | payroll.approve |
| Payroll Runs | `POST` | `/payroll-runs/{id}/finalise` | Finalise payroll — results become an immutable snapshot | payroll.finalise |
| Payroll Runs | `POST` | `/payroll-runs/{id}/reopen` | Re-open a finalised run (Administrator; reason required; audit-logged) | payroll.reopen |
| Payroll Runs | `GET` | `/payroll-runs/{id}/employees/{employeeId}` | One employee’s calculated lines in a run | payroll.view_amounts |
| Payroll Runs | `GET` | `/employees/{id}/payroll-history` | An employee's payroll results across runs | payroll.view |
| Payslips | `GET` | `/payroll-runs/{id}/payslips` | Payslip status per employee for a run | payslips.generate |
| Payslips | `GET` | `/payroll-runs/{id}/employees/{employeeId}/payslip` | Payslip PDF for one employee. Finalised runs: generated once, stored and re-served. Otherwise: watermarked preview. | payslips.generate |
| Payslips | `POST` | `/payroll-runs/{id}/payslips/generate` | Generate and store payslips for all employees of a finalised run | payslips.generate |
| Payslips | `GET` | `/payroll-runs/{id}/payslips/bulk` | All payslips of a run in one print-ready PDF (one employee per page) | payslips.generate |
| Reports | `GET` | `/reports/monthly-summary` | Monthly payroll summary: employee-wise gross, deductions and net with totals | reports.view |
| Reports | `GET` | `/reports/components` | Earnings report / deductions report: component-wise totals and per-employee breakdown | reports.view |
| Reports | `GET` | `/reports/payroll-register` | Monthly payroll register: every earning and deduction per employee, with gross, deductions, net and totals | reports.view |
| Reports | `GET` | `/reports/net-payable` | Net payable report for a run | reports.view |
| Reports | `GET` | `/reports/employee-statement` | Employee-wise salary statement (month by month) | reports.view |
| Dashboard | `GET` | `/dashboard` | Dashboard figures from live data (amounts only with permission) | signed in |
| Dashboard | `GET` | `/notifications` | Pending payroll actions for the current user | signed in |
| Payroll Alerts | `GET` | `/payroll-runs/{id}/anomalies` | Explainable anomaly alerts for one payroll run, with counts | payroll.view |
| Payroll Alerts | `POST` | `/payroll-runs/{id}/anomalies/scan` | Re-run the anomaly rules for a calculated run (idempotent; never changes payroll results) | payroll.calculate, payroll.approve |
| Payroll Alerts | `GET` | `/anomalies` | Alert history across payroll runs (search, filter, paginate) | payroll.view |
| Payroll Alerts | `GET` | `/anomalies/{id}` | One alert with its full review history | payroll.view |
| Payroll Alerts | `POST` | `/anomalies/{id}/review` | Mark an open alert as reviewed with an outcome and comment | payroll.calculate, payroll.approve |
| Payroll Alerts | `POST` | `/anomalies/{id}/reopen` | Re-open a reviewed alert (reason required) | payroll.calculate, payroll.approve |
| Reconciliation | `GET` | `/reconciliation` | Compare two calculated payroll months: employee-wise and component-wise differences with explanations | reports.view |
| Reconciliation | `GET` | `/reconciliation/export` | Download the reconciliation as PDF or XLSX (same filters as the screen) | reports.view |
| Reconciliation | `PUT` | `/reconciliation/notes` | Record or update the explanation for an employee (or one of their components) between two months | payroll.calculate, payroll.approve |
| Knowledge | `GET` | `/knowledge/articles` | Search knowledge articles (published only, unless you can edit the knowledge centre) | signed in |
| Knowledge | `POST` | `/knowledge/articles` | Create an article (version 1) | knowledge.manage |
| Knowledge | `GET` | `/knowledge/articles/{id}` | One article with its version history | signed in |
| Knowledge | `PUT` | `/knowledge/articles/{id}` | Save a new version of an article (optimistic concurrency on the version number) | knowledge.manage |
| Knowledge | `GET` | `/knowledge/articles/{id}/versions/{version}` | The text of an earlier version | signed in |
| Knowledge | `POST` | `/knowledge/articles/{id}/review` | Record that the article was reviewed and is still correct; optionally set the next review date | knowledge.manage |
| Knowledge | `POST` | `/knowledge/articles/{id}/archive` | Archive an article (kept with its history; hidden from search) | knowledge.manage |
| Knowledge | `POST` | `/knowledge/articles/{id}/restore` | Restore an archived article | knowledge.manage |
| Knowledge | `GET` | `/knowledge/owners` | Active users who can own documentation | knowledge.manage |
| Knowledge | `GET` | `/knowledge/coverage` | What is documented: components and validation errors without a published article, unconfirmed rules, overdue reviews | signed in |
| Knowledge | `GET` | `/knowledge/checklist-items` | The monthly payroll checklist template | signed in |
| Knowledge | `POST` | `/knowledge/checklist-items` | Add a checklist step | knowledge.manage |
| Knowledge | `PUT` | `/knowledge/checklist-items/{id}` | Edit, reorder or deactivate a checklist step | knowledge.manage |
| Knowledge | `GET` | `/payroll-runs/{id}/checklist` | Checklist progress for a payroll run | payroll.view |
| Knowledge | `PUT` | `/payroll-runs/{id}/checklist/{itemId}` | Tick or untick a checklist step for a run (process tracking only; never changes payroll) | payroll.input, payroll.calculate, payroll.approve, payroll.finalise |
| Payroll Runs | `GET` | `/payroll-runs/{id}/inputs/template` | Download an XLSX template of this run’s employees and input columns (with current values) | payroll.input |
| Payroll Runs | `POST` | `/payroll-runs/{id}/inputs/import` | Import monthly inputs (attendance, leave, working days…) from CSV/XLSX: an Employee ID column plus input columns | payroll.input |
| Payroll Runs | `POST` | `/payroll-runs/{id}/inputs/fill` | Fill the mapped input columns from approved leave, active advances and approved bonuses (overwrites those columns only) | payroll.input |
| Leave | `GET` | `/leave/types` | Leave types | leave.view, leave.manage, leave.approve, self.service |
| Leave | `POST` | `/leave/types` | Create a leave type | leave.manage |
| Leave | `PUT` | `/leave/types/{id}` | Edit or deactivate a leave type (the code cannot change) | leave.manage |
| Leave | `PUT` | `/leave/entitlements` | Set an employee's yearly allowance for a leave type (overrides the type default) | leave.manage |
| Leave | `GET` | `/leave/balances` | Leave balances per employee and type for a year | leave.view, leave.manage, leave.approve |
| Leave | `GET` | `/leave/requests` | Leave requests (filter by status, employee, month) | leave.view, leave.manage, leave.approve |
| Leave | `POST` | `/leave/requests` | Record a leave request for an employee (one calendar month at most) | leave.manage |
| Leave | `POST` | `/leave/requests/{id}/approve` | Approve a leave request | leave.approve |
| Leave | `POST` | `/leave/requests/{id}/reject` | Reject a leave request (note required) | leave.approve |
| Leave | `POST` | `/leave/requests/{id}/cancel` | Cancel a pending request (Leave managers), or an approved one (Leave approvers) | leave.manage, leave.approve |
| Loans & Advances | `GET` | `/loans` | Loans and salary advances with recovered and outstanding amounts | loans.manage |
| Loans & Advances | `POST` | `/loans` | Record a loan or salary advance with a monthly instalment | loans.manage |
| Loans & Advances | `POST` | `/loans/{id}/close` | Close a loan (repaid or settled outside payroll) or cancel one entered by mistake | loans.manage |
| Bonuses & Incentives | `GET` | `/bonuses` | Bonuses and incentives for a payroll month | bonuses.manage, payroll.approve |
| Bonuses & Incentives | `POST` | `/bonuses` | Propose a bonus or incentive for an employee and payroll month | bonuses.manage |
| Bonuses & Incentives | `POST` | `/bonuses/{id}/approve` | Approve a proposed bonus or incentive (not your own proposal) | payroll.approve |
| Bonuses & Incentives | `POST` | `/bonuses/{id}/reject` | Reject a proposed bonus or incentive | payroll.approve |
| Self-service | `GET` | `/me/employee` | My employee details | self.service |
| Self-service | `GET` | `/me/payslips` | My issued payslips (finalised months only) | self.service |
| Self-service | `GET` | `/me/payslips/{id}` | Download one of my payslips (PDF) | self.service |
| Self-service | `GET` | `/me/leave` | My leave requests and balances | self.service |
| Self-service | `POST` | `/me/leave` | Request leave for myself | self.service |
| Self-service | `POST` | `/me/leave/{id}/cancel` | Cancel one of my pending leave requests | self.service |
| Statutory | `GET` | `/statutory` | Statutory settings (PF, ESI, TDS), completeness problems and the components that use them | settings.manage, payroll.view |
| Statutory | `PUT` | `/statutory` | Save the statutory settings; a section can be switched on only when complete and confirmed | settings.manage |
| Statutory | `POST` | `/statutory/components` | Create the deduction component for PF, ESI or TDS (if it does not exist yet) | settings.manage |
| Reports | `GET` | `/reports/statutory` | PF, ESI and TDS for a payroll month: wages, employee and employer contributions | reports.view |
| Bank | `GET` | `/bank/accounts` | Bank details of all employees (account numbers masked) | bank.view, bank.manage |
| Bank | `GET` | `/employees/{id}/bank` | An employee's bank details (account number masked) | bank.view, bank.manage |
| Bank | `PUT` | `/employees/{id}/bank` | Add or replace an employee's bank details (account number stored encrypted) | bank.manage |
| Bank | `DELETE` | `/employees/{id}/bank` | Remove an employee's bank details | bank.manage |
| Bank | `GET` | `/bank/layout` | Bank salary file layout | bank.export, settings.manage |
| Bank | `PUT` | `/bank/layout` | Change the bank salary file layout (columns, format, date format) | settings.manage |
| Bank | `GET` | `/payroll-runs/{id}/bank-export/preview` | Who will be in the bank salary file, who is missing bank details, and previous files | bank.export |
| Bank | `GET` | `/payroll-runs/{id}/bank-export` | Download the bank salary file for a finalised payroll (net pay per employee) | bank.export |
| Integrations | `POST` | `/integrations/attendance` | Receive monthly attendance from the attendance application (API key: Authorization: Bearer nzatt_…) | API key |
| Integrations | `GET` | `/attendance-sync` | Attendance sync settings, API keys and recent batches | integrations.manage |
| Integrations | `PUT` | `/attendance-sync/settings` | Switch attendance sync on/off, choose auto-apply and map attendance fields to input columns | integrations.manage |
| Integrations | `POST` | `/attendance-sync/keys` | Create an API key for the attendance application (the key is shown only once) | integrations.manage |
| Integrations | `POST` | `/attendance-sync/keys/{id}/revoke` | Revoke an attendance API key | integrations.manage |
| Integrations | `GET` | `/attendance-sync/batches/{id}` | A received batch with a preview of the values it writes (nothing is changed) | integrations.manage |
| Integrations | `POST` | `/attendance-sync/batches/{id}/apply` | Write a received batch into its payroll month (Draft or Calculated payroll only) | integrations.manage |
