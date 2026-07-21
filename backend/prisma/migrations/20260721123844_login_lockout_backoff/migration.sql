-- AlterTable
ALTER TABLE "users" ADD COLUMN     "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "last_failed_login_at" TIMESTAMP(3);
