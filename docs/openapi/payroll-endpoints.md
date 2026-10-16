| Area | Method | Path | Purpose | Permission |
|---|---|---|---|---|
| Auth | `POST` | `/auth/login` | Sign in with email and password (sets an httpOnly session cookie) | public |
| Auth | `POST` | `/auth/logout` | Sign out and revoke the current session | signed in |
| Auth | `GET` | `/auth/me` | Current user, role and permissions | signed in |
| Auth | `POST` | `/auth/change-password` | Change own password (revokes other sessions) | signed in |
| Users & Roles | `GET` | `/users` | List users | users.manage |
| Users & Roles | `POST` | `/users` | Create a user with a temporary password (must be changed at first sign-in) | users.manage |
| Users & Roles | `PUT` | `/users/{id}` | Update a user (name, role, status) | users.manage |
| Users & Roles | `POST` | `/users/{id}/reset-password` | Set a temporary password, unlock the account and revoke sessions | users.manage |
| Users & Roles | `POST` | `/users/{id}/unlock` | Clear a sign-in lockout | users.manage |
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
| Reports | `GET` | `/reports/net-payable` | Net payable report for a run | reports.view |
| Reports | `GET` | `/reports/employee-statement` | Employee-wise salary statement (month by month) | reports.view |
| Dashboard | `GET` | `/dashboard` | Dashboard figures from live data (amounts only with permission) | signed in |
| Dashboard | `GET` | `/notifications` | Pending payroll actions for the current user | signed in |
