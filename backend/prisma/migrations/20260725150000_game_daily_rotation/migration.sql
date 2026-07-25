-- Daily question rotation.
--
-- questions_per_session: how many questions one play serves. Defaults to 5, which is what every
-- existing definition served, so behaviour is unchanged for banks that are still 5 long.
--
-- served_questions_json: a SNAPSHOT of the questions a session actually served. It is a copy, not a
-- reference into the definition's bank, because the admin games editor can change a bank while a
-- session is in progress - re-deriving the draw at submit time would shift the question order and
-- silently misalign answers_json against it.
--
-- Both additive; the snapshot is nullable so sessions created before this read as "use the
-- definition's bank" and grade exactly as they did before.
ALTER TABLE "game_definitions" ADD COLUMN "questions_per_session" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "game_sessions" ADD COLUMN "served_questions_json" JSONB;
