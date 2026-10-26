-- AlterTable
ALTER TABLE "families" ADD COLUMN     "is_test_account" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "last_active_at" TIMESTAMP(3),
ADD COLUMN     "reengagement_paused_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "last_active_at" TIMESTAMP(3),
ADD COLUMN     "reengagement_opt_out_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "family_activity_days" (
    "family_id" TEXT NOT NULL,
    "day" DATE NOT NULL,

    CONSTRAINT "family_activity_days_pkey" PRIMARY KEY ("family_id","day")
);

-- CreateTable
CREATE TABLE "reengagement_emails" (
    "id" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "track" TEXT NOT NULL,
    "step" INTEGER NOT NULL,
    "anchor_at" TIMESTAMP(3) NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recipients" INTEGER NOT NULL,
    "sent_by" TEXT,
    "returned_at" TIMESTAMP(3),

    CONSTRAINT "reengagement_emails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "family_activity_days_day_idx" ON "family_activity_days"("day");

-- CreateIndex
CREATE INDEX "reengagement_emails_sent_at_idx" ON "reengagement_emails"("sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "reengagement_emails_family_id_track_anchor_at_step_key" ON "reengagement_emails"("family_id", "track", "anchor_at", "step");

-- AddForeignKey
ALTER TABLE "family_activity_days" ADD CONSTRAINT "family_activity_days_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reengagement_emails" ADD CONSTRAINT "reengagement_emails_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Backfill ────────────────────────────────────────────────────────────────
-- Rebuild activity history from what the database already records, so the charts and the lifecycle
-- stages are meaningful on day one instead of starting empty. Every source below is a moment someone
-- in the family demonstrably used the app. Idempotent: re-running adds nothing.
CREATE TEMP TABLE _tb_activity (family_id TEXT, user_id TEXT, at TIMESTAMP(3));

INSERT INTO _tb_activity (family_id, user_id, at)
  SELECT f.id, NULL, f.created_at FROM families f
  UNION ALL
  SELECT u.family_id, u.id, u.created_at FROM users u
   WHERE u.family_id IS NOT NULL AND u.role = 'parent'
  UNION ALL
  SELECT u.family_id, u.id, u.last_login_at FROM users u
   WHERE u.family_id IS NOT NULL AND u.role <> 'admin' AND u.last_login_at IS NOT NULL
  UNION ALL
  SELECT c.family_id, c.id, ta.completed_at FROM task_assignments ta JOIN users c ON c.id = ta.child_id
   WHERE ta.completed_at IS NOT NULL AND c.family_id IS NOT NULL
  UNION ALL
  SELECT c.family_id, ta.approved_by, ta.approved_at FROM task_assignments ta JOIN users c ON c.id = ta.child_id
   WHERE ta.approved_at IS NOT NULL AND c.family_id IS NOT NULL
  UNION ALL
  SELECT c.family_id, c.id, g.started_at FROM game_sessions g JOIN users c ON c.id = g.child_id
   WHERE c.family_id IS NOT NULL
  UNION ALL
  SELECT c.family_id, c.id, r.created_at FROM reward_redemptions r JOIN users c ON c.id = r.child_id
   WHERE c.family_id IS NOT NULL
  UNION ALL
  SELECT e.family_id, NULL, e.created_at FROM analytics_events e
   WHERE e.family_id IS NOT NULL AND e.actor_role IN ('parent', 'child');

INSERT INTO "family_activity_days" ("family_id", "day")
  SELECT DISTINCT a.family_id, a.at::date
    FROM _tb_activity a JOIN families f ON f.id = a.family_id
ON CONFLICT DO NOTHING;

UPDATE families f SET last_active_at = m.at
  FROM (SELECT family_id, max(at) AS at FROM _tb_activity GROUP BY family_id) m
 WHERE m.family_id = f.id;

UPDATE users u SET last_active_at = m.at
  FROM (SELECT user_id, max(at) AS at FROM _tb_activity WHERE user_id IS NOT NULL GROUP BY user_id) m
 WHERE m.user_id = u.id;

DROP TABLE _tb_activity;

-- Families on the closed-test roster start as test accounts (excluded from KPIs, never emailed).
-- The admin family page can switch any of them back.
UPDATE families SET is_test_account = true
 WHERE id IN (
   SELECT u.family_id FROM testers t
     JOIN users u ON u.id = t.user_id OR lower(u.email) = lower(t.email)
    WHERE u.family_id IS NOT NULL
 );
