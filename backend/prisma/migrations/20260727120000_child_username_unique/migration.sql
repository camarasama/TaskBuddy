-- Child usernames: mandatory per child, unique per family.
--
-- The bug this closes: childLogin resolved a child with findFirst() matching
-- `firstName OR username`, and `username` had no unique constraint of any kind. Two children in
-- one family sharing a first name therefore resolved to whichever row Postgres returned first.
-- The second child's PIN was compared against the first child's hash, so she could never log in,
-- and every attempt called recordFailedLogin() against her SIBLING's account — eventually
-- locking out a child who had done nothing.
--
-- Scope note: the column stays NULLable because `users` also holds parents and admins, who sign
-- in with email and legitimately have no username. Mandatory-for-children is enforced at the API
-- boundary, not by the column. Postgres treats NULLs as distinct in a unique index, so any number
-- of parents can coexist with NULL usernames.
--
-- Uniqueness is (family_id, username), NOT global. The old application-level check was global,
-- which meant one family taking "sam" blocked every other family from ever using it.

-- 1. Normalise existing usernames. Writes already lowercase (AuthService.addChild and the update
--    route both do), but anything created before that was consistent would defeat a case-sensitive
--    unique index.
UPDATE "users"
SET "username" = LOWER("username")
WHERE "username" IS NOT NULL
  AND "username" <> LOWER("username");

-- 2. Backfill every child that has no username, deriving one from their first name and resolving
--    collisions within the family. A loop rather than a window function because each candidate
--    must be checked against usernames that already exist AND against ones assigned earlier in
--    this same backfill.
DO $$
DECLARE
  rec       RECORD;
  base      TEXT;
  candidate TEXT;
  n         INT;
BEGIN
  FOR rec IN
    SELECT "id", "family_id", "first_name"
    FROM "users"
    WHERE "role" = 'child'
      AND "username" IS NULL
      AND "deleted_at" IS NULL
    ORDER BY "created_at", "id"
  LOOP
    -- Match the API's own rule: ^[a-zA-Z0-9_]+$, 3..20 chars. Accented or non-Latin names can
    -- reduce to fewer than 3 usable characters, hence the pad, and to nothing at all, hence 'kid'.
    base := REGEXP_REPLACE(LOWER(rec."first_name"), '[^a-z0-9_]', '', 'g');
    IF base IS NULL OR LENGTH(base) = 0 THEN
      base := 'kid';
    END IF;
    IF LENGTH(base) < 3 THEN
      base := RPAD(base, 3, '0');
    END IF;
    base := LEFT(base, 20);

    candidate := base;
    n := 1;
    WHILE EXISTS (
      SELECT 1 FROM "users" u
      WHERE u."family_id" IS NOT DISTINCT FROM rec."family_id"
        AND u."username" = candidate
    ) LOOP
      n := n + 1;
      -- Trim the base so base+suffix still fits the 20-char ceiling.
      candidate := LEFT(base, 20 - LENGTH(n::text)) || n::text;
    END LOOP;

    UPDATE "users" SET "username" = candidate WHERE "id" = rec."id";
  END LOOP;
END $$;

-- 3. Enforce it. Soft-deleted children keep their row and therefore keep holding their username;
--    that matches the previous behaviour (the old global check did not filter on deleted_at
--    either), so this is not a new restriction.
CREATE UNIQUE INDEX "users_family_id_username_key" ON "users"("family_id", "username");
