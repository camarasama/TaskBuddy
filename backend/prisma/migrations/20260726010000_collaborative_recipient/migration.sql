-- Collaborative reward recipients + reporting (follow-up to FR-09).
--
-- FR-09 shipped contributions and once-only funding, but a funded collaborative reward never created
-- a reward_redemptions row. So it had no recorded recipient, no fulfilled/cancelled workflow, and was
-- invisible to R-03 (which reads that table) even though R-02 showed the points — the two reports
-- disagreed about the same event.
--
-- recipient_rule: 'shared' (default) or 'parent_choice'. Deliberately NOT last-contributor-wins,
-- which would reward timing over effort and push children to withhold points and snipe the final few.
ALTER TABLE "rewards" ADD COLUMN "recipient_rule" TEXT NOT NULL DEFAULT 'shared';

-- NULL means shared — nobody individually received it. Also true of every solo redemption.
ALTER TABLE "reward_redemptions" ADD COLUMN "recipient_child_id" TEXT;
