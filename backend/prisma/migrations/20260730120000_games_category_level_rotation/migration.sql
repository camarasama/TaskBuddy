-- Games redesign: category × level as the selection axes, plus the per-child rotation index.
--
-- STRICTLY ADDITIVE, and that is not a style preference. `game_sessions.game_definition_id` is
-- ON DELETE CASCADE, so dropping or replacing a game_definitions row deletes every child's history
-- for it and silently empties the games report. Columns are added and backfilled; nothing is removed.

-- CreateEnum
CREATE TYPE "GameCategory" AS ENUM ('maths', 'science', 'geography', 'vocabulary', 'grammar', 'puzzle');
CREATE TYPE "GameLevel" AS ENUM ('beginner', 'intermediate', 'hard');

-- Added nullable so existing rows survive the ALTER; made NOT NULL after the backfill below.
ALTER TABLE "game_definitions" ADD COLUMN "category" "GameCategory";
ALTER TABLE "game_definitions" ADD COLUMN "level" "GameLevel";

-- Backfill level from the legacy difficulty column.
UPDATE "game_definitions" SET "level" = CASE "difficulty"
    WHEN 'easy'   THEN 'beginner'::"GameLevel"
    WHEN 'medium' THEN 'intermediate'::"GameLevel"
    ELSE               'hard'::"GameLevel"
  END
  WHERE "level" IS NULL;

-- Backfill category from the title. The three seeded games are the only rows that can be mapped
-- reliably; anything an admin authored with an unrecognised title lands in 'puzzle' and must be
-- re-categorised in /admin/games. Flagged in the PR rather than guessed at.
UPDATE "game_definitions" SET "category" = CASE
    WHEN "title" ILIKE '%math%'     THEN 'maths'::"GameCategory"
    WHEN "title" ILIKE '%science%'  THEN 'science'::"GameCategory"
    WHEN "title" ILIKE '%geograph%' THEN 'geography'::"GameCategory"
    WHEN "title" ILIKE '%vocab%'    THEN 'vocabulary'::"GameCategory"
    WHEN "title" ILIKE '%grammar%'  THEN 'grammar'::"GameCategory"
    ELSE                                 'puzzle'::"GameCategory"
  END
  WHERE "category" IS NULL;

-- Align the display-only reward/cooldown columns with the new level and category, so the admin UI and
-- the API do not show numbers that disagree with what the award path actually pays. The award path
-- reads GAME_REWARDS / GAME_COOLDOWN_HOURS from shared, never these columns.
UPDATE "game_definitions" SET
    "points_reward" = CASE "level"
      WHEN 'beginner'     THEN 2
      WHEN 'intermediate' THEN 3
      ELSE                     4 END,
    "xp_reward" = CASE "level"
      WHEN 'beginner'     THEN 15
      WHEN 'intermediate' THEN 25
      ELSE                     40 END,
    "cooldown_hours" = CASE "category"
      WHEN 'maths'      THEN 8
      WHEN 'science'    THEN 8
      WHEN 'geography'  THEN 12
      WHEN 'vocabulary' THEN 6
      WHEN 'grammar'    THEN 6
      ELSE                   4 END;

ALTER TABLE "game_definitions" ALTER COLUMN "category" SET NOT NULL;
ALTER TABLE "game_definitions" ALTER COLUMN "level" SET NOT NULL;

-- Drop the age gates. The redesign lets a child pick any level at any age, with appropriateness carried
-- by the authored content rather than by hiding games. `seedGames()` skips rows that already exist
-- (`if (!existing)`), so without this the three live definitions would keep their old bands and the
-- decision would apply only to fresh installs.
--
-- Consequence worth stating: a 10-year-old can now open what was the 13-16 geography quiz. That content
-- is now labelled "Hard", which describes itself more honestly than a hidden gate did.
UPDATE "game_definitions" SET "age_group" = NULL WHERE "age_group" IS NOT NULL;

-- CreateTable: the per-child rotation index.
CREATE TABLE "game_question_seen" (
    "id" TEXT NOT NULL,
    "child_id" TEXT NOT NULL,
    "game_definition_id" TEXT NOT NULL,
    "question_id" TEXT NOT NULL,
    "seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "was_correct" BOOLEAN NOT NULL,

    CONSTRAINT "game_question_seen_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "game_question_seen_child_id_game_definition_id_question_id_key"
  ON "game_question_seen"("child_id", "game_definition_id", "question_id");

-- Drives the least-recently-seen recycle order once a bank is exhausted.
CREATE INDEX "game_question_seen_child_id_game_definition_id_seen_at_idx"
  ON "game_question_seen"("child_id", "game_definition_id", "seen_at");

-- The child-facing picker queries on both axes at once.
CREATE INDEX "game_definitions_category_level_is_active_idx"
  ON "game_definitions"("category", "level", "is_active");

ALTER TABLE "game_question_seen" ADD CONSTRAINT "game_question_seen_child_id_fkey"
  FOREIGN KEY ("child_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "game_question_seen" ADD CONSTRAINT "game_question_seen_game_definition_id_fkey"
  FOREIGN KEY ("game_definition_id") REFERENCES "game_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
