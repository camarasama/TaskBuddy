-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'milestone_bonus';

-- AlterTable
ALTER TABLE "child_profiles" ADD COLUMN     "total_xp_earned" INTEGER NOT NULL DEFAULT 0;
