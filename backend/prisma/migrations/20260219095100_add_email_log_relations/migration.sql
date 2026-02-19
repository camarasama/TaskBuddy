-- CreateEnum
CREATE TYPE "EmailLogStatus" AS ENUM ('sent', 'failed', 'bounced');

-- AlterTable
ALTER TABLE "family_settings" ALTER COLUMN "notification_preferences" SET DEFAULT '{"task_submitted":true,"task_approved":true,"task_rejected":true,"task_expiring":true,"task_expired":true,"reward_redeemed":true,"level_up":true,"streak_at_risk":true,"welcome":true,"co_parent_invite":true}';

-- AlterTable
ALTER TABLE "task_assignments" ADD COLUMN     "email_sent_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "family_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "email_logs" (
    "id" TEXT NOT NULL,
    "to_email" TEXT NOT NULL,
    "to_user_id" TEXT,
    "family_id" TEXT,
    "trigger_type" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" "EmailLogStatus" NOT NULL DEFAULT 'sent',
    "error_message" TEXT,
    "reference_type" TEXT,
    "reference_id" TEXT,
    "resend_count" INTEGER NOT NULL DEFAULT 0,
    "last_resent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_logs_to_user_id_idx" ON "email_logs"("to_user_id");

-- CreateIndex
CREATE INDEX "email_logs_family_id_idx" ON "email_logs"("family_id");

-- CreateIndex
CREATE INDEX "email_logs_trigger_type_idx" ON "email_logs"("trigger_type");

-- CreateIndex
CREATE INDEX "email_logs_status_idx" ON "email_logs"("status");

-- CreateIndex
CREATE INDEX "email_logs_created_at_idx" ON "email_logs"("created_at");

-- CreateIndex
CREATE INDEX "task_assignments_email_sent_at_idx" ON "task_assignments"("email_sent_at");

-- AddForeignKey
ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_to_user_id_fkey" FOREIGN KEY ("to_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE SET NULL ON UPDATE CASCADE;
