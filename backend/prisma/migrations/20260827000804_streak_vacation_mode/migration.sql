-- Vacation mode (growth roadmap §11.2).
--
-- NOTE: `prisma migrate dev` also proposed dropping `reward_wishlists_child_id_is_goal_idx` and
-- `task_templates_is_system_template_idx`. Both were stripped: they are long-standing drift between
-- the schema file and the deployed database, unrelated to this feature, and dropping them would
-- change prod query plans for the wishlist and template lookups as a side effect of adding two
-- nullable columns. Do not re-add them here.
ALTER TABLE "child_profiles" ADD COLUMN     "streak_paused_from" DATE,
ADD COLUMN     "streak_paused_until" DATE;
