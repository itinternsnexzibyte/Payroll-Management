CREATE TYPE "ClientAvailability" AS ENUM ('AVAILABLE', 'UNAVAILABLE');
CREATE TYPE "ClientDocumentCategory" AS ENUM ('PHOTO', 'AADHAAR', 'MOU');

CREATE TABLE "client_records" (
    "id" UUID NOT NULL,
    "clientName" VARCHAR(200) NOT NULL,
    "phoneCountryCode" VARCHAR(10),
    "phoneNumber" VARCHAR(30),
    "country" VARCHAR(100),
    "stateRegion" VARCHAR(150),
    "city" VARCHAR(150),
    "address" TEXT,
    "availability" "ClientAvailability" NOT NULL DEFAULT 'AVAILABLE',
    "availableFrom" VARCHAR(5),
    "availableTo" VARCHAR(5),
    "referenceEmail" VARCHAR(255),
    "notes" TEXT,
    "createdById" UUID,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "client_records_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "client_documents" (
    "id" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "category" "ClientDocumentCategory" NOT NULL,
    "originalName" VARCHAR(255) NOT NULL,
    "storedName" VARCHAR(100) NOT NULL,
    "contentType" VARCHAR(100) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "client_documents_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "client_documents_sizeBytes_check" CHECK ("sizeBytes" > 0 AND "sizeBytes" <= 5242880)
);

CREATE UNIQUE INDEX "client_documents_storedName_key" ON "client_documents"("storedName");
CREATE INDEX "client_documents_clientId_category_createdAt_idx" ON "client_documents"("clientId", "category", "createdAt");
CREATE INDEX "client_records_clientName_idx" ON "client_records"("clientName");
CREATE INDEX "client_records_availability_idx" ON "client_records"("availability");

ALTER TABLE "client_documents"
ADD CONSTRAINT "client_documents_clientId_fkey"
FOREIGN KEY ("clientId") REFERENCES "client_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;
