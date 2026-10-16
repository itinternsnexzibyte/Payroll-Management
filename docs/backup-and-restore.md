# Backup and restore

The specification requires a **daily automated backup and a tested restore**. Who owns backups
is still an open question. Back up:

- the PostgreSQL database `payroll`
- the API's `STORAGE_DIR` (stored payslip PDFs; these can be regenerated from finalised snapshots,
  but backing them up preserves the exact documents issued)

## Daily backup

```bash
#!/bin/sh
# /etc/cron.daily/payroll-backup — keeps 30 days
set -e
STAMP=$(date +%Y%m%d-%H%M); DEST=/var/backups/payroll; mkdir -p "$DEST"
pg_dump --format=custom --no-owner --dbname="postgresql://backup_user@db-host:5432/payroll" > "$DEST/payroll-$STAMP.dump"
tar -czf "$DEST/files-$STAMP.tar.gz" -C /var/lib/docker/volumes payroll-management_payroll-files
find "$DEST" -type f -mtime +30 -delete
```

Windows (Task Scheduler):

```powershell
$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
& 'C:\Program Files\PostgreSQL\17\bin\pg_dump.exe' --format=custom --no-owner --dbname="postgresql://backup_user@localhost:5432/payroll" --file="D:\backups\payroll-$stamp.dump"
```

Copy backups off the server and encrypt them: they contain salary data.

## Restore and restore test

```bash
createdb --host=db-host restore_check
pg_restore --no-owner --dbname=postgresql://admin@db-host:5432/restore_check payroll-YYYYMMDD-HHMM.dump
psql postgresql://admin@db-host:5432/restore_check -c "select count(*) from payroll_runs;"
# real restore: point DATABASE_URL at the restored database (or rename it) and restart the API
```

Restore the matching storage archive as well. Record every restore test (date, backup used,
checks performed, result).
