-- Child-chosen profile photos, gated on parent approval.
--
-- Children could previously only pick an emoji avatar (FR-10), and that picker is a fixed
-- allow-list because the field is child-controlled and visible to the whole family. A photo cannot
-- be allow-listed, so the parent becomes the gate: the child's choice lands here, and only a parent
-- can promote it to users.avatar_url or clear it.
--
-- Nullable with no default: "no pending photo" is the normal state for every existing child.

ALTER TABLE "child_profiles"
  ADD COLUMN "pending_avatar_url" TEXT,
  ADD COLUMN "pending_avatar_at"  TIMESTAMP(3);
