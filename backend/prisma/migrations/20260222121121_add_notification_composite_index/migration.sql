-- DropIndex
DROP INDEX "notifications_created_at_idx";

-- DropIndex
DROP INDEX "notifications_is_read_idx";

-- DropIndex
DROP INDEX "notifications_user_id_idx";

-- CreateIndex
CREATE INDEX "notifications_user_id_is_read_created_at_idx" ON "notifications"("user_id", "is_read", "created_at" DESC);
