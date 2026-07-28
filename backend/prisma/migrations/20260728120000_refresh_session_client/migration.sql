-- P0-4: record which client opened a refresh session.
--
-- The parent-facing "sign out my kid's phone" screen lists live sessions, and a parent cannot make
-- a sensible choice from a user-agent string alone — React Native's fetch reports something like
-- "okhttp/4.9.2", which says nothing a parent would recognise. This column carries the X-Client
-- value ("taskbuddy-android/1.0.0") so a session can be labelled "Android app" rather than guessed
-- at.
--
-- Nullable with no default and no backfill: every pre-existing session, and every browser session
-- from here on, legitimately has no client string. NULL means "web", which is exactly how the
-- absent X-Client header is already interpreted everywhere else.

ALTER TABLE "refresh_sessions"
  ADD COLUMN "client" TEXT;
