# HR and Payroll Feature Mapping

This map compares the inspected Payroll application with the HR repository at commit
`671d05a97ec0e6df7f73786726f2700219fe8c66`. "Existing in Payroll" means the feature is already
implemented in this repository; it does not claim the separate HR implementation or its live data
has been migrated.

| HR source feature | Payroll destination / decision | Status |
|---|---|---|
| HR employee directory (`employees` table and `/api/employees`) | Canonical Payroll Employees directory, department/designation masters, and employee UUID | Existing Payroll directory is authoritative; no source data imported |
| Intern/workforce profiles and approvals | Employee/User administration with a future optional workforce profile linked to `Employee.id`; user approval remains in Payroll's user model | Not yet ported; needs a verified data mapping |
| Admin daily attendance register | `/attendance` daily employee register | Adapted and implemented using Payroll employees, permissions, audit log, and PostgreSQL |
| Intern login/check-out, heartbeat sessions, breaks, GPS location history | Separate attendance-capture workflow | Not ported; location collection needs explicit policy and privacy review |
| Attendance reports and daily presence totals | Payroll attendance register and existing attendance sync | Daily register exists; source-specific work-session/break totals are not yet integrated |
| Leave | Payroll Leave module, approvals, balances, and mapped monthly input fill | Existing Payroll implementation is authoritative |
| Salary/payroll in calendar and `payroll_records/intern_<id>.json` | Payroll runs, salary versions, decimal calculation engine, approvals, finalized snapshots, payslips | Keep Payroll engine; source JSON is not imported or used for calculation |
| Assignments and intern submissions | Payroll Workforce/Assignments module linked to canonical employee UUIDs, with revision history and review states | Implemented for Payroll employees; source data/files not imported |
| Ratings/evaluations | Proposed Workforce evaluation records, server-authorized and audited | Not yet ported |
| Calendar events and notifications | Payroll calendar events and employee-scoped in-app notifications | Integrated; no source records imported |
| Offer letters, intern documents, and profile photos | Private employee document module with durable storage and per-document access policy | Not yet ported; no files copied |
| US-client/Aadhaar/MOU records | No matching Payroll feature; preserve in HR source and assess separately | Not imported; sensitive records require purpose, access, and retention decisions |
| Registration OTP, admin approvals, password reset | Payroll sign-up/approval, session, and user-management flows | Payroll authentication remains authoritative; HR JWT accounts/hashes are not imported |
| Dashboards and reports | Existing Payroll dashboard and reports; add only HR metrics backed by integrated records | Existing Payroll metrics retained; HR-only metrics not yet ported |
| Email notifications | Payroll email service and notification preferences | Existing Payroll service retained; source attendance-watchdog emails not ported |

## Preservation and migration guarantees

- No Payroll route, table, permission, workflow, or UI module is removed by this integration mapping.
- Workforce assignments add new tables/routes/permissions and a People navigation page; they do not
  modify Payroll calculations, attendance inputs, or finalized payroll.
- The HR source repository and its separate database/storage are not overwritten or modified.
- No live HR data is imported from the source repository clone. Source code access is not database
  access, and a source database export/backup is required before a safe migration.
- See [`DATABASE_MIGRATION.md`](./DATABASE_MIGRATION.md) before transferring any production data.
