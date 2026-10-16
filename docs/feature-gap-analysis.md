# Feature-gap analysis (PDF specification vs repository)

Source: *Payroll Management Web Application — Development Specification and Handover* (12 pages)
compared with this repository on 16 Oct 2026.

> **Change control.** The specification (Delivery Plan) says scope changes go through a change
> request via Tejaswini. The three features built here are **not in the PDF**; they are delivered
> as change-request candidates and must be approved before production use. They do not alter any
> calculation, approval or finalisation rule.

## 1. Specified in the PDF

| PDF requirement | Status in code |
|---|---|
| Employee master, unique ID, import/export with row-level errors (5.1) | Implemented |
| Salary components, versioned employee salary, audit (5.2) | Implemented |
| Run lifecycle Draft → Calculated → Under review → Approved → Finalised, re-open with reason (4, 5.3) | Implemented |
| Exceptions panel; warn on negative net and "large month-on-month changes (threshold to be agreed)" (8.4) | Implemented for **net pay only**, vs the previous finalised month, threshold off by default |
| Calculation engine mapped to the client's Excel formulas (8.3) | Mechanics implemented; **client formulas pending** (client inputs 1–3) |
| Payslips (single/bulk), monthly summary, employee statement, earnings/deductions/net reports (5.4, 10) | Implemented, provisional layouts (client input 4) |
| History / exception report — "only if the client requests" (10) | Not built (by design) |
| RBAC Administrator / Payroll User / optional Viewer, audit log (6, 11) | Implemented; Viewer disabled pending client |
| Attendance import — later phase (5.5) | Out of scope; input table designed for it |
| Daily backup and tested restore (11, 13) | Documented procedure (`docs/backup-and-restore.md`); runs outside the app |
| User guide, admin guide, technical readme (13) | Technical docs in `docs/`; user/admin guides partly |

## 2. Candidate features (from the change brief) vs PDF and code

| # | Candidate | In PDF? | In code? | Verdict |
|---|---|---|---|---|
| A | Explainable anomaly detection with review history | Partly: "warn on large month-on-month changes" (net only) | Net-pay % warning only, no review/history | **Extension → built.** The PDF item stays as is; component-level, history-based, duplicate and repeated-adjustment rules, explanations and a review trail are new |
| B | Reconciliation / variance workspace between two months | No (only "totals reconcile" as a test activity) | No | **New → built** |
| C | Scenario simulator | No | No | New; deferred (needs client rules for which revisions are "permitted" and a transfer policy) |
| D | Employee document & acknowledgment centre | No; employees are not users in the PDF | No | Deferred — needs an employee role and client approval (PDF roles: Administrator, Payroll User, Viewer) |
| E | AI payroll assistant | No | No | Deferred — sending salary data to an external AI service needs explicit approval; out-of-scope "third-party integrations" |
| F | Knowledge & handover centre | Related goal ("dependency on one individual"), handover docs; no in-app feature | No | **New → built** (in-app, versioned, with a run checklist) |
| G | Operational health & recovery centre | Backups required, but run outside the app | Import jobs tracked; no job runner, no backup records | Deferred — the app has no background-job system or backup telemetry to report truthfully; building one is a hosting decision (open question 8) |

## 3. Selected scope and why

1. **A — Anomaly alerts.** Highest value for a team without HR specialists: it explains *why* a
   number looks wrong before approval. Rules are transparent and configurable; no machine learning
   (there is no meaningful history yet). Builds on the existing exception mechanism.
2. **B — Reconciliation.** The client's Excel process relies on comparing months by hand. A
   month-vs-month workspace with explanations and an exportable report makes review auditable and
   supports successor operators. Read-only over payroll data.
3. **F — Knowledge & handover centre.** Directly addresses the business problem in section 2 of the
   PDF (dependency on one person). Articles are versioned, owned and review-dated; components
   without documentation are flagged as undocumented rather than explained by guesswork.

All three reuse the existing stack (Express registry, Prisma, Next.js, `@nexzi/ui`), need no new
roles or external integrations, and never write to payroll runs, lines or finalised snapshots.

## 4. Decisions needed from the client / Tejaswini

- Approve A, B and F through the change-request process.
- Agree anomaly thresholds (defaults are placeholders, editable in Payroll settings).
- Confirm who may record reconciliation explanations and review alerts (defaults: users with
  *Calculate payroll* or *Approve payroll*).
- Confirm who may edit the knowledge centre (new permission `knowledge.manage`, Administrator by default).
- C, D, E, G as listed above.
