-- U17: team-up tasks (growth roadmap §6).
--
-- Additive and defaulted: every existing task is a normal, non-team task with a zero bonus, so this
-- ships inert. team_bonus_awarded_at is the exactly-once claim for the payout — see
-- TeamTaskService.awardTeamBonusIfComplete.
ALTER TABLE "tasks"
  ADD COLUMN "is_team_task"           BOOLEAN   NOT NULL DEFAULT false,
  ADD COLUMN "team_bonus_points"      INTEGER   NOT NULL DEFAULT 0,
  ADD COLUMN "team_bonus_awarded_at"  TIMESTAMP(3);
