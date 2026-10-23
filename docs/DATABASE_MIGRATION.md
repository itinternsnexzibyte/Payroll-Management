# HR Database Migration and Data Preservation

## No automatic cross-database migration

The HR repository contains SQLAlchemy models with integer IDs and can be configured for MySQL;
Payroll uses Prisma/PostgreSQL with UUID IDs and different employee, user, attendance, and payroll
models. The HR source code repository does not contain a verified production database export or its
private storage files. Therefore no live records can be safely migrated from code alone.

Do not point Prisma at the HR database, run `create_all` against it, overwrite it, or remove its
tables/files. Keep a database backup and the matching storage directory before any transfer.

## Required migration inputs

Before data import, obtain:

1. A consistent full database backup/export from the source HR database, including schema, row
   counts, and the export timestamp.
2. A copy of the source private storage directory and a manifest of file metadata/checksums.
3. Written confirmation of which source tables and records should move, retention requirements,
   and who may access sensitive documents and attendance location histories.
4. A mapping for each source employee/intern ID to a canonical Payroll employee UUID. Match using
   a verified employee code or an approved identity-matching process; do not match on names alone.
5. An explicit account-linking decision. Do not import JWT sessions or passwords/hashes; issue
   password reset/invitation flows using Payroll authentication.
6. A reviewed, approved transformation for any historical payroll JSON files, their statuses,
   formulas, rounding, currency, and existing PDF/document artifacts.

## Safe migration stages

1. Preserve the original backup and storage copy as read-only; compute and retain file checksums.
2. Load a copy of the export into a separate staging database, not the production Payroll database.
3. Produce a dry-run mapping report with source/target counts, unmatched/ambiguous identities,
   duplicate candidate records, invalid references, and files that failed checksum validation.
4. Resolve every ambiguous identity and invalid relationship with the data owner. Never silently
   drop or merge records.
5. Import in a transaction using deterministic source-system identifiers and an idempotency key.
   Keep source IDs in explicit mapping columns/tables so retries cannot create duplicate employees.
6. Verify record counts, relationships, constraints, and a sampled set of documents/history against
   the original backup. Compare payroll history as stored snapshots; do not recalculate it.
7. Obtain approval, take a fresh production backup, then run the reviewed import during a controlled
   maintenance window. Retain an import report and a tested rollback/restore procedure.

## Conflicts identified from source code

- HR `users`, `interns`, `employees`, and `attendance` use integer identities; Payroll uses UUID
  employees/users and a one-account-to-one-employee link.
- HR attendance separates daily records, work sessions, breaks, and optional GPS points. Payroll
  has a daily attendance record and a separate monthly sync batch. These are not interchangeable.
- HR payroll is stored in per-intern JSON files and computes with Python `float`/`round`; Payroll
  uses PostgreSQL-decimal salary and finalized payroll records. HR JSON cannot be replayed as
  current inputs without changing historical meaning.
- HR file metadata references filenames in local storage. Copying rows without their files would
  create broken document links; copying files without an approved access policy could expose PII.
- HR user hashes are Argon2 while Payroll hashes are managed by its own auth library. Existing
  sessions are incompatible and should not be transferred.

## Current status

No production HR export, database, or file storage has been imported. No existing Payroll data was
modified or deleted. A future importer must be implemented and tested only after the migration
inputs and identity/data policies above are provided.
