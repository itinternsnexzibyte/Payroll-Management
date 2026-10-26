-- Organisation structure, statutory identifiers, template-generated salary versions,
-- calculation summaries on payroll results and saved digital-twin scenarios.

ALTER TABLE "employees" ADD COLUMN "managerId" UUID;
ALTER TABLE "employees" ADD COLUMN "panNumber" VARCHAR(10);
ALTER TABLE "employees" ADD COLUMN "uanNumber" VARCHAR(12);
ALTER TABLE "employees" ADD COLUMN "pfNumber" VARCHAR(30);
ALTER TABLE "employees" ADD CONSTRAINT "employees_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employees" ADD CONSTRAINT "employees_manager_not_self" CHECK ("managerId" IS NULL OR "managerId" <> "id");
CREATE INDEX "employees_managerId_idx" ON "employees"("managerId");

ALTER TABLE "employee_salary_versions" ADD COLUMN "monthlyGross" DECIMAL(18,4);

ALTER TABLE "payroll_run_employees" ADD COLUMN "calcSummary" JSONB NOT NULL DEFAULT '{}';

CREATE TABLE "payroll_scenarios" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "config" JSONB NOT NULL,
    "createdById" UUID,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "payroll_scenarios_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "payroll_scenarios_createdAt_idx" ON "payroll_scenarios"("createdAt");
