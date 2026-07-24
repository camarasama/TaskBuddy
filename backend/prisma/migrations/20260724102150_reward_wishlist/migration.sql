-- CreateTable
CREATE TABLE "reward_wishlists" (
    "id" TEXT NOT NULL,
    "reward_id" TEXT NOT NULL,
    "child_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reward_wishlists_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reward_wishlists_reward_id_idx" ON "reward_wishlists"("reward_id");

-- CreateIndex
CREATE INDEX "reward_wishlists_child_id_idx" ON "reward_wishlists"("child_id");

-- CreateIndex
CREATE UNIQUE INDEX "reward_wishlists_reward_id_child_id_key" ON "reward_wishlists"("reward_id", "child_id");

-- AddForeignKey
ALTER TABLE "reward_wishlists" ADD CONSTRAINT "reward_wishlists_reward_id_fkey" FOREIGN KEY ("reward_id") REFERENCES "rewards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_wishlists" ADD CONSTRAINT "reward_wishlists_child_id_fkey" FOREIGN KEY ("child_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
