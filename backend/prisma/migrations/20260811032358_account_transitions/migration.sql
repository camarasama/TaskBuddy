-- NOTE: `prisma migrate dev` also wanted to emit two DROP INDEX statements here, for
-- reward_wishlists_child_id_is_goal_idx and task_templates_is_system_template_idx. They were
-- REMOVED deliberately.
--
-- Both indexes exist in the database from earlier migrations but are no longer declared in
-- schema.prisma, i.e. pre-existing drift that predates this work. Dropping indexes changes query
-- plans on production, and doing that as a side effect of adding an unrelated table is how a
-- feature migration becomes a performance incident. The drift is real and should be resolved on
-- purpose, in its own change, with someone watching the query timings.
--
-- Consequence: a future `migrate dev` will propose these drops again until that happens.

-- CreateTable
CREATE TABLE "account_transitions" (
    "id" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "child_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "decision" TEXT,
    "transfer_to_child_id" TEXT,
    "points_at_detection" INTEGER NOT NULL DEFAULT 0,
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadline_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "account_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "account_transitions_child_id_key" ON "account_transitions"("child_id");

-- CreateIndex
CREATE INDEX "account_transitions_status_deadline_at_idx" ON "account_transitions"("status", "deadline_at");

-- AddForeignKey
ALTER TABLE "account_transitions" ADD CONSTRAINT "account_transitions_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_transitions" ADD CONSTRAINT "account_transitions_child_id_fkey" FOREIGN KEY ("child_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
