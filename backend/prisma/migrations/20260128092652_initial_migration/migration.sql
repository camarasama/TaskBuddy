-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('parent', 'child', 'admin');

-- CreateEnum
CREATE TYPE "AgeGroup" AS ENUM ('10-12', '13-16');

-- CreateEnum
CREATE TYPE "TaskDifficulty" AS ENUM ('easy', 'medium', 'hard');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('active', 'paused', 'archived');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('pending', 'in_progress', 'completed', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('earned', 'redeemed', 'bonus', 'penalty', 'adjustment');

-- CreateEnum
CREATE TYPE "RewardTier" AS ENUM ('small', 'medium', 'large');

-- CreateEnum
CREATE TYPE "AchievementTier" AS ENUM ('bronze', 'silver', 'gold', 'platinum');

-- CreateEnum
CREATE TYPE "RedemptionStatus" AS ENUM ('pending', 'approved', 'fulfilled', 'cancelled');

-- CreateEnum
CREATE TYPE "EvidenceType" AS ENUM ('photo', 'note', 'video');

-- CreateEnum
CREATE TYPE "ModerationStatus" AS ENUM ('pending', 'approved', 'flagged', 'rejected');

-- CreateTable
CREATE TABLE "families" (
    "id" TEXT NOT NULL,
    "family_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "families_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "email" TEXT,
    "username" TEXT,
    "password_hash" TEXT,
    "role" "UserRole" NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "avatar_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "locked_until" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "child_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "date_of_birth" DATE NOT NULL,
    "age_group" "AgeGroup",
    "pin_hash" TEXT,
    "points_balance" INTEGER NOT NULL DEFAULT 0,
    "total_points_earned" INTEGER NOT NULL DEFAULT 0,
    "total_tasks_completed" INTEGER NOT NULL DEFAULT 0,
    "current_streak_days" INTEGER NOT NULL DEFAULT 0,
    "longest_streak_days" INTEGER NOT NULL DEFAULT 0,
    "last_streak_date" DATE,
    "level" INTEGER NOT NULL DEFAULT 1,
    "experience_points" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "child_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_templates" (
    "id" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "difficulty" "TaskDifficulty",
    "suggested_points" INTEGER NOT NULL DEFAULT 10,
    "estimated_minutes" INTEGER,
    "age_range" TEXT,
    "requires_photo_evidence" BOOLEAN NOT NULL DEFAULT false,
    "is_system_template" BOOLEAN NOT NULL DEFAULT false,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "template_id" TEXT,
    "created_by" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "difficulty" "TaskDifficulty",
    "points_value" INTEGER NOT NULL DEFAULT 10,
    "due_date" TIMESTAMP(3),
    "requires_photo_evidence" BOOLEAN NOT NULL DEFAULT false,
    "is_recurring" BOOLEAN NOT NULL DEFAULT false,
    "recurrence_pattern" TEXT,
    "recurrence_config" JSONB,
    "auto_approve" BOOLEAN NOT NULL DEFAULT false,
    "status" "TaskStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_assignments" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "child_id" TEXT NOT NULL,
    "instance_date" DATE NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'pending',
    "completed_at" TIMESTAMP(3),
    "approved_at" TIMESTAMP(3),
    "approved_by" TEXT,
    "rejection_reason" TEXT,
    "points_awarded" INTEGER,
    "xp_awarded" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_evidence" (
    "id" TEXT NOT NULL,
    "assignment_id" TEXT NOT NULL,
    "evidenceType" "EvidenceType" NOT NULL,
    "file_url" TEXT,
    "file_key" TEXT,
    "file_size_bytes" INTEGER,
    "mime_type" TEXT,
    "thumbnail_url" TEXT,
    "note" TEXT,
    "moderation_status" "ModerationStatus" NOT NULL DEFAULT 'pending',
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "points_ledger" (
    "id" TEXT NOT NULL,
    "child_id" TEXT NOT NULL,
    "transaction_type" "TransactionType" NOT NULL,
    "points_amount" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "reference_type" TEXT,
    "reference_id" TEXT,
    "description" TEXT,
    "breakdown" JSONB,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "points_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rewards" (
    "id" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "points_cost" INTEGER NOT NULL,
    "tier" "RewardTier",
    "icon_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "max_redemptions_per_child" INTEGER,
    "expires_at" TIMESTAMP(3),
    "is_collaborative" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "rewards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_redemptions" (
    "id" TEXT NOT NULL,
    "reward_id" TEXT NOT NULL,
    "child_id" TEXT NOT NULL,
    "points_spent" INTEGER NOT NULL,
    "status" "RedemptionStatus" NOT NULL DEFAULT 'pending',
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "fulfilled_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reward_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "achievements" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon_url" TEXT,
    "category" TEXT,
    "unlock_criteria_type" TEXT,
    "unlock_criteria_value" INTEGER,
    "unlock_criteria_config" JSONB,
    "tier" "AchievementTier",
    "is_system_achievement" BOOLEAN NOT NULL DEFAULT true,
    "points_reward" INTEGER NOT NULL DEFAULT 0,
    "xp_reward" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "achievements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "child_achievements" (
    "id" TEXT NOT NULL,
    "child_id" TEXT NOT NULL,
    "achievement_id" TEXT NOT NULL,
    "unlocked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "progress_value" INTEGER,

    CONSTRAINT "child_achievements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_challenges" (
    "id" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "challenge_date" DATE NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "challenge_type" TEXT,
    "criteria" JSONB,
    "bonus_points" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "challenge_completions" (
    "id" TEXT NOT NULL,
    "challenge_id" TEXT NOT NULL,
    "child_id" TEXT NOT NULL,
    "completed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bonus_points_awarded" INTEGER,

    CONSTRAINT "challenge_completions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "notification_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "action_url" TEXT,
    "reference_type" TEXT,
    "reference_id" TEXT,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "family_settings" (
    "id" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "auto_approve_recurring_tasks" BOOLEAN NOT NULL DEFAULT false,
    "enable_daily_challenges" BOOLEAN NOT NULL DEFAULT true,
    "enable_leaderboard" BOOLEAN NOT NULL DEFAULT false,
    "streak_grace_period_hours" INTEGER NOT NULL DEFAULT 4,
    "notification_preferences" JSONB NOT NULL DEFAULT '{"task_assigned":true,"task_due_soon":true,"task_completed":true,"reward_unlocked":true,"achievement_unlocked":true,"streak_at_risk":true}',
    "theme" TEXT NOT NULL DEFAULT 'default',
    "language" TEXT NOT NULL DEFAULT 'en',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "family_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_family_id_idx" ON "users"("family_id");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "users_username_idx" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "child_profiles_user_id_key" ON "child_profiles"("user_id");

-- CreateIndex
CREATE INDEX "child_profiles_user_id_idx" ON "child_profiles"("user_id");

-- CreateIndex
CREATE INDEX "task_templates_family_id_idx" ON "task_templates"("family_id");

-- CreateIndex
CREATE INDEX "task_templates_category_idx" ON "task_templates"("category");

-- CreateIndex
CREATE INDEX "tasks_family_id_idx" ON "tasks"("family_id");

-- CreateIndex
CREATE INDEX "tasks_due_date_idx" ON "tasks"("due_date");

-- CreateIndex
CREATE INDEX "tasks_status_idx" ON "tasks"("status");

-- CreateIndex
CREATE INDEX "tasks_category_idx" ON "tasks"("category");

-- CreateIndex
CREATE INDEX "task_assignments_task_id_idx" ON "task_assignments"("task_id");

-- CreateIndex
CREATE INDEX "task_assignments_child_id_idx" ON "task_assignments"("child_id");

-- CreateIndex
CREATE INDEX "task_assignments_status_idx" ON "task_assignments"("status");

-- CreateIndex
CREATE INDEX "task_assignments_instance_date_idx" ON "task_assignments"("instance_date");

-- CreateIndex
CREATE UNIQUE INDEX "task_assignments_task_id_child_id_instance_date_key" ON "task_assignments"("task_id", "child_id", "instance_date");

-- CreateIndex
CREATE INDEX "task_evidence_assignment_id_idx" ON "task_evidence"("assignment_id");

-- CreateIndex
CREATE INDEX "points_ledger_child_id_idx" ON "points_ledger"("child_id");

-- CreateIndex
CREATE INDEX "points_ledger_created_at_idx" ON "points_ledger"("created_at");

-- CreateIndex
CREATE INDEX "points_ledger_transaction_type_idx" ON "points_ledger"("transaction_type");

-- CreateIndex
CREATE INDEX "rewards_family_id_idx" ON "rewards"("family_id");

-- CreateIndex
CREATE INDEX "rewards_is_active_idx" ON "rewards"("is_active");

-- CreateIndex
CREATE INDEX "rewards_tier_idx" ON "rewards"("tier");

-- CreateIndex
CREATE INDEX "reward_redemptions_reward_id_idx" ON "reward_redemptions"("reward_id");

-- CreateIndex
CREATE INDEX "reward_redemptions_child_id_idx" ON "reward_redemptions"("child_id");

-- CreateIndex
CREATE INDEX "reward_redemptions_status_idx" ON "reward_redemptions"("status");

-- CreateIndex
CREATE INDEX "achievements_category_idx" ON "achievements"("category");

-- CreateIndex
CREATE INDEX "achievements_tier_idx" ON "achievements"("tier");

-- CreateIndex
CREATE INDEX "child_achievements_child_id_idx" ON "child_achievements"("child_id");

-- CreateIndex
CREATE INDEX "child_achievements_unlocked_at_idx" ON "child_achievements"("unlocked_at");

-- CreateIndex
CREATE UNIQUE INDEX "child_achievements_child_id_achievement_id_key" ON "child_achievements"("child_id", "achievement_id");

-- CreateIndex
CREATE INDEX "daily_challenges_family_id_idx" ON "daily_challenges"("family_id");

-- CreateIndex
CREATE INDEX "daily_challenges_challenge_date_idx" ON "daily_challenges"("challenge_date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_challenges_family_id_challenge_date_key" ON "daily_challenges"("family_id", "challenge_date");

-- CreateIndex
CREATE INDEX "challenge_completions_challenge_id_idx" ON "challenge_completions"("challenge_id");

-- CreateIndex
CREATE INDEX "challenge_completions_child_id_idx" ON "challenge_completions"("child_id");

-- CreateIndex
CREATE UNIQUE INDEX "challenge_completions_challenge_id_child_id_key" ON "challenge_completions"("challenge_id", "child_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_idx" ON "notifications"("user_id");

-- CreateIndex
CREATE INDEX "notifications_is_read_idx" ON "notifications"("is_read");

-- CreateIndex
CREATE INDEX "notifications_created_at_idx" ON "notifications"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "family_settings_family_id_key" ON "family_settings"("family_id");

-- CreateIndex
CREATE INDEX "family_settings_family_id_idx" ON "family_settings"("family_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child_profiles" ADD CONSTRAINT "child_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_templates" ADD CONSTRAINT "task_templates_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_templates" ADD CONSTRAINT "task_templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "task_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_assignments" ADD CONSTRAINT "task_assignments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_assignments" ADD CONSTRAINT "task_assignments_child_id_fkey" FOREIGN KEY ("child_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_assignments" ADD CONSTRAINT "task_assignments_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_evidence" ADD CONSTRAINT "task_evidence_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "task_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_child_id_fkey" FOREIGN KEY ("child_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rewards" ADD CONSTRAINT "rewards_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rewards" ADD CONSTRAINT "rewards_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_redemptions" ADD CONSTRAINT "reward_redemptions_reward_id_fkey" FOREIGN KEY ("reward_id") REFERENCES "rewards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_redemptions" ADD CONSTRAINT "reward_redemptions_child_id_fkey" FOREIGN KEY ("child_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child_achievements" ADD CONSTRAINT "child_achievements_child_id_fkey" FOREIGN KEY ("child_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child_achievements" ADD CONSTRAINT "child_achievements_achievement_id_fkey" FOREIGN KEY ("achievement_id") REFERENCES "achievements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_challenges" ADD CONSTRAINT "daily_challenges_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_completions" ADD CONSTRAINT "challenge_completions_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "daily_challenges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_completions" ADD CONSTRAINT "challenge_completions_child_id_fkey" FOREIGN KEY ("child_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_settings" ADD CONSTRAINT "family_settings_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;
