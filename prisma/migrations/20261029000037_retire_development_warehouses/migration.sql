UPDATE "warehouses"
SET "active" = false, "updated_at" = now()
WHERE "code" IN ('GB-DEV-1', 'US-DEV-1') AND "partner_id" IS NULL;
