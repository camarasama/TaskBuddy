-- AlterTable
ALTER TABLE "users" ADD COLUMN     "mfa_enabled_at" TIMESTAMP(3),
ADD COLUMN     "mfa_secret" TEXT;
