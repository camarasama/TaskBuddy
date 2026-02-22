-- AlterTable
ALTER TABLE "achievements" ADD COLUMN     "xp_threshold" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "child_profiles" ADD COLUMN     "avatar_emoji" TEXT;

-- AlterTable
ALTER TABLE "family_invitations" ADD COLUMN     "cancelled_at" TIMESTAMP(3),
ADD COLUMN     "relationship" TEXT;
