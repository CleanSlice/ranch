-- CLEAN-165: Slack bot transport. Additive, with three backfills so an
-- install that already has incidents and notifications comes out whole.

-- ── Destination: a kind, and the bot's two fields ───────────────────────
ALTER TABLE "AgentEventDestination" ADD COLUMN     "botToken" TEXT,
ADD COLUMN     "channelId" TEXT,
ALTER COLUMN "webhookUrl" DROP NOT NULL;

-- The only kind that existed was the incoming webhook, stored as 'slack'.
UPDATE "AgentEventDestination" SET "kind" = 'webhook' WHERE "kind" = 'slack';

-- ── Incident: number, transport, the bot's root, the outbox counter ─────
ALTER TABLE "AgentIncident" ADD COLUMN     "lastJoinedNotifiedAt" TIMESTAMP(3),
ADD COLUMN     "notificationSeq" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "number" SERIAL NOT NULL,
ADD COLUMN     "rootStale" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "slackChannel" TEXT,
ADD COLUMN     "slackReaction" TEXT,
ADD COLUMN     "slackTs" TEXT,
ADD COLUMN     "transport" TEXT;

-- SERIAL numbered the existing rows in physical order; people expect #1 to
-- be the oldest incident, so renumber by the moment each opened, then move
-- the sequence past the highest number handed out.
UPDATE "AgentIncident" AS i
SET "number" = ordered.n
FROM (
  SELECT id, row_number() OVER (ORDER BY "openedAt" ASC, id ASC) AS n
  FROM "AgentIncident"
) AS ordered
WHERE i.id = ordered.id;

SELECT setval(
  pg_get_serial_sequence('"AgentIncident"', 'number'),
  COALESCE((SELECT max("number") FROM "AgentIncident"), 0) + 1,
  false
);

CREATE UNIQUE INDEX "AgentIncident_number_key" ON "AgentIncident"("number");

-- Every existing incident was told about through the webhook, which was the
-- only transport; an incident with no destination at the time stays NULL.
UPDATE "AgentIncident" SET "transport" = 'webhook'
WHERE EXISTS (
  SELECT 1 FROM "AgentNotification" n
  WHERE n."incidentId" = "AgentIncident".id AND n.status <> 'skipped'
);

-- ── Outbox: a position inside the incident replaces "one per kind" ──────
DROP INDEX "AgentNotification_incidentId_kind_key";

ALTER TABLE "AgentNotification" ADD COLUMN "seq" INTEGER NOT NULL DEFAULT 0;

-- Before this migration an incident had at most an opening (first) and a
-- closing (second) row.
UPDATE "AgentNotification" SET "seq" = CASE "kind" WHEN 'opened' THEN 0 ELSE 1 END;

ALTER TABLE "AgentNotification" ALTER COLUMN "seq" DROP DEFAULT;

CREATE UNIQUE INDEX "AgentNotification_incidentId_seq_key" ON "AgentNotification"("incidentId", "seq");

-- The incident's counter continues from what it already has.
UPDATE "AgentIncident" AS i
SET "notificationSeq" = counted.c
FROM (
  SELECT "incidentId", count(*) AS c FROM "AgentNotification" GROUP BY "incidentId"
) AS counted
WHERE i.id = counted."incidentId";
