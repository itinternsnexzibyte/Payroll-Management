ALTER TABLE "users"
ADD COLUMN "attendanceEnabled" BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TYPE "AttendanceAccessRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "attendance_work_sessions" (
    "id" UUID NOT NULL,
    "attendanceRecordId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "lastHeartbeatAt" TIMESTAMP(3),
    "forcedCheckout" BOOLEAN NOT NULL DEFAULT FALSE,
    "checkoutReason" VARCHAR(100),
    "locationConsent" BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT "attendance_work_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "attendance_breaks" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    CONSTRAINT "attendance_breaks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "attendance_locations" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "latitude" DECIMAL(10,7) NOT NULL,
    "longitude" DECIMAL(10,7) NOT NULL,
    "accuracyMeters" DECIMAL(9,2),
    "distanceFromStart" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "distanceFromPrev" DECIMAL(12,2) NOT NULL DEFAULT 0,
    CONSTRAINT "attendance_locations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "attendance_access_requests" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "sessionId" UUID,
    "reason" TEXT NOT NULL,
    "status" "AttendanceAccessRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    CONSTRAINT "attendance_access_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "attendance_work_sessions_attendanceRecordId_startedAt_idx"
ON "attendance_work_sessions"("attendanceRecordId", "startedAt");
CREATE INDEX "attendance_work_sessions_employeeId_endedAt_idx"
ON "attendance_work_sessions"("employeeId", "endedAt");
CREATE UNIQUE INDEX "attendance_work_sessions_one_active_per_employee"
ON "attendance_work_sessions"("employeeId") WHERE "endedAt" IS NULL;
CREATE INDEX "attendance_breaks_sessionId_startedAt_idx"
ON "attendance_breaks"("sessionId", "startedAt");
CREATE UNIQUE INDEX "attendance_breaks_one_active_per_session"
ON "attendance_breaks"("sessionId") WHERE "endedAt" IS NULL;
CREATE INDEX "attendance_locations_sessionId_capturedAt_idx"
ON "attendance_locations"("sessionId", "capturedAt");
CREATE INDEX "attendance_access_requests_employeeId_createdAt_idx"
ON "attendance_access_requests"("employeeId", "createdAt");
CREATE INDEX "attendance_access_requests_status_createdAt_idx"
ON "attendance_access_requests"("status", "createdAt");
CREATE UNIQUE INDEX "attendance_access_requests_one_pending_per_employee"
ON "attendance_access_requests"("employeeId") WHERE "status" = 'PENDING';

ALTER TABLE "attendance_work_sessions"
ADD CONSTRAINT "attendance_work_sessions_attendanceRecordId_fkey"
FOREIGN KEY ("attendanceRecordId") REFERENCES "employee_attendance_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance_work_sessions"
ADD CONSTRAINT "attendance_work_sessions_employeeId_fkey"
FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_breaks"
ADD CONSTRAINT "attendance_breaks_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "attendance_work_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance_locations"
ADD CONSTRAINT "attendance_locations_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "attendance_work_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance_access_requests"
ADD CONSTRAINT "attendance_access_requests_employeeId_fkey"
FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_access_requests"
ADD CONSTRAINT "attendance_access_requests_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "attendance_work_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
