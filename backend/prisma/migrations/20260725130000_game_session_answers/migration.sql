-- Per-question answers for game sessions.
--
-- Additive and nullable: existing in-progress rows read as "no answers yet" and are graded by the
-- legacy all-or-nothing path until they expire (max 60 min), so this is safe to apply live.
--
-- The column is what makes the per-question reveal safe: an answer is committed here BEFORE the
-- correct option is returned, and a second answer to the same question is rejected. Without stored
-- state a child could call the answer endpoint once per option to find the right one.
ALTER TABLE "game_sessions" ADD COLUMN "answers_json" JSONB;
