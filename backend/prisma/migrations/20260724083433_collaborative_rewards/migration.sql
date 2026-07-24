-- AlterTable
ALTER TABLE "rewards" ADD COLUMN     "collaborative_fulfilled_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "reward_contributions" (
    "id" TEXT NOT NULL,
    "reward_id" TEXT NOT NULL,
    "child_id" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reward_contributions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reward_contributions_reward_id_idx" ON "reward_contributions"("reward_id");

-- CreateIndex
CREATE INDEX "reward_contributions_child_id_idx" ON "reward_contributions"("child_id");

-- AddForeignKey
ALTER TABLE "reward_contributions" ADD CONSTRAINT "reward_contributions_reward_id_fkey" FOREIGN KEY ("reward_id") REFERENCES "rewards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_contributions" ADD CONSTRAINT "reward_contributions_child_id_fkey" FOREIGN KEY ("child_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
