-- "User" accounts are employees: they see only their own records (Employee self-service role).
-- One-time move of Payroll User accounts that are linked to an employee record onto the Employee
-- role. Staff accounts without an employee link keep Payroll User. Skipped when the Employee role
-- does not exist yet (fresh databases: roles are created by the API on start-up).
UPDATE "users"
SET "roleId" = (SELECT "id" FROM "roles" WHERE "code" = 'EMPLOYEE'),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "employeeId" IS NOT NULL
  AND "roleId" = (SELECT "id" FROM "roles" WHERE "code" = 'PAYROLL_USER')
  AND EXISTS (SELECT 1 FROM "roles" WHERE "code" = 'EMPLOYEE');
