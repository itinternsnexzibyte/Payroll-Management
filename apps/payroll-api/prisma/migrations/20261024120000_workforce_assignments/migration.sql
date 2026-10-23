CREATE TYPE "WorkAssignmentStatus" AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE "WorkSubmissionStatus" AS ENUM ('SUBMITTED', 'NEEDS_CHANGES', 'ACCEPTED');

CREATE TABLE "work_assignments" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "dueDate" DATE,
    "status" "WorkAssignmentStatus" NOT NULL DEFAULT 'OPEN',
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "work_assignments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "work_submissions" (
    "id" UUID NOT NULL,
    "assignmentId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "submissionText" TEXT,
    "submissionUrl" VARCHAR(500),
    "status" "WorkSubmissionStatus" NOT NULL DEFAULT 'SUBMITTED',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" UUID,
    "reviewerFeedback" TEXT,
    CONSTRAINT "work_submissions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "work_assignments_employeeId_status_idx" ON "work_assignments"("employeeId", "status");
CREATE INDEX "work_assignments_dueDate_idx" ON "work_assignments"("dueDate");
CREATE UNIQUE INDEX "work_submissions_assignmentId_revision_key" ON "work_submissions"("assignmentId", "revision");
CREATE INDEX "work_submissions_assignmentId_submittedAt_idx" ON "work_submissions"("assignmentId", "submittedAt");

ALTER TABLE "work_assignments"
ADD CONSTRAINT "work_assignments_employeeId_fkey"
FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "work_submissions"
ADD CONSTRAINT "work_submissions_assignmentId_fkey"
FOREIGN KEY ("assignmentId") REFERENCES "work_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
