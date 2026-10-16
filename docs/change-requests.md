# Change requests A, B and F — payroll alerts, reconciliation, knowledge centre

Why these three were chosen, and what was deferred, is in
[feature-gap-analysis.md](feature-gap-analysis.md). None of them is in the PDF specification;
they need approval through the change-request process before production use. None of them
changes calculation, approval, finalisation or re-opening.

## A. Payroll alerts (explainable anomaly detection)

**User story.** As a payroll user, before I submit a month I want the system to point out
figures that look unusual compared with each employee's earlier months, and say why, so I can
catch mistakes without comparing spreadsheets by hand.

**Acceptance criteria**
- Alerts are produced automatically after every successful calculation and can be re-run with
  **Check again** (idempotent; concurrent runs cannot create duplicates).
- Every alert names the employee, the rule, the numbers behind it and the threshold.
- Reviewers record an outcome (*Expected change*, *Corrected in payroll*, *Not an issue*) and a
  comment. A double submit cannot review twice.
- A reviewed alert whose numbers later change is re-opened; an alert that is no longer found
  after recalculation is marked *Cleared*. Every step is kept in an append-only history.
- Alerts never write to payroll runs, lines or finalised snapshots.

**Rules** (`apps/payroll-api/src/anomalies/rules.ts`, unit-tested). Comparisons use the most
recent **finalised** month before the run, and up to *N* earlier finalised months.

| Rule | Fires when | Severity |
|---|---|---|
| Net pay changed sharply | Net differs from the last finalised month by ≥ net % and ≥ minimum amount | Medium; High at 2× the threshold |
| Salary component changed | A fixed / percentage / formula component differs by ≥ component % and ≥ minimum amount | Medium; High at 3× |
| New / missing salary component | A structure component appears, or disappears, compared with last month | Medium |
| Unusual monthly amount | A monthly-entered amount exceeds (largest of the last *N* months × multiplier), with enough history | Medium; High at 2× the limit |
| First monthly amount in a while | A monthly-entered amount is non-zero after *N* months of zero | Low |
| Same monthly amount as last month | A monthly-entered amount is identical to last month (possible carry-over) | Low |
| Possible duplicate employee | Two employees in the run have the same name (case, spacing and punctuation ignored) | High |

When the employee's salary structure changed since the comparison month, the alert says so and
its severity is lowered one level.

**Settings** (Payroll settings → *Payroll alerts*, stored in `payroll_settings.anomalyRules`).
Defaults are **placeholders until agreed with the client**: net change 20 %, component change
25 %, ignore differences below 100, outlier multiplier 2×, 6 months of history, at least 3 months
needed. Alerts can be switched off.

**Permissions.** Viewing needs *View payroll runs* **and** *View payroll amounts* (alert text
quotes amounts). Reviewing and re-running need *Calculate payroll* or *Approve payroll*.

**Screens.** Payroll run → *Payroll alerts* tab; menu → *Payroll alerts* (history across months
with search and filters); *Payroll settings → Payroll alerts*.

## B. Reconciliation and variance analysis

**User story.** As a payroll user or approver, I want to compare this month with any earlier
month, see who and what changed, and record why, so that approval is based on explained
differences rather than totals alone.

**Acceptance criteria**
- Any two calculated or finalised months can be compared (never a Draft, never a month with itself).
- Employee-wise and component-wise differences with absolute and percentage change; employees
  are classified *New this month*, *Not in this month*, *Changed* or *Unchanged*.
- Filters: change type, explanation status, department, component, employee search.
- Explanations per employee, or per employee and component, classified *Expected*,
  *Discrepancy* or *Resolved*; differences without an explanation are *Not yet explained*.
  "Unresolved" = not explained + discrepancies. Every save is audit-logged with before/after.
- Download as PDF or XLSX with the same filters (the export is audit-logged).
- Read-only over payroll data; amounts come from stored results, no formula is applied.

**Permissions.** Viewing and export need *View reports* **and** *View payroll amounts*.
Explanations need *Calculate payroll* or *Approve payroll*.

**Screens.** Menu → *Reconciliation*; *Reconcile* button on a payroll run.

## F. Knowledge and handover centre

**User story.** As the payroll owner, I want the procedure, the meaning of each component, the
business rules and the fixes for common errors written down, owned and reviewed, so that a
successor can run payroll without depending on one person.

**Acceptance criteria**
- Articles of type *Procedure*, *Salary component*, *Business rule*, *Validation error*,
  *Onboarding*; full-text search; draft/published; archive and restore.
- Every save creates an immutable version (database trigger); stale edits from another tab are
  rejected; earlier versions can be read.
- Each article has an owner and an optional review date; overdue reviews are flagged.
- Rules are marked *Awaiting client confirmation* until confirmed in writing — the centre shows
  undocumented components and validation errors instead of inventing explanations.
- Exceptions on a payroll run link to the published "how to resolve" article for that error.
- A monthly checklist (template editable by knowledge managers) is tracked per run with who/when.
  Ticking steps never changes payroll. A default checklist that lists this application's own
  workflow steps is created once at API start-up; client-specific steps are added by the owner.

**Permissions.** Any signed-in user reads published articles (articles must not contain salary
or personal data — the editor says so). Editing needs the new permission `knowledge.manage`
(granted to Administrator automatically; grant it to other roles under *Roles & permissions*).
Ticking checklist steps needs any of *Enter inputs*, *Calculate*, *Approve* or *Finalise payroll*.

**Screens.** Menu → *Knowledge centre* (Articles, What is documented, Monthly checklist); article
page with versions; payroll run → *Checklist* tab.

## API endpoints added

See the generated [endpoint table](openapi/payroll-endpoints.md) (tags *Payroll Alerts*,
*Reconciliation*, *Knowledge*). Changed: `POST /payroll-runs/{id}/calculate` now also returns
`alerts` (`{ enabled, detected, opened, reopened, cleared }` or `null` if the scan failed — the
calculation itself is unaffected). `GET/PUT /settings` include `anomalyRules`.

## Database migration

`20261016104813_anomalies_reconciliation_knowledge` (additive only):
`payroll_anomalies`, `payroll_anomaly_events` (append-only trigger), `reconciliation_notes`
(check: two different runs; unique per run pair, employee and component),
`knowledge_articles`, `knowledge_article_versions` (append-only trigger),
`payroll_checklist_items`, `payroll_run_checklist`. Foreign keys use RESTRICT, like the rest of
the schema, so history cannot be deleted from under them.

## Deployment

No new environment variables or external services. Run `npm run db:migrate` (or start the API
container with `RUN_MIGRATIONS=true`); the API creates the default checklist on start-up. Agree
the alert thresholds with the client and set them in Payroll settings.
