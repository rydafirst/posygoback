UPDATE "fee_schedules"
SET "schedule" = jsonb_set("schedule", '{partner,foundingPlaces}', '1')
WHERE "status" IN ('ACTIVE', 'PROPOSED') AND "schedule" ? 'partner' AND ("schedule" -> 'partner' ->> 'foundingPlaces')::int > 1;

UPDATE "fee_schedules"
SET "schedule" = jsonb_set("schedule", '{partner,holdbackDays}', '30')
WHERE "status" IN ('ACTIVE', 'PROPOSED') AND "schedule" ? 'partner' AND ("schedule" -> 'partner' ->> 'holdbackDays')::int > 30;
