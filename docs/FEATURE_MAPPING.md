# HR and Payroll Feature Mapping

This map compares the inspected Payroll application with the HR repository at commit
`671d05a97ec0e6df7f73786726f2700219fe8c66`. "Existing in Payroll" means the feature is already
implemented in this repository; it does not claim the separate HR implementation or its live data
has been migrated.

| HR source feature | Payroll destination / decision | Status |
|---|---|---|
| HR employee directory (`employees` table and `/api/employees`) | Canonical Payroll Employees directory, department/designation masters, and employee UUID | Existing Payroll directory is authoritative; no source data imported |
| Intern/workforce profiles and approvals | Payroll employee profile linked to `Employee.id`; user approval remains in Payroll's user model | Teams ID, college, course, internship role and duration are integrated; source account approvals and records are not imported |
| Admin daily attendance register | `/attendance` daily employee register | Adapted and implemented using Payroll employees, permissions, audit log, and PostgreSQL |
| Intern login/check-out, heartbeat sessions, breaks, GPS location history | Payroll self-service attendance sessions | Integrated with Payroll identity and permissions; location is opt-in and access-restricted |
| Attendance reports and daily presence totals | Payroll daily register, session summaries, monthly calendar and Attendance to payroll | Daily sessions, break totals, month navigation, employee filters and reactivation review integrated; applying monthly totals remains a separate payroll-input workflow |
| Leave | Payroll Leave module, approvals, balances, and mapped monthly input fill | Existing Payroll implementation is authoritative |
| Salary/payroll in calendar and `payroll_records/intern_<id>.json` | Payroll runs, salary versions, decimal calculation engine, approvals, finalized snapshots, payslips | Keep Payroll engine; source JSON is not imported or used for calculation |
| Assignments and intern submissions | Payroll Workforce/Assignments module linked to canonical employee UUIDs, with revision history and review states | Implemented for Payroll employees; source data/files not imported |
| Ratings/evaluations | Payroll employee ratings with dated feedback and audit history | Integrated; employees can view only their own evaluation history |
| Calendar events and notifications | Payroll calendar events and employee-scoped in-app notifications | Integrated; no source records imported |
| Offer letters, intern documents, and profile photos | Private employee document module with per-employee access and audited downloads | Integrated for PDF and image uploads; files are stored outside the public web directory and no source files are copied |
| US-client/Aadhaar/MOU records | Payroll Clients module with availability, contact/location, photo, identity and MOU records | Workflows implemented with encrypted private files and distinct sensitive-document permissions; no source records imported |
| Registration OTP, admin approvals, password reset | Payroll sign-up/approval, session, and user-management flows | Payroll authentication remains authoritative; HR JWT accounts/hashes are not imported |
| Dashboards and reports | Existing Payroll dashboard and reports plus the monthly attendance calendar | Payroll metrics retained; attendance month records and totals integrated |
| Email notifications | Payroll email service and notification preferences | Payroll's configured email service covers approval, leave and payslip events; attendance forced-checkout/reactivation alerts are configurable in Payroll settings |

## Preservation and migration guarantees

- No Payroll route, table, permission, workflow, or UI module is removed by this integration mapping.
- Workforce assignments add new tables/routes/permissions and a People navigation page; they do not
  modify Payroll calculations, attendance inputs, or finalized payroll.
- The HR source repository and its separate database/storage are not overwritten or modified.
- No live HR data is imported from the source repository clone. Source code access is not database
  access, and a source database export/backup is required before a safe migration.
- Client records and secure identity/MOU document workflows are implemented in Payroll. Legacy
  client records and source files were not imported because no verified database/storage export was
  available. The source's standalone monthly payroll JSON is intentionally not copied;
  Payroll's decimal-safe payroll lifecycle remains authoritative.
- Attendance timeout and reactivation events use Payroll's audit and in-app notification systems;
  administrators can enable corresponding emails in Payroll settings. Browser location remains
  optional and requires explicit employee consent.
- See [`DATABASE_MIGRATION.md`](./DATABASE_MIGRATION.md) before transferring any production data.
