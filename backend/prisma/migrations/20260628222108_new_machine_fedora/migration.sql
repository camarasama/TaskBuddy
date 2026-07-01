-- CreateEnum
CREATE TYPE "GameSessionStatus" AS ENUM ('in_progress', 'completed', 'failed', 'expired');

-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'game_reward';

-- AlterTable
ALTER TABLE "family_settings" ADD COLUMN     "auto_approve_max_ratio" DOUBLE PRECISION NOT NULL DEFAULT 3.0,
ADD COLUMN     "auto_approve_min_ratio" DOUBLE PRECISION NOT NULL DEFAULT 0.3,
ADD COLUMN     "max_game_points_per_day" INTEGER NOT NULL DEFAULT 100;

-- AlterTable
ALTER TABLE "task_assignments" ADD COLUMN     "auto_approve_overridden" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "auto_approve_override_reason" TEXT,
ADD COLUMN     "expiry_reminders_sent" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "started_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "max_claims_total" INTEGER;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "gender" TEXT;

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh_key" TEXT NOT NULL,
    "auth_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_definitions" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "difficulty" "TaskDifficulty" NOT NULL DEFAULT 'easy',
    "points_reward" INTEGER NOT NULL DEFAULT 20,
    "xp_reward" INTEGER NOT NULL DEFAULT 10,
    "cooldown_hours" INTEGER NOT NULL DEFAULT 24,
    "age_group" TEXT,
    "questions_json" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "game_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_sessions" (
    "id" TEXT NOT NULL,
    "child_id" TEXT NOT NULL,
    "game_definition_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "status" "GameSessionStatus" NOT NULL DEFAULT 'in_progress',
    "points_awarded" INTEGER NOT NULL DEFAULT 0,
    "xp_awarded" INTEGER NOT NULL DEFAULT 0,
    "solution_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscriptions_user_id_idx" ON "push_subscriptions"("user_id");

-- CreateIndex
CREATE INDEX "game_definitions_type_idx" ON "game_definitions"("type");

-- CreateIndex
CREATE INDEX "game_definitions_is_active_idx" ON "game_definitions"("is_active");

-- CreateIndex
CREATE INDEX "game_sessions_child_id_idx" ON "game_sessions"("child_id");

-- CreateIndex
CREATE INDEX "game_sessions_game_definition_id_idx" ON "game_sessions"("game_definition_id");

-- CreateIndex
CREATE INDEX "game_sessions_status_idx" ON "game_sessions"("status");

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_child_id_fkey" FOREIGN KEY ("child_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_game_definition_id_fkey" FOREIGN KEY ("game_definition_id") REFERENCES "game_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
