# HR and Payroll Integration Architecture

## Current state discovered

The Payroll Management repository is the production foundation for the unified application:

- Next.js 15 / React 19 frontend with the shared `@nexzi/ui` component library.
- Express 5 / TypeScript API with a central validated route registry.
- PostgreSQL through Prisma 6; UUID employee, user, and role identifiers.
- HttpOnly, SameSite session cookies, server-enforced permission codes, audit logging,
  append-only finalized payroll snapshots, and decimal-safe payroll calculations.
- Render Docker images and a web proxy that forwards `/api/*` to the API.

The HR repository (`hr_management-`, branch `main`, inspected at commit
`671d05a97ec0e6df7f73786726f2700219fe8c66`) is a separate application:

- FastAPI / Python 3 with SQLAlchemy 2 and Pydantic 2.
- Its configuration supports MySQL by default and PostgreSQL/SQLite in some code paths;
  dependencies include both `pymysql` and `psycopg`.
- Integer IDs for users, interns, and attendance, JWT bearer tokens, Argon2 password hashes,
  separate static HTML/JavaScript frontend, and files stored under backend-local directories.
- The inspected modules include intern/workforce records, attendance sessions/breaks and
  optional GPS locations, calendar events, notifications, assignments/submissions, ratings,
  documents, a separate employee directory, US-client records, registration/approvals, and
  monthly payroll JSON files.

The applications do not share a schema or identity system. Directly copying the HR backend would
create a second authentication system, database, employee directory, and payroll implementation.
Its monthly payroll JSON code uses binary floating-point arithmetic and is not a safe replacement
for Payroll's decimal calculation and immutable finalization workflow.

## Target architecture

Use Payroll's existing modular-monolith architecture as the one application:

1. One Next.js app, one Express API, one PostgreSQL database, and the existing deployment process.
2. One canonical `Employee` row and Payroll `User`/role/session system. New HR-specific records
   reference the canonical employee's UUID. Do not copy the HR JWT login or role strings.
3. Continue to declare API operations with the route registry, Zod input schemas, server-side
   permissions, audit writes, and shared API errors.
4. Keep Payroll's existing salary, leave, attendance, payroll lifecycle, reports, bank, and
   self-service implementations. HR features must call or extend these modules rather than
   creating shadow copies.
5. Use additive Prisma migrations only. Do not point the Payroll migration runner at the HR
   database or drop/rename source tables.
6. Store uploaded private documents on durable private storage only after file access policies,
   limits, retention, and a production storage target are established.

## Identity and cross-module rules

- `Employee.id` (UUID) is the canonical key for employee, attendance, leave, salary, and payroll
  relationships.
- HR intern IDs are source-system integer IDs, not Payroll employee IDs. Any migration must keep
  an explicit source-system/source-ID mapping and must never match people solely by display name.
- Existing users are not automatically linked by email. Account linking requires an explicit,
  verified administrative action; source password hashes are not imported.
- The additive Workforce permissions become available in the role editor. Existing role
  assignments are preserved by the deployment bootstrap; administrators should grant Workforce
  access only to the appropriate roles.
- Existing employee-code uniqueness, employee status, salary-version effective dates, unique
  employee/date attendance, and unique payroll period constraints remain in effect.
- A daily attendance register entry does not silently become a payroll input. Approved leave,
  attendance sync, and manually entered payroll inputs retain their existing, explicit workflows.
- Finalized payroll rows and generated historical payslips remain immutable; HR profile, assignment,
  or rating changes cannot rewrite payroll history.

## Feature integration policy

Features already implemented in Payroll remain the source of truth for employees, departments,
designations, attendance records, leave, salary, payroll, payslips, reports, permissions, and audit.
The HR attendance workflows are adapted to Payroll employee IDs and its permission/audit model:
employees can check in and out, manage breaks, and send session heartbeats; administrators can
review daily session totals and forced-checkout reactivation requests. A server watchdog closes
sessions that stop sending heartbeats. Manual register edits cannot overwrite session-tracked
attendance.

Location tracking is optional and requires employee consent. The employee can turn it off during a
session; recorded coordinates are excluded from normal attendance responses and are accessible only
through the dedicated attendance-location permission. Location data does not affect payroll.
Attendance sessions and the existing monthly attendance-input sync are separate workflows; neither
silently changes a finalized payroll.

HR assignments and text/link submissions are integrated as an additive Payroll Workforce module.
It is linked to `Employee`, uses Payroll permissions and audit logging, supports submission
revisions and manager review, and has no effect on payroll calculations. Calendar events and
in-app notifications are also integrated as additive Payroll modules. Events may be shared or
employee-specific; notifications are scoped to the linked employee and include event and assignment
updates. Extended workforce profiles, dated employee ratings, private offer-letter/document
uploads, profile photos, and their employee self-service views are also linked to Payroll's
canonical employee IDs and protected by Payroll permissions and audit logging. The daily attendance
register includes a month navigator, employee filter, work totals, and session/break summaries.

Private employee attachments are limited to PDF/PNG/JPEG/WebP files up to 5 MB. Local development
stores them under `apps/payroll-api/.data/private-employee-files` (override with
`PRIVATE_EMPLOYEE_STORAGE_DIR`); this path is outside the public web root and should be included in
local backups. The current deployment storage/retention policy is not configured by this integration.

Client records and the source client photo, identity-card, and MOU file workflows are integrated
under the Payroll `clients.*` permissions. Client identity and agreement files are encrypted at
rest with AES-256-GCM using a dedicated `CLIENT_DATA_KEY`; downloads are audited and sensitive
documents require `clients.sensitive.view`. Local files are stored outside the web root under
`apps/payroll-api/.data/private-client-files` (override with `PRIVATE_CLIENT_STORAGE_DIR`).
Configure and back up the key securely; losing it makes these files unreadable. Retention duration
and imported source records remain data-governance/migration matters, not missing application
workflows.
HR source-system user accounts and its standalone JSON payroll calculation are not copied into
Payroll. The source payroll records need a validated, decimal-safe import into Payroll's historical
model; they must not be replayed through the current payroll engine or silently re-calculated.

## Deployment

Use Render for the web service, API, PostgreSQL, and durable private storage as documented in
[`deployment.md`](./deployment.md). Production secrets belong in Render's Environment settings.
No application feature or database is removed as part of choosing Render.

## Operational data-migration requirements

- A verified export/backup of the existing HR production database and its storage directory before
  any legacy-data migration.
- Confirmation of identity matching rules for source interns/employees and account linking.
- The organization's retention schedule for GPS and sensitive client records.
- Client-approved mapping for legacy payroll JSON records, statuses, rounding, and payslip artifacts.
- Production database URL, allowed web origin, persistent disk, email provider, and secrets.
