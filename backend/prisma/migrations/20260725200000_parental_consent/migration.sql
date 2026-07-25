-- COPPA verifiable parental consent (growth roadmap §3.2 / §2.1).
--
-- Distinct from the existing CONSENT AuditLog events, which only record that ToS/privacy terms were
-- accepted. COPPA additionally requires a verification METHOD, and requires child data collection to
-- be blocked until verification completes. This table is what the child-creation gate reads.
--
-- One row per family (unique family_id): consent is given by a parent on behalf of the family's
-- children, and re-consent replaces rather than accumulates.
CREATE TABLE "parental_consents" (
    "id" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "parent_id" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    -- SHA-256 only; the raw token exists solely in the email.
    "token_hash" TEXT,
    "expires_at" TIMESTAMP(3),
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verified_at" TIMESTAMP(3),
    "ip_address" TEXT,
    "tos_version" TEXT NOT NULL,
    "privacy_version" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parental_consents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "parental_consents_family_id_key" ON "parental_consents"("family_id");
CREATE INDEX "parental_consents_status_idx" ON "parental_consents"("status");

ALTER TABLE "parental_consents" ADD CONSTRAINT "parental_consents_family_id_fkey"
    FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Setup wizard progress. Nullable: null means "not started", so existing families are unaffected.
ALTER TABLE "family_settings" ADD COLUMN "onboarding_state" JSONB;
