-- Streak insurance (growth roadmap §4.3).
--
-- One freeze is earned each time the streak reaches a multiple of 7, capped at 2 banked, and spent
-- automatically to cover missed days instead of resetting the streak to 1.
--
-- Additive with a default, so every existing child starts at 0 and behaviour is unchanged until
-- they earn one.
ALTER TABLE "child_profiles" ADD COLUMN "streak_freezes" INTEGER NOT NULL DEFAULT 0;
