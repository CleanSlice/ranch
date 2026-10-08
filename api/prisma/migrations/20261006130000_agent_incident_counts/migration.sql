-- Additive: the number of reports an incident holds and who sent them move
-- onto the AgentIncident row (CLEAN-139). The list of incidents is re-read
-- every few seconds by every open console; counting through AgentEvent made
-- that read grow with the history (160 ms a request at 60 000 reports). The
-- two columns are kept up to date as each report is attached. Also an index
-- for the all-agents list, newest first. Safe on an existing database: the
-- backfill below fills both columns from the events already stored.

-- AlterTable
ALTER TABLE "AgentIncident" ADD COLUMN     "eventCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "witnesses" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "AgentIncident_openedAt_idx" ON "AgentIncident"("openedAt");

-- Backfill: one row per incident with its report count and its senders in
-- the order each first reported.
UPDATE "AgentIncident" AS i
SET "eventCount" = agg.total,
    "witnesses" = agg.senders
FROM (
    SELECT s."incidentId",
           SUM(s.reports)::INTEGER AS total,
           ARRAY_AGG(s."senderName" ORDER BY s.first_at, s."senderName") AS senders
    FROM (
        SELECT "incidentId",
               "senderName",
               COUNT(*) AS reports,
               MIN("receivedAt") AS first_at
        FROM "AgentEvent"
        WHERE "incidentId" IS NOT NULL
        GROUP BY "incidentId", "senderName"
    ) AS s
    GROUP BY s."incidentId"
) AS agg
WHERE agg."incidentId" = i."id";
