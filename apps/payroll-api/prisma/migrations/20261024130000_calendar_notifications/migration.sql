CREATE TABLE "calendar_events" (
    "id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "eventDate" DATE NOT NULL,
    "eventTime" VARCHAR(5),
    "color" VARCHAR(7) NOT NULL DEFAULT '#f3c440',
    "employeeId" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "employee_notifications" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "message" TEXT NOT NULL,
    "kind" VARCHAR(30) NOT NULL,
    "targetUrl" VARCHAR(500),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "employee_notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "calendar_events_eventDate_eventTime_idx" ON "calendar_events"("eventDate", "eventTime");
CREATE INDEX "calendar_events_employeeId_eventDate_idx" ON "calendar_events"("employeeId", "eventDate");
CREATE INDEX "employee_notifications_employeeId_readAt_createdAt_idx" ON "employee_notifications"("employeeId", "readAt", "createdAt");

ALTER TABLE "calendar_events"
ADD CONSTRAINT "calendar_events_employeeId_fkey"
FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "employee_notifications"
ADD CONSTRAINT "employee_notifications_employeeId_fkey"
FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
