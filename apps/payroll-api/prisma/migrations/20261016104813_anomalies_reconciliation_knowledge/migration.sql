-- CreateEnum
CREATE TYPE "AnomalySeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "AnomalyStatus" AS ENUM ('OPEN', 'REVIEWED', 'CLEARED');

-- CreateEnum
CREATE TYPE "ReconciliationClass" AS ENUM ('EXPECTED', 'DISCREPANCY', 'RESOLVED');

-- CreateEnum
CREATE TYPE "KnowledgeCategory" AS ENUM ('PROCEDURE', 'COMPONENT', 'BUSINESS_RULE', 'VALIDATION_ERROR', 'ONBOARDING');

-- CreateEnum
CREATE TYPE "KnowledgeStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateTable
CREATE TABLE "payroll_anomalies" (
    "id" UUID NOT NULL,
    "payrollRunId" UUID NOT NULL,
    "employeeId" UUID,
    "employeeCode" TEXT,
    "employeeName" TEXT,
    "componentCode" TEXT,
    "rule" TEXT NOT NULL,
    "severity" "AnomalySeverity" NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "status" "AnomalyStatus" NOT NULL DEFAULT 'OPEN',
    "reviewOutcome" TEXT,
    "reviewComment" TEXT,
    "reviewedById" UUID,
    "reviewedByName" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastDetectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clearedAt" TIMESTAMP(3),

    CONSTRAINT "payroll_anomalies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_anomaly_events" (
    "id" UUID NOT NULL,
    "anomalyId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "comment" TEXT,
    "actorId" UUID,
    "actorName" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_anomaly_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_notes" (
    "id" UUID NOT NULL,
    "baseRunId" UUID NOT NULL,
    "compareRunId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "componentCode" TEXT NOT NULL DEFAULT '',
    "classification" "ReconciliationClass" NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "createdByName" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,
    "updatedByName" TEXT,

    CONSTRAINT "reconciliation_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_articles" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "category" "KnowledgeCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "componentCode" TEXT,
    "errorCode" TEXT,
    "status" "KnowledgeStatus" NOT NULL DEFAULT 'DRAFT',
    "clientConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "ownerId" UUID,
    "ownerName" TEXT,
    "reviewDueAt" DATE,
    "lastReviewedAt" TIMESTAMP(3),
    "lastReviewedBy" TEXT,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "knowledge_articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_article_versions" (
    "id" UUID NOT NULL,
    "articleId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "changeNote" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "createdByName" TEXT,

    CONSTRAINT "knowledge_article_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_checklist_items" (
    "id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "articleId" UUID,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_run_checklist" (
    "id" UUID NOT NULL,
    "payrollRunId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "doneById" UUID,
    "doneByName" TEXT,
    "doneAt" TIMESTAMP(3),

    CONSTRAINT "payroll_run_checklist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payroll_anomalies_payrollRunId_status_idx" ON "payroll_anomalies"("payrollRunId", "status");

-- CreateIndex
CREATE INDEX "payroll_anomalies_employeeId_idx" ON "payroll_anomalies"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_anomalies_payrollRunId_fingerprint_key" ON "payroll_anomalies"("payrollRunId", "fingerprint");

-- CreateIndex
CREATE INDEX "payroll_anomaly_events_anomalyId_occurredAt_idx" ON "payroll_anomaly_events"("anomalyId", "occurredAt");

-- CreateIndex
CREATE INDEX "reconciliation_notes_compareRunId_idx" ON "reconciliation_notes"("compareRunId");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_notes_baseRunId_compareRunId_employeeId_comp_key" ON "reconciliation_notes"("baseRunId", "compareRunId", "employeeId", "componentCode");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_articles_slug_key" ON "knowledge_articles"("slug");

-- CreateIndex
CREATE INDEX "knowledge_articles_category_idx" ON "knowledge_articles"("category");

-- CreateIndex
CREATE INDEX "knowledge_articles_componentCode_idx" ON "knowledge_articles"("componentCode");

-- CreateIndex
CREATE INDEX "knowledge_articles_errorCode_idx" ON "knowledge_articles"("errorCode");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_article_versions_articleId_version_key" ON "knowledge_article_versions"("articleId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_run_checklist_payrollRunId_itemId_key" ON "payroll_run_checklist"("payrollRunId", "itemId");

-- AddForeignKey
ALTER TABLE "payroll_anomalies" ADD CONSTRAINT "payroll_anomalies_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "payroll_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_anomalies" ADD CONSTRAINT "payroll_anomalies_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_anomaly_events" ADD CONSTRAINT "payroll_anomaly_events_anomalyId_fkey" FOREIGN KEY ("anomalyId") REFERENCES "payroll_anomalies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_notes" ADD CONSTRAINT "reconciliation_notes_baseRunId_fkey" FOREIGN KEY ("baseRunId") REFERENCES "payroll_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_notes" ADD CONSTRAINT "reconciliation_notes_compareRunId_fkey" FOREIGN KEY ("compareRunId") REFERENCES "payroll_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_notes" ADD CONSTRAINT "reconciliation_notes_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_article_versions" ADD CONSTRAINT "knowledge_article_versions_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "knowledge_articles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_checklist_items" ADD CONSTRAINT "payroll_checklist_items_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "knowledge_articles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_run_checklist" ADD CONSTRAINT "payroll_run_checklist_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "payroll_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_run_checklist" ADD CONSTRAINT "payroll_run_checklist_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "payroll_checklist_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Integrity rules (same approach as 20261015170000_integrity_triggers)

-- Knowledge article versions are an immutable history.
CREATE OR REPLACE FUNCTION knowledge_versions_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'knowledge_article_versions is append-only (% not permitted)', TG_OP USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_knowledge_versions_immutable
  BEFORE UPDATE OR DELETE ON "knowledge_article_versions"
  FOR EACH ROW EXECUTE FUNCTION knowledge_versions_immutable();

-- The anomaly review trail is append-only.
CREATE OR REPLACE FUNCTION anomaly_events_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'payroll_anomaly_events is append-only (% not permitted)', TG_OP USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_anomaly_events_append_only
  BEFORE UPDATE OR DELETE ON "payroll_anomaly_events"
  FOR EACH ROW EXECUTE FUNCTION anomaly_events_append_only();

-- A reconciliation compares two different runs.
ALTER TABLE "reconciliation_notes" ADD CONSTRAINT "reconciliation_notes_distinct_runs" CHECK ("baseRunId" <> "compareRunId");
