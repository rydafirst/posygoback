CREATE TYPE "assistant_outcome" AS ENUM ('ANSWERED', 'UNSURE', 'LIMITED', 'FAILED');

CREATE TABLE "assistant_questions" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "user_id" uuid,
  "page" varchar(300) NOT NULL,
  "question" varchar(500) NOT NULL,
  "outcome" "assistant_outcome" NOT NULL,
  "input_tokens" integer NOT NULL DEFAULT 0,
  "output_tokens" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "assistant_questions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "assistant_questions_tokens_positive" CHECK ("input_tokens" >= 0 AND "output_tokens" >= 0)
);
CREATE INDEX "assistant_questions_created_idx" ON "assistant_questions" ("created_at");
CREATE INDEX "assistant_questions_outcome_idx" ON "assistant_questions" ("outcome", "created_at");
