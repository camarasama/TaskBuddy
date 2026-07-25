-- Funnel instrumentation (growth roadmap 0b).
--
-- No foreign key to families ON PURPOSE: pre-signup events have no family, and the retention purge
-- hard-deletes families - a cascade would erase the funnel history the metrics are derived from.
-- Events are purged on their own age-based schedule (see RetentionService.purgeAnalyticsEvents).
CREATE TABLE "analytics_events" (
    "id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "family_id" TEXT,
    "actor_role" TEXT,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "analytics_events_event_type_created_at_idx" ON "analytics_events"("event_type", "created_at");
CREATE INDEX "analytics_events_family_id_created_at_idx" ON "analytics_events"("family_id", "created_at");
