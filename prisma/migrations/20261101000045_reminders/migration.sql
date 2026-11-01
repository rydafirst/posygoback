CREATE TABLE "reminder_settings" (
    "key" VARCHAR(40) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "delays_days" INTEGER[],
    "subject" VARCHAR(120),
    "body" VARCHAR(2000),
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reminder_settings_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "reminder_sends" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" VARCHAR(40) NOT NULL,
    "subject_id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "episode_at" TIMESTAMPTZ(6) NOT NULL,
    "step" INTEGER NOT NULL,
    "sent_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    CONSTRAINT "reminder_sends_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "reminder_sends_step_unique" ON "reminder_sends"("key", "subject_id", "episode_at", "step");
CREATE INDEX "reminder_sends_email_idx" ON "reminder_sends"("email", "sent_at");
CREATE INDEX "reminder_sends_key_idx" ON "reminder_sends"("key", "sent_at");

CREATE TABLE "reminder_opt_outs" (
    "email" VARCHAR(254) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reminder_opt_outs_pkey" PRIMARY KEY ("email")
);
