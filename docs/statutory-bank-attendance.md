# Statutory deductions, bank salary file and attendance sync

Three modules added on 16 Oct 2026. Each one is **off until someone configures it**. None of them
contains a statutory rate, a bank's file format or an attendance application's field names. Those
facts change, and they differ by client, so the payroll team enters them and the application
records who confirmed them.

## 1. Statutory deductions — PF, ESI, TDS

**Where:** Configuration → **Statutory deductions** (`settings.manage`). Report: Reports → *Statutory deductions (PF, ESI, TDS)*.

### Setting it up

1. Record **who confirmed** the figures, **when**, and the **source** (a notification, circular or adviser). A section cannot be switched on without them.
2. **PF:**
   - the employee and employer rates;
   - the components that make up PF wages;
   - the monthly wage ceiling, and whether to cap PF wages at it.
3. **ESI:**
   - the employee and employer rates;
   - the components that make up ESI wages;
   - the monthly eligibility limit.
4. **TDS:**
   - the taxable earning components;
   - the yearly standard deduction;
   - the tax slabs (the last one has no upper limit);
   - the rebate limit (no tax up to it) and the cess percentage;
   - optionally, an **override input column**.
5. Click **Create the PF / ESI / TDS deduction component**. This adds a `FORMULA` deduction (`PF_EMPLOYEE`, `ESI_EMPLOYEE`, `TDS`) that you can rename or reorder in Salary components.
6. Save, then recalculate any open payroll month.

A section that is switched on is applied to **every employee with a salary structure** in the payroll month. Each employee does not need it added to their salary version.

### Calculations

| Deduction | Amount on the payslip | Recorded on the line for the report |
|---|---|---|
| PF | employee rate × PF wages (PF wages = Σ chosen components, capped at the ceiling when capping is on) | PF wages, employer contribution |
| ESI | employee rate × ESI wages when ESI wages ≤ eligibility limit, else 0 | ESI wages, covered yes/no, employer contribution |
| TDS | override input when entered; otherwise tax on (Σ taxable monthly earnings × 12 − standard deduction) by the slabs, zero up to the rebate limit, plus cess, ÷ 12 | method, projected taxable income, projected annual tax |

**Simplifications to know about**

- **TDS** is a flat projection from the current month. It does not account for:
  - investment declarations or exemptions,
  - income from a previous employer,
  - arrears, bonuses or other irregular income,
  - tax already deducted earlier in the year.

  For any of these, put the month's TDS in the override input column, and that figure is used exactly as entered.
- **ESI eligibility** is checked month by month against the limit. Contribution-period continuity rules are not applied.
- **Employer PF/ESI** amounts are not deducted from pay. They are calculated for the statutory report only.
- **Not covered:** EPS/EDLI splits, admin charges, professional tax, labour welfare fund, and challan or return file formats (ECR, ESIC, Form 24Q).

### Safeguards

- Nothing is deducted until a section is switched on and complete. If a statutory component exists but its section is off or incomplete, calculation stops with a clear exception. It never uses a zero or a guessed rate.
- Changing statutory settings changes the calculation fingerprint. A calculated payroll month then becomes stale and has to be recalculated before it can be submitted, approved or finalised.
- The general `PUT /settings` endpoint cannot change statutory settings. Only `PUT /statutory` can, and it validates every save.
- Each change is written to the audit log (`statutory.updated`).

## 2. Employee bank details and the bank salary file

**Where:** Payroll → **Bank salary payments**, which has three tabs: *Employee bank details*, *Bank salary file* and *File layout*.

### Permissions

These are new permissions. Administrators get them automatically; no other role does.

| Permission | Allows |
|---|---|
| `bank.view` | See bank details with the account number masked (`•••• 7890`) |
| `bank.manage` | Add, replace and remove bank details |
| `bank.export` | Generate the bank file |
| `settings.manage` | Change the file layout |

### How account numbers are protected

- **Encryption:**
  - Account numbers are encrypted with AES-256-GCM using `BANK_DATA_KEY`, a 32-byte key in base64 set in the API's environment.
  - If `BANK_DATA_KEY` is not set, the API generates a key once and keeps it in `STORAGE_DIR/keys/bank-data.key` (owner-only), on the persistent storage disk rather than in the database. Bank details are switched off only if neither is available.
  - **Keep a secure backup of the key** (the environment value, or the key file with the storage disk). If it is lost, the stored numbers cannot be read, and every account has to be entered again.
- **Employees can enter their own account** on the **My account** page, under *Bank details* (`self.service`). It is saved the same way and appears on the Bank page with an *Added by employee* badge.
- **Never in full on screen or in an API response.** Only the last four digits are returned. Replacing an account means typing the number again, twice; pasting into the second box is blocked.
- **Never in logs or the audit trail.** Request bodies are not logged. Audit entries record the holder, the last four digits and the IFSC, and audit redaction also removes any `accountNumber` field.
- **In full only in the bank file.** That file is sent with `Cache-Control: no-store` and is not kept on the server.

### Generating the file

- **When:** only for **finalised** payroll.
- **Who is paid:** each employee with net pay above zero, for their net pay.
- **Missing bank details:** these employees are listed, and the file is refused until you either add their details or tick **leave them out of this file**.
- **Record of each file:**
  - Each generated file is recorded in `bank_exports`: who generated it, when, the number of employees, how many were left out, and the file's SHA-256.
  - The table is append-only, enforced by a database trigger.
  - The audit entry has no amounts or account numbers.

### File layout

- **Settings:** format (CSV or XLSX), header row on or off, date format, and any columns in any order. A column can be:
  - employee ID or name,
  - account holder,
  - account number,
  - IFSC or bank name,
  - net pay,
  - payment date,
  - a "Salary <month year>" narration,
  - fixed text (for example a transaction type).
- **CSV format:** UTF-8 without a byte-order mark, CRLF line endings. Cells are quoted when needed, and cells that start with `=`, `+`, `-` or `@` are neutralised.
- **The default layout is generic.** Set the columns exactly as your bank's bulk-payment format specifies, and test a file with the bank before the first live upload.

## 3. Live attendance sync

**Where:** Configuration → **Attendance sync** (`integrations.manage`).

### How it works

1. **Create an API key** and give it to whoever configures the attendance application.
   - The key is shown once.
   - Only its SHA-256 hash is stored.
   - It can be revoked at any time.
2. **Map fields:** each attendance field name, for example `present_days`, goes to a payroll input column, for example *Days worked*.
3. **Switch on** *Accept attendance*. Optionally switch on *Apply straight away*.
4. **The attendance application sends** each month's data:

   ```http
   POST /integrations/attendance
   Authorization: Bearer nzatt_xxxxxxxx.<secret>
   Content-Type: application/json

   { "batchId": "2026-10-run-1", "year": 2026, "month": 10,
     "records": [ { "employeeCode": "E-001", "values": { "present_days": 22, "lop_days": 1 } } ] }
   ```

   | Response | Meaning |
   |---|---|
   | 202 | Received |
   | 401 | Missing, unknown or revoked key |
   | 409 | Sync is switched off |
   | 400 | Invalid body |

   A repeated `batchId` is accepted only once; repeating it returns the original result. One request can carry up to 5,000 employees.

5. **Received batches** are listed with their status:

   | Status | Meaning |
   |---|---|
   | Waiting to apply | Received, not yet written to payroll |
   | Applied | Every value was written |
   | Applied with problems | Some values were written, some were refused |
   | Not applied | Nothing could be written |

   **Review** shows exactly which cells applying would write. It also lists unknown employees and fields that are not mapped. **Apply to payroll** writes the values. It needs `payroll.input` as well as `integrations.manage`.

### Safeguards

- **Same validation as the grid:** values are written through the monthly-input validation, so they get the same number formats and minimum/maximum checks as typing them in. A calculated run goes back to draft.
- **Locked months stay locked:** attendance is never applied to a month that is under review, approved or finalised. The batch stays *Waiting to apply* and shows the reason.
- **Inbound only:** the payroll application makes **no outbound calls**. The attendance application sends data to it.
- **Cookie sessions keep CSRF protection:** this endpoint is exempt from the browser Origin check only when it carries a `Bearer` key. Browsers cannot attach that header cross-site.
- **Audit:**
  - receiving a batch writes `attendance.received`;
  - applying writes `attendance.applied`;
  - key changes write `integration_key.created` and `integration_key.revoked`.

## Database

Migration `20261016180000_statutory_bank_attendance` adds:

- `employee_bank_accounts`:
  - one row per employee;
  - the account number is stored encrypted;
  - check constraints on the format of the last four digits and of the encrypted value.
- `bank_exports`: append-only, enforced by a trigger.
- `integration_keys`: only the hash of each key is stored.
- `attendance_batches`:
  - unique per key and `batchId`;
  - check constraints on month and status.

The statutory, bank-layout and attendance-sync settings are stored in `payroll_settings`.

## Tests

- **Integration tests:** `test/integration/statutory-bank-attendance.test.ts` (19 tests).
- **Unit tests:** `test/unit/statutory-bank.test.ts` (6 tests) covers the tax slabs, the rebate, blocking while a section is off, payment-date formats and CSV escaping.
