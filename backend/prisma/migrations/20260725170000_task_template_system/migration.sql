-- System task templates (growth roadmap §3.1).
--
-- task_templates.family_id becomes nullable so a SYSTEM template (is_system_template = true) can
-- belong to no family. As required-and-cascading it contradicted its own is_system_template flag:
-- a shipped template would have been owned by one family and hard-deleted along with them.
--
-- Backwards compatible: no existing row changes, and family-authored templates still set family_id.
ALTER TABLE "task_templates" ALTER COLUMN "family_id" DROP NOT NULL;

-- System templates are read on every "browse templates" request and are not family-scoped, so the
-- existing family_id index does not serve them.
CREATE INDEX "task_templates_is_system_template_idx" ON "task_templates"("is_system_template");
