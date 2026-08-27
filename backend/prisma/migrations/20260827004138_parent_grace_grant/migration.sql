-- Per-incident parent grace grant (growth roadmap §11.3).
--
-- NOTE: `prisma migrate dev` again proposed dropping `reward_wishlists_child_id_is_goal_idx` and
-- `task_templates_is_system_template_idx`. Both were stripped, for the same reason as in
-- 20260827000804_streak_vacation_mode: they are long-standing drift between the schema file and the
-- deployed database, unrelated to this feature, and dropping them would change prod query plans for
-- the wishlist and template lookups as a side effect of adding one nullable column.
ALTER TABLE "child_profiles" ADD COLUMN     "grace_granted_until" TIMESTAMP(3);
