-- CreateTable
CREATE TABLE "employee_bank_accounts" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "accountHolder" TEXT NOT NULL,
    "accountNumberEnc" TEXT NOT NULL,
    "accountLast4" TEXT NOT NULL,
    "ifsc" TEXT NOT NULL,
    "bankName" TEXT,
    "branch" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "employee_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_exports" (
    "id" UUID NOT NULL,
    "payrollRunId" UUID NOT NULL,
    "format" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "employeeCount" INTEGER NOT NULL,
    "skippedCount" INTEGER NOT NULL,
    "fileSha256" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_exports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_keys" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "integration_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_batches" (
    "id" UUID NOT NULL,
    "keyId" UUID,
    "externalId" TEXT,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "recordCount" INTEGER NOT NULL,
    "appliedCount" INTEGER NOT NULL DEFAULT 0,
    "records" JSONB NOT NULL,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "payrollRunId" UUID,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),
    "appliedById" UUID,

    CONSTRAINT "attendance_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employee_bank_accounts_employeeId_key" ON "employee_bank_accounts"("employeeId");

-- CreateIndex
CREATE INDEX "bank_exports_payrollRunId_idx" ON "bank_exports"("payrollRunId");

-- CreateIndex
CREATE UNIQUE INDEX "integration_keys_prefix_key" ON "integration_keys"("prefix");

-- CreateIndex
CREATE INDEX "attendance_batches_year_month_idx" ON "attendance_batches"("year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_batches_keyId_externalId_key" ON "attendance_batches"("keyId", "externalId");

-- AddForeignKey
ALTER TABLE "employee_bank_accounts" ADD CONSTRAINT "employee_bank_accounts_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_batches" ADD CONSTRAINT "attendance_batches_keyId_fkey" FOREIGN KEY ("keyId") REFERENCES "integration_keys"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Integrity
ALTER TABLE "employee_bank_accounts" ADD CONSTRAINT "employee_bank_accounts_last4_chk" CHECK (char_length("accountLast4") = 4);
ALTER TABLE "employee_bank_accounts" ADD CONSTRAINT "employee_bank_accounts_enc_chk" CHECK ("accountNumberEnc" LIKE 'v1:%');
ALTER TABLE "attendance_batches" ADD CONSTRAINT "attendance_batches_month_chk" CHECK ("month" BETWEEN 1 AND 12);
ALTER TABLE "attendance_batches" ADD CONSTRAINT "attendance_batches_status_chk" CHECK ("status" IN ('RECEIVED', 'APPLIED', 'PARTIAL', 'FAILED'));
ALTER TABLE "bank_exports" ADD CONSTRAINT "bank_exports_format_chk" CHECK ("format" IN ('CSV', 'XLSX'));

-- The record of generated bank files is append-only.
CREATE OR REPLACE FUNCTION bank_exports_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'bank_exports is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_bank_exports_append_only
  BEFORE UPDATE OR DELETE ON "bank_exports"
  FOR EACH ROW EXECUTE FUNCTION bank_exports_append_only();
