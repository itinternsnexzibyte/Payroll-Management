# Payroll Management — NexziByte Solutions

Web application for managing employees, salary structures, monthly payroll, payslips and payroll
reports, built from the internal *Payroll Management Web Application* development specification.

| Part | URL (development) |
|---|---|
| Web app (Next.js) | http://localhost:3001 |
| API (Express) | http://localhost:4001 |
| API docs (Swagger UI) | http://localhost:4001/docs |

The browser only talks to the web app; `/api/*` is proxied to the API, so the session cookie is
first-party (`HttpOnly`, `SameSite=Strict`).

> **Status — read before using with real data.** All workflows are implemented and tested, but
> the client's payroll workbook (formulas, components, rounding), completed sample months and
> payslip format have **not been received**. Calculation rules are configurable and every
> calculated amount, payslip and report is labelled **PROVISIONAL** until they are reconciled
> with the client's Excel. See [docs/known-gaps.md](docs/known-gaps.md) and
> [docs/client-questions.md](docs/client-questions.md).

## Features

- **Employees:** list/search/filter/sort, create/edit, deactivate or exit (never hard-deleted),
  CSV/XLSX import with column mapping, row-level validation and a downloadable error report, and export.
- **Salary:** configurable components (fixed, percentage of another component, monthly input, or
  approved formula) and per-employee **versioned** structures with effective dates and change history.
- **Monthly payroll:** Draft → Calculated → Under review → Approved → Finalised.
  - **Input grid:** Excel-like (arrow/Enter navigation, paste a block from Excel); invalid cells keep what was typed.
  - **Calculation and review:** decimal-safe and deterministic, run on the server; an exceptions panel; approval with permission checks.
  - **Finalisation and re-opening:** finalised results are immutable (API and database triggers). Re-opening needs an Administrator and a reason, and is audit-logged.
- **Outputs:** payslip preview, individual stored PDFs, bulk print-ready PDF; monthly summary,
  earnings, deductions, net payable and employee salary statement reports (screen/PDF/XLSX).
- **Administration:** users, configurable role permissions (Administrator, Payroll User, optional
  Viewer), an append-only audit log, and payroll settings (rounding, approval policy, input columns).

## Repository layout

```
apps/payroll-api/      Express + Prisma API (engine, lifecycle, payslips, reports, import)
apps/payroll-web/      Next.js web app
packages/server-core/  Auth/sessions, RBAC route registry + OpenAPI, audit, errors, logging, CSV/XLSX, PDF, money
packages/ui/           Design tokens (burgundy palette), components, app shell, admin screens
e2e/                   Playwright browser → API → PostgreSQL scenario
infra/                 Dev PostgreSQL launcher, API bundler, Dockerfiles
docs/                  Architecture, schema, API, business rules, security, testing, deployment, gaps
```

## Prerequisites

- Node.js 20.11+ and npm 10+
- PostgreSQL 17 — `docker compose up -d postgres` **or** the bundled dev server (`npm run db:start`, no Docker needed)
- Chrome, Edge or Chromium installed (PDF rendering and E2E tests); set `PDF_BROWSER_PATH` if needed

## Quick start (Windows PowerShell)

```powershell
npm install                                   # approve install scripts for prisma, esbuild, embedded-postgres if npm asks
Copy-Item apps\payroll-api\.env.example apps\payroll-api\.env
npm run db:start                              # keep this terminal open (or: docker compose up -d postgres)
# new terminal:
npm run prisma:generate
npm run db:migrate
npm run db:seed
npm run dev:api                               # terminal 1
npm run dev:web                               # terminal 2
```

Open http://localhost:3001. **Development sign-in accounts** come from the `SEED_*` values in
`apps/payroll-api/.env` (see `.env.example`); the seed refuses to create them when
`NODE_ENV=production`. All seeded employees and components are **synthetic** and labelled as such.

**Production first administrator:** `npm run build`, then set `BOOTSTRAP_ADMIN_EMAIL`,
`BOOTSTRAP_ADMIN_NAME` and `BOOTSTRAP_ADMIN_PASSWORD` and run
`npm run bootstrap:admin -w @nexzi/payroll-api` (the password must be changed at first sign-in).

## Commands

| Task | Command |
|---|---|
| Unit + integration tests (PostgreSQL running) | `npm test` |
| Browser E2E (starts its own servers on 3101/4101) | `npm run test:e2e` |
| Type-check / lint | `npm run typecheck` / `npm run lint` |
| Production build | `npm run build` |
| Start built API | `npm start -w @nexzi/payroll-api` |
| New migration | `npm run db:migrate:dev -w @nexzi/payroll-api -- --name <change>` |

Health: `GET /health` (liveness) and `GET /ready` (database reachable).

## Documentation

[Architecture](docs/architecture.md) · [Database schema](docs/database-schema.md) ·
[API reference](docs/api-reference.md) · [Business rules](docs/payroll-business-rules.md) ·
[Security](docs/security.md) · [Testing](docs/testing.md) · [Deployment](docs/deployment.md) ·
[Backup & restore](docs/backup-and-restore.md) · [Known gaps](docs/known-gaps.md) ·
[Client questions](docs/client-questions.md)
