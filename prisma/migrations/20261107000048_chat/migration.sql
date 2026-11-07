CREATE TYPE "chat_side" AS ENUM ('CUSTOMER', 'TEAM');

CREATE TABLE "chat_threads" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "reference" VARCHAR(20) NOT NULL,
  "vendor_id" UUID,
  "partner_id" UUID,
  "country_code" CHAR(2) NOT NULL,
  "waiting_since" TIMESTAMPTZ(6),
  "customer_emailed_at" TIMESTAMPTZ(6),
  "last_message_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "chat_threads_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "chat_threads_one_account" CHECK (("vendor_id" IS NULL) <> ("partner_id" IS NULL))
);
CREATE UNIQUE INDEX "chat_threads_reference_key" ON "chat_threads"("reference");
CREATE UNIQUE INDEX "chat_threads_vendor_id_key" ON "chat_threads"("vendor_id");
CREATE UNIQUE INDEX "chat_threads_partner_id_key" ON "chat_threads"("partner_id");
CREATE INDEX "chat_threads_country_idx" ON "chat_threads"("country_code", "last_message_at");
CREATE INDEX "chat_threads_waiting_idx" ON "chat_threads"("waiting_since");
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "fulfilment_partners"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

CREATE TABLE "chat_messages" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "thread_id" UUID NOT NULL,
  "author_id" UUID,
  "side" "chat_side" NOT NULL,
  "client_id" UUID NOT NULL,
  "body" VARCHAR(2000) NOT NULL,
  "reply_to_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "chat_messages_client_unique" ON "chat_messages"("thread_id", "client_id");
CREATE INDEX "chat_messages_thread_idx" ON "chat_messages"("thread_id", "created_at");
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "chat_threads"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_reply_to_id_fkey" FOREIGN KEY ("reply_to_id") REFERENCES "chat_messages"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

CREATE TABLE "chat_reads" (
  "thread_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "side" "chat_side" NOT NULL,
  "read_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "chat_reads_pkey" PRIMARY KEY ("thread_id", "user_id")
);
CREATE INDEX "chat_reads_thread_side_idx" ON "chat_reads"("thread_id", "side", "read_at");
ALTER TABLE "chat_reads" ADD CONSTRAINT "chat_reads_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "chat_threads"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "chat_reads" ADD CONSTRAINT "chat_reads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
