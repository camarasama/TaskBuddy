-- Child goal (growth roadmap §4.2).
--
-- FR-14's wishlist already captures which reward a child wants; this promotes one of those to a
-- pinned goal with a progress bar. That is why it is a flag on the existing table rather than a new
-- ChildGoal model — the roadmap costed one before the wishlist existed.
--
-- "At most one true per child" is not expressible as a unique index (multiple false rows are legal),
-- so it is enforced in GoalService by clearing the others in the same transaction.
ALTER TABLE "reward_wishlists" ADD COLUMN "is_goal" BOOLEAN NOT NULL DEFAULT false;

-- The goal lookup is per-child and highly selective.
CREATE INDEX "reward_wishlists_child_id_is_goal_idx" ON "reward_wishlists"("child_id", "is_goal");
