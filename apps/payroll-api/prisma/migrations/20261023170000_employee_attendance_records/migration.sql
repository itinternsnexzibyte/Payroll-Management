CREATE TYPE "AttendanceRecordStatus" AS ENUM ('PRESENT', 'ABSENT', 'LEAVE');

CREATE TABLE "employee_attendance_records" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "attendanceDate" DATE NOT NULL,
    "loginTime" VARCHAR(5),
    "logoutTime" VARCHAR(5),
    "status" "AttendanceRecordStatus" NOT NULL DEFAULT 'PRESENT',
    "workingMinutes" INTEGER,
    "createdById" UUID,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_attendance_records_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "employee_attendance_records_working_minutes_chk" CHECK ("workingMinutes" IS NULL OR "workingMinutes" BETWEEN 0 AND 1440),
    CONSTRAINT "employee_attendance_records_login_time_chk" CHECK ("loginTime" IS NULL OR "loginTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
    CONSTRAINT "employee_attendance_records_logout_time_chk" CHECK ("logoutTime" IS NULL OR "logoutTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
    CONSTRAINT "employee_attendance_records_time_order_chk" CHECK ("loginTime" IS NULL OR "logoutTime" IS NULL OR "logoutTime" >= "loginTime")
);

CREATE UNIQUE INDEX "employee_attendance_records_employeeId_attendanceDate_key"
ON "employee_attendance_records"("employeeId", "attendanceDate");

CREATE INDEX "employee_attendance_records_attendanceDate_idx"
ON "employee_attendance_records"("attendanceDate");

ALTER TABLE "employee_attendance_records"
ADD CONSTRAINT "employee_attendance_records_employeeId_fkey"
FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
