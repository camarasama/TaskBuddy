-- AlterTable
ALTER TABLE "users" ADD COLUMN     "is_primary_parent" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "family_invitations" (
    "id" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "invited_by_user_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "family_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "family_invitations_token_key" ON "family_invitations"("token");

-- CreateIndex
CREATE INDEX "family_invitations_family_id_idx" ON "family_invitations"("family_id");

-- CreateIndex
CREATE INDEX "family_invitations_token_idx" ON "family_invitations"("token");

-- CreateIndex
CREATE INDEX "family_invitations_email_idx" ON "family_invitations"("email");

-- AddForeignKey
ALTER TABLE "family_invitations" ADD CONSTRAINT "family_invitations_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_invitations" ADD CONSTRAINT "family_invitations_invited_by_user_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
