ALTER TABLE "products" ADD COLUMN "created_by_id" uuid;
ALTER TABLE "products" ADD CONSTRAINT "products_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
CREATE INDEX "products_created_by_idx" ON "products" ("created_by_id");

UPDATE "products" AS p
SET "created_by_id" = created."actor_id"
FROM (
  SELECT DISTINCT ON ("resource_id") "resource_id", "actor_id"
  FROM "audit_log_entries"
  WHERE "resource_type" = 'product' AND "action" = 'product.created' AND "actor_id" IS NOT NULL
  ORDER BY "resource_id", "sequence"
) AS created
WHERE created."resource_id" = p."id"::text
  AND EXISTS (SELECT 1 FROM "users" AS u WHERE u."id" = created."actor_id");
