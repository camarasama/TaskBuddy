/*
  Warnings:

  - A unique constraint covering the columns `[family_code]` on the table `families` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "families" ADD COLUMN     "family_code" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "families_family_code_key" ON "families"("family_code");
