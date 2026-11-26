-- Statistics collection (CLEAN-261, spec 038). Additive, apart from one
-- constraint that is dropped; no row and no column is removed.
--
-- ChatActivityHour: messages per conversation per UTC hour. ChatSession keeps
-- lifetime totals only, so "messages in the last 30 days" had no source.
-- Written with the lifetime increment from now on; the past is filled by the
-- settle pass from transcripts (ChatSession.activityRebuiltAt marks who is
-- done).
--
-- AgentLoadDay: requests per agent per UTC day. The minute rows are pruned at
-- 30 days; these stay 400.
--
-- StatFigure: the first instant each figure is complete from.
--
-- Usage: the foreign key to Agent goes, so deleting an agent no longer deletes
-- what it spent, and the agent's name is kept on the row. Existing rows get
-- the name their agent has today.

-- DropForeignKey
ALTER TABLE "Usage" DROP CONSTRAINT "Usage_agentId_fkey";

-- AlterTable
ALTER TABLE "ChatSession" ADD COLUMN     "activityRebuiltAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Usage" ADD COLUMN     "agentName" TEXT;

-- Backfill: every existing usage row still has its agent (the constraint
-- dropped above cascaded until now).
UPDATE "Usage" u SET "agentName" = a."name" FROM "Agent" a WHERE a."id" = u."agentId";

-- CreateTable
CREATE TABLE "AgentLoadDay" (
    "agentId" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "accepted" INTEGER NOT NULL DEFAULT 0,
    "refused" INTEGER NOT NULL DEFAULT 0,
    "exempt" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AgentLoadDay_pkey" PRIMARY KEY ("agentId","day")
);

-- CreateTable
CREATE TABLE "ChatActivityHour" (
    "sessionId" TEXT NOT NULL,
    "hour" TIMESTAMP(3) NOT NULL,
    "agentId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "externalUserId" TEXT NOT NULL,
    "userMessages" INTEGER NOT NULL DEFAULT 0,
    "agentMessages" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ChatActivityHour_pkey" PRIMARY KEY ("sessionId","hour")
);

-- CreateTable
CREATE TABLE "StatFigure" (
    "key" TEXT NOT NULL,
    "completeSince" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StatFigure_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "AgentLoadDay_day_idx" ON "AgentLoadDay"("day");

-- CreateIndex
CREATE INDEX "ChatActivityHour_externalUserId_channel_hour_idx" ON "ChatActivityHour"("externalUserId", "channel", "hour");

-- CreateIndex
CREATE INDEX "ChatActivityHour_agentId_hour_idx" ON "ChatActivityHour"("agentId", "hour");

-- CreateIndex
CREATE INDEX "ChatActivityHour_hour_idx" ON "ChatActivityHour"("hour");

-- CreateIndex
CREATE INDEX "ChatSession_activityRebuiltAt_lastMessageAt_idx" ON "ChatSession"("activityRebuiltAt", "lastMessageAt");

-- AddForeignKey
ALTER TABLE "AgentLoadDay" ADD CONSTRAINT "AgentLoadDay_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatActivityHour" ADD CONSTRAINT "ChatActivityHour_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
