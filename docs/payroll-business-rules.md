# Payroll business rules

> **Status: PROVISIONAL.** The client's payroll workbook, completed sample months, salary rules,
> rounding rule and payslip format have not been received. Nothing below is a client-approved
> formula. While `PAYROLL_RULES_APPROVED=false` (server setting) every screen, payslip and report
> labels calculated amounts as provisional.

## What is implemented as configuration (not hard-coded)

| Item | Where it is configured | Default (placeholder) |
|---|---|---|
| Salary components (earning/deduction, order, payslip visibility) | Salary components screen | Synthetic demo components only in dev seed |
| Calculation basis per component | Salary components screen | — |
| Monthly input columns (the hand-filled Excel fields) | Payroll settings → Monthly input columns | Synthetic demo inputs only in dev seed |
| Employee-specific values | Employee → Salary → New salary version | — |
| Rounding: decimals, mode, per line or at totals | Payroll settings | 2 decimals, half-up, per line |
| Which salary version applies to a month | Payroll settings | Version in effect on the month's last day |
| Separate approval step / separate approver | Payroll settings | Approval step on; same person allowed |
| Unusual net-pay change warning threshold | Payroll settings | Off |
| Role permissions (who may edit employees, salary, approve, finalise) | Roles & permissions | Specification's starting matrix |

## Calculation engine (`apps/payroll-api/src/payroll/engine.ts`)

Generic mechanics only — the arithmetic a configured structure implies, not client formulas:

| Basis | Amount |
|---|---|
| `FIXED` | The employee's configured monthly value in the effective salary version |
| `PERCENTAGE` | Base component amount × rate ÷ 100 (employee rate, else component default) |
| `INPUT` | The value entered for that month in the input grid |
| `FORMULA` | A named, unit-tested function in `FORMULA_REGISTRY` implemented from the workbook. **The registry is empty**; any FORMULA component raises a blocking `FORMULA_NOT_CONFIGURED` exception rather than an invented amount |

- Gross = Σ earnings; Deductions = Σ deductions; Net = Gross − Deductions.
- An employee's structure is the set of components in their salary version, so structures can differ.
- Dependencies between components are resolved in order; circular references are reported.
- Decimal arithmetic throughout (`decimal.js`, 40-digit precision); amounts stored as `DECIMAL(18,4)`.
- Deterministic: a SHA-256 hash of all inputs (components, values, inputs, settings) is stored.
  Submit/approve/finalise recompute it and refuse with `STALE_CALCULATION` if anything changed.

**No statutory features** (PF, ESI, TDS, professional tax), attendance, LOP or overtime logic exist.
If the workbook contains them, implementation stops and is escalated (specification §3).

## Exceptions

| Code | Severity | Effect |
|---|---|---|
| `MISSING_INPUT`, `INVALID_INPUT` | Error | Blocks submission |
| `NO_SALARY_VERSION` | Error | Blocks submission |
| `PERCENTAGE_NOT_CONFIGURED`, `PERCENTAGE_BASE_MISSING`, `CIRCULAR_DEPENDENCY` | Error | Blocks submission |
| `FORMULA_NOT_CONFIGURED`, `FORMULA_ERROR` | Error | Blocks submission |
| `NEGATIVE_NET` | Warning | Must be acknowledged when submitting |
| `UNUSUAL_CHANGE` | Warning | Must be acknowledged (only when a threshold is set) |

## Lifecycle rules

- One run per month (database unique constraint) — pending client confirmation (Q5).
- Eligible employees: employed for at least part of the month and not `INACTIVE`.
- Inputs can be edited in Draft/Calculated; editing returns the run to Draft and clears results.
- Valid input cells are saved even when other cells fail validation; failed cells keep the typed value.
- Calculation, submission, approval, finalisation and re-opening run in transactions with a row lock;
  concurrent duplicate actions cannot both succeed (tested).
- Finalised results are immutable (API + database triggers). Later salary/master changes never
  alter them (tested).
- Re-opening requires `payroll.reopen` (Administrator) and a reason ≥ 10 characters; it is
  recorded in the run timeline and audit log, and stored payslips are marked superseded.

## Employee import

CSV/XLSX up to 5 MB / 5,000 rows. Columns are mapped (auto-suggested from headings) to the
approved fields only: Employee ID, Name, Department, Designation, Joining Date, Exit Date, Status.
Row-level checks: required fields, ID format, duplicates in file and in database, unknown
department/designation, dates (`YYYY-MM-DD` or day-first `DD/MM/YYYY`), exit before joining,
status values. Valid rows import; invalid rows are downloadable with an error column for
correction and re-import. Exports neutralise spreadsheet formula injection.

## Outputs

Payslips (individual stored PDF, bulk print-ready PDF, draft previews watermarked), monthly
summary, earnings report, deductions report, net payable report, employee salary statement —
screen, PDF and XLSX. Layouts are an **internal provisional format** until the client's payslip
and report samples are supplied (`PAYSLIP_FORMAT_APPROVED=false`).
