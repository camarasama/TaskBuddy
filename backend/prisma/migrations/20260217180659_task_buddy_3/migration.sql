-- CreateEnum
CREATE TYPE "TaskTag" AS ENUM ('primary', 'secondary');

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "estimated_minutes" INTEGER,
ADD COLUMN     "start_time" TIMESTAMP(3),
ADD COLUMN     "task_tag" "TaskTag" NOT NULL DEFAULT 'primary';
