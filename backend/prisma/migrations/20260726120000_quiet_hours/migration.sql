-- U16: quiet hours / schooltime mode (growth roadmap §6, §11 binding guardrail).
--
-- Additive and defaulted, so every existing row gets the feature switched OFF: this ships silent
-- and changes nothing until a parent opts a child in.
--
-- Times are HH:MM in the FAMILY's timezone (family_settings.timezone), never UTC — a window
-- evaluated in the wrong zone silences the wrong hours.
ALTER TABLE "users"
  ADD COLUMN "quiet_hours_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "quiet_hours_start"   TEXT    NOT NULL DEFAULT '20:00',
  ADD COLUMN "quiet_hours_end"     TEXT    NOT NULL DEFAULT '07:00',
  ADD COLUMN "schooltime_enabled"  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "schooltime_start"    TEXT    NOT NULL DEFAULT '08:30',
  ADD COLUMN "schooltime_end"      TEXT    NOT NULL DEFAULT '15:30',
  -- ISO weekday numbers, 1 = Monday .. 7 = Sunday. Defaults to the school week.
  ADD COLUMN "schooltime_days"     INTEGER[] NOT NULL DEFAULT ARRAY[1, 2, 3, 4, 5];
