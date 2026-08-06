-- Closed-test tester roster (Play production-access requirement: 12+ testers, 14 consecutive days).
--
-- Additive only: one new table and one new enum. No existing table is touched, so this is safe to
-- apply ahead of the code that reads it, and rolling the code back leaves an unused table rather
-- than a broken one.

CREATE TYPE "TesterStatus" AS ENUM ('invited', 'opted_in', 'active', 'declined');

CREATE TABLE "testers" (
    "id" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "status" "TesterStatus" NOT NULL DEFAULT 'invited',
    "user_id" TEXT,
    "invited_at" TIMESTAMP(3),
    "last_reminded_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "testers_pkey" PRIMARY KEY ("id")
);

-- The email is the join key to `users`, so a duplicate would make the activity view ambiguous.
CREATE UNIQUE INDEX "testers_email_key" ON "testers"("email");

-- One-to-one with users. Postgres treats NULLs as distinct, so any number of not-yet-signed-up
-- testers coexist under this index.
CREATE UNIQUE INDEX "testers_user_id_key" ON "testers"("user_id");

CREATE INDEX "testers_status_idx" ON "testers"("status");

-- SET NULL, not CASCADE: deleting a user account must not delete the recruitment record. Who was
-- asked to test, and when, is a fact about the closed test rather than about the account.
ALTER TABLE "testers" ADD CONSTRAINT "testers_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
