UPDATE "countries"
SET "config" = jsonb_set("config"::jsonb, '{activationFeeMinor}', '1000'::jsonb)
WHERE COALESCE(("config"::jsonb ->> 'activationFeeMinor')::bigint, 0) = 0;
