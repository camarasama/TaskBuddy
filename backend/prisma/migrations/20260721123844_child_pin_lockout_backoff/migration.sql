-- AlterTable
ALTER TABLE "users" ADD COLUMN     "failed_pin_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "last_failed_pin_at" TIMESTAMP(3);
