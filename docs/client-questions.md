# Client questions and pending inputs

Route these through Tejaswini (specification §14–15). "Effect" is what changes in the software once
the item is answered.

| # | Question / input | Status | Effect on implementation |
|---|---|---|---|
| P1 | Current payroll Excel workbook with all formulas | Pending | Configure salary components; implement each formula in `FORMULA_REGISTRY` with unit tests; define input columns |
| P2 | Blank template + 2–3 completed sample months (masked) | Pending | Reconciliation tests (system = Excel). Only then set `PAYROLL_RULES_APPROVED=true` |
| P3 | Salary components and rules actually used, including exceptions | Pending | Component configuration; per-employee structures |
| P4 | Exact rounding rule (per line or at total, decimals, mode) | Pending | Payroll settings → rounding |
| P5 | Sample payslip and required reports | Pending | Replace the internal layouts; set `PAYSLIP_FORMAT_APPROVED=true` after written approval |
| P6 | Does the Excel include PF, ESI, TDS or professional tax? Are they in scope? | Open | If yes: stop and escalate. Statutory logic is out of scope until agreed in writing |
| P7 | How will attendance data reach payroll (import, integration, manual)? | Open | The grid already supports manual entry and paste; an import can feed the same input keys |
| P8 | Who may change salary structures and approve or finalise payroll? | Open | Role permissions; the "separate approval step" and "different approver" settings |
| P9 | Is a Management/Viewer role required? | Open | `VIEWER_ROLE_ENABLED=true`; grant view permissions (amounts only if approved) |
| P10 | One finalised run per month? Can a month be re-run? | Open | Currently a unique (year, month) constraint; re-open is supported |
| P11 | Must historical months be loaded? | Open | Would need an import of historical results (not built) |
| P12 | Employee ID format; which identity, bank and personal fields are in the workbook | Pending | Add the approved fields to the employee master and import (none added yet) |
| P13 | Which salary version applies when salary changes mid-month? Any proration? | Pending | Currently "version in effect on the month's last day"; no proration implemented |
| P14 | Threshold for "unusual change" warnings | Pending | Payroll settings |
| P15 | Hosting environment and backup ownership | Open | Deployment and backup runbooks |
| P17 | Should anyone be able to self-register? Restrict to which email domains? Which role for new accounts? Is administrator approval wanted? | New | SIGNUP_ALLOWED_DOMAINS, SIGNUP_REQUIRE_APPROVAL, default role |
| P18 | SMTP server/account and sender address for system emails | New | SMTP_*, MAIL_FROM |
| P16 | Acceptance criteria, single point of contact, UAT users | Pending | UAT plan |
