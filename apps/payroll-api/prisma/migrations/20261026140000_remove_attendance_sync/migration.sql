-- Attendance sync (inbound API from the attendance application) is removed.
-- The daily attendance register and "Attendance to payroll" stay; their column mapping moves from
-- the attendanceSync setting to its own attendancePayrollMap setting.
INSERT INTO "payroll_settings" ("key", "value", "updatedAt", "updatedById")
SELECT 'attendancePayrollMap',
       COALESCE(
         (SELECT jsonb_agg(f)
            FROM jsonb_array_elements("value"::jsonb -> 'fieldMap') AS f
           WHERE f ->> 'source' IN ('present_days', 'absent_days', 'leave_days', 'late_days', 'worked_hours', 'overtime_hours')),
         '[]'::jsonb),
       CURRENT_TIMESTAMP,
       "updatedById"
FROM "payroll_settings"
WHERE "key" = 'attendanceSync'
ON CONFLICT ("key") DO NOTHING;

DELETE FROM "payroll_settings" WHERE "key" = 'attendanceSync';

-- The permission that managed the sync no longer exists.
DELETE FROM "role_permissions" WHERE "permissionCode" = 'integrations.manage';

DROP TABLE "attendance_batches";
DROP TABLE "integration_keys";
