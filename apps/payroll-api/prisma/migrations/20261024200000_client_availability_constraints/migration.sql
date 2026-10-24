ALTER TABLE "client_records"
ADD CONSTRAINT "client_records_availability_time_order_check"
CHECK ("availableFrom" IS NULL OR "availableTo" IS NULL OR "availableFrom" < "availableTo");

ALTER TABLE "client_records"
ADD CONSTRAINT "client_records_unavailable_has_no_hours_check"
CHECK ("availability" <> 'UNAVAILABLE' OR ("availableFrom" IS NULL AND "availableTo" IS NULL));
