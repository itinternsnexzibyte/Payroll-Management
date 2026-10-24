CREATE TYPE "EmployeeDocumentCategory" AS ENUM ('OFFER_LETTER', 'PROFILE_PHOTO', 'OTHER');

CREATE TABLE "employee_workforce_profiles" (
    "employeeId" UUID NOT NULL,
    "teamsId" VARCHAR(150),
    "college" VARCHAR(200),
    "course" VARCHAR(150),
    "internshipRole" VARCHAR(150),
    "durationMonths" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "employee_workforce_profiles_pkey" PRIMARY KEY ("employeeId")
);

CREATE TABLE "employee_ratings" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "feedback" TEXT,
    "ratingDate" DATE NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "employee_ratings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "employee_ratings_rating_check" CHECK ("rating" BETWEEN 1 AND 5)
);

CREATE TABLE "employee_documents" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "category" "EmployeeDocumentCategory" NOT NULL,
    "originalName" VARCHAR(255) NOT NULL,
    "storedName" VARCHAR(100) NOT NULL,
    "contentType" VARCHAR(100) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "employee_documents_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "employee_documents_sizeBytes_check" CHECK ("sizeBytes" > 0 AND "sizeBytes" <= 5242880)
);

CREATE UNIQUE INDEX "employee_documents_storedName_key" ON "employee_documents"("storedName");
CREATE INDEX "employee_documents_employeeId_category_createdAt_idx" ON "employee_documents"("employeeId", "category", "createdAt");
CREATE UNIQUE INDEX "employee_ratings_employeeId_ratingDate_key" ON "employee_ratings"("employeeId", "ratingDate");
CREATE INDEX "employee_ratings_ratingDate_idx" ON "employee_ratings"("ratingDate");

ALTER TABLE "employee_workforce_profiles"
ADD CONSTRAINT "employee_workforce_profiles_employeeId_fkey"
FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "employee_ratings"
ADD CONSTRAINT "employee_ratings_employeeId_fkey"
FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "employee_documents"
ADD CONSTRAINT "employee_documents_employeeId_fkey"
FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
