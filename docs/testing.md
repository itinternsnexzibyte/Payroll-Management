# Testing

| Suite | Command | Needs |
|---|---|---|
| Shared core unit tests | `npm run test -w @nexzi/server-core` | — |
| Payroll API unit + integration | `npm run test -w @nexzi/payroll-api` | PostgreSQL with `payroll_test` (`TEST_DATABASE_URL`) |
| Both | `npm test` | |
| Browser E2E | `npm run test:e2e` | PostgreSQL; Edge (default), `E2E_BROWSER_CHANNEL=chrome`, or Playwright Chromium |
| Lint / types | `npm run lint`, `npm run typecheck` | |

Integration tests run the real Express app against a real PostgreSQL test database (migrated
automatically and truncated per file). E2E starts its own API and web servers on ports 3101/4101
against `payroll_test`, so development data is never touched.

## Recorded results (2026-10-16, Windows 11, Node 24.18, PostgreSQL 17.6)

These results come from the original development workspace; the standalone repository is
re-verified before each push (see the commit message).

| Check | Result |
|---|---|
| Lint, type-check | ✅ no errors |
| server-core unit tests | ✅ 5 / 5 |
| payroll-api unit + integration | ✅ 50 / 50 |
| E2E (Playwright, Microsoft Edge) | ✅ payroll scenario passed |
| Production build; built API smoke test (`/health`, `/ready`, `/openapi.json`) | ✅ |
| Docker images | ⚠️ not built (Docker unavailable) |
| Reconciliation against the client's Excel | ⛔ client files not received |

### Change requests A, B, F (2026-10-16, same environment)

| Check | Result |
|---|---|
| Lint, type-check (all workspaces) | ✅ no errors |
| server-core unit tests | ✅ 8 / 8 |
| payroll-api unit + integration (incl. 14 new unit and 18 new integration tests) | ✅ 93 / 93 |
| Production build: API bundle and Next.js build | ✅ |
| Existing payroll, sign-up and auth suites (regression) | ✅ unchanged and passing |
| E2E (Playwright) | ⚠️ not re-run for this change; new screens checked with headless Chrome against local data |

## What is covered

- **Security:** valid and invalid login (same message for both); lockout after 5 failures;
  disabled accounts; logout revokes the session; idle-session expiry; forced password change;
  rejection of foreign or missing Origin (CSRF); Viewer role disabled until confirmed; audit log
  is append-only at the database level; a Payroll User is blocked from users, audit, employee
  creation, salary components, approve, finalise and re-open even via direct API calls; every
  endpoint requires sign-in; server-side validation.
- **Payroll alerts (A):** every rule with explanations and thresholds; quiet below thresholds;
  severity lowered when the salary structure changed; history requirements; duplicates by
  normalised name; deterministic fingerprints; automatic scan after calculation; idempotent and
  concurrent re-scans; finalised lines unchanged by scans; one review only under concurrent
  submits; re-open on changed figures and clear on disappearance; append-only trail (database);
  settings validation; amounts and review permissions enforced on the server.
- **Reconciliation (B):** new/missing/changed/unchanged classification; absolute and percentage
  differences; exact decimal totals; filters; expected vs unresolved vs resolved; note
  upsert audited with before/after; validation (same run, unknown component, short note, Draft
  run); XLSX export; permissions.
- **Knowledge centre (F):** manager-only editing; link validation; versioning with stale-edit
  rejection; immutable versions (database); drafts hidden from readers; search; coverage
  states (undocumented / awaiting client confirmation); idempotent default checklist; per-run
  checklist with permissions.
- **Engine:** fixed, percentage and input components; default rates; per-employee structures;
  decimal exactness; rounding modes and line-vs-total rounding; missing, invalid and out-of-range
  inputs; missing salary version; unconfigured formulas never invent amounts; registered formulas
  with dependencies; circular references; negative-net and unusual-change warnings; determinism
  and the calculation hash; salary-version selection by date; eligibility.
- **Lifecycle:** duplicate employee IDs (case-insensitive); salary versioning without overwrite;
  duplicate month runs refused; partial input save keeps failed cells; deterministic
  recalculation with exact expected amounts; approval before finalisation; **concurrent finalise
  where exactly one request succeeds**; immutability at API and DB level; results unchanged after
  salary or component changes; payslip PDF stored and re-served; re-open needs permission and a
  reason and is audited; stale calculations detected; mandatory inputs block submission; amounts
  hidden without permission.
- **Import:** preview, partial commit, error report, no double commit; unsupported file types
  rejected; formula injection neutralised.
- **E2E:** admin configures an input column and components → creates an employee → adds a salary
  version → starts a run → enters an input in the grid → calculates (net 26,500.50) → submits →
  approves → finalises → downloads a real payslip PDF → updates the salary master → the finalised
  run still shows 26,500.50 → a Payroll User's crafted re-open request gets 403.

Before go-live: reconcile against every client sample month and employee; visually approve the
payslip and report layouts; run client UAT.
