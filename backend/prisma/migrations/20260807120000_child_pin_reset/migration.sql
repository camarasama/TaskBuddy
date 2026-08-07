-- Child-initiated PIN reset (previously only a parent could reset a child's PIN, from
-- /parent/children — the "Reset PIN" modal). Adds the token columns a forgotten child needs.
--
-- Additive only: two new nullable columns on an existing table. No backfill, safe to apply ahead
-- of the code that reads it.
--
-- Mirrors users.password_reset_token_hash / users.password_reset_expires_at exactly: one column
-- pair, not a separate token table. A new reset request overwrites whatever token was there
-- before, which is what makes an old emailed link stop working the moment a new one is issued —
-- there is never more than one valid token per child at a time.
--
-- Not UNIQUE, deliberately. The anti-enumeration request handler (AuthService.requestChildPinReset)
-- always performs the same write — either to the real child's row or to a fixed, nonexistent
-- sentinel userId when no child matches — so a unique constraint here would be dead weight at best
-- and, if it ever collided with a real token by the collision-astronomically-unlikely coincidence
-- of two sha256 hashes matching, a hard failure at worst.
ALTER TABLE "child_profiles" ADD COLUMN "pin_reset_token_hash" TEXT;
ALTER TABLE "child_profiles" ADD COLUMN "pin_reset_expires_at" TIMESTAMP(3);
