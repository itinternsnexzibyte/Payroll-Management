-- CreateEnum
CREATE TYPE "EpfoEcrReturnType" AS ENUM ('REGULAR', 'SUPPLEMENTARY', 'REVISED');

-- CreateEnum
CREATE TYPE "EpfoEcrStatus" AS ENUM ('GENERATED', 'UPLOADED', 'PAID', 'REJECTED');

-- CreateTable
CREATE TABLE "epfo_ecr_returns" (
    "id" UUID NOT NULL,
    "payrollRunId" UUID NOT NULL,
    "returnType" "EpfoEcrReturnType" NOT NULL,
    "contributionRate" DECIMAL(5,2) NOT NULL,
    "status" "EpfoEcrStatus" NOT NULL DEFAULT 'GENERATED',
    "recordCount" INTEGER NOT NULL,
    "records" JSONB NOT NULL,
    "validation" JSONB NOT NULL,
    "fileKey" TEXT NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "trrn" VARCHAR(30),
    "challanNumber" VARCHAR(50),
    "paymentReference" TEXT,
    "uploadResult" JSONB,
    "generatedById" UUID,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "epfo_ecr_returns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "epfo_ecr_returns_payrollRunId_generatedAt_idx" ON "epfo_ecr_returns"("payrollRunId", "generatedAt");

-- CreateIndex
CREATE INDEX "epfo_ecr_returns_status_idx" ON "epfo_ecr_returns"("status");

-- AddForeignKey
ALTER TABLE "epfo_ecr_returns" ADD CONSTRAINT "epfo_ecr_returns_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "payroll_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
