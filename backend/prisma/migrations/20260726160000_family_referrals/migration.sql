-- U20: cross-family referral loop (growth roadmap §7).
--
-- referral_code is deliberately SEPARATE from family_code: family_code admits a child to a family,
-- and a referral code is meant to be shared publicly. One field for both would make every shared
-- referral link an account-takeover vector.
--
-- Nullable rather than NOT NULL: existing families are backfilled below, but a null code simply
-- means "no referral link yet" rather than blocking the migration on a uniqueness collision.
ALTER TABLE "families"
  ADD COLUMN "referral_code"          TEXT,
  ADD COLUMN "referred_by_family_id"  TEXT;

-- Backfill every existing family with a code. Uppercase base-36 from a random uuid, 8 chars —
-- the same shape the application generator produces.
UPDATE "families"
SET "referral_code" = UPPER(SUBSTRING(REPLACE(gen_random_uuid()::text, '-', '') FROM 1 FOR 8))
WHERE "referral_code" IS NULL;

CREATE UNIQUE INDEX "families_referral_code_key" ON "families"("referral_code");
