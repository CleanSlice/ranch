-- Additive (CLEAN-224): request limits per agent and per-minute load counts.
-- AgentLimit: one row per agent that has limits; no row means limits are off,
-- which is every agent until someone sets them. AgentLoadMinute: counts per
-- agent per minute, for restart survival, the last-hour chart and the 30-day
-- peaks. Safe on a live database: two new tables, nothing existing is touched.

-- CreateTable
CREATE TABLE "AgentLimit" (
    "agentId" TEXT NOT NULL,
    "perMinute" INTEGER,
    "perHour" INTEGER,
    "perDay" INTEGER,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentLimit_pkey" PRIMARY KEY ("agentId")
);

-- CreateTable
CREATE TABLE "AgentLoadMinute" (
    "agentId" TEXT NOT NULL,
    "minute" TIMESTAMP(3) NOT NULL,
    "accepted" INTEGER NOT NULL DEFAULT 0,
    "refused" INTEGER NOT NULL DEFAULT 0,
    "refusedByMinute" INTEGER NOT NULL DEFAULT 0,
    "refusedByHour" INTEGER NOT NULL DEFAULT 0,
    "refusedByDay" INTEGER NOT NULL DEFAULT 0,
    "exempt" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AgentLoadMinute_pkey" PRIMARY KEY ("agentId","minute")
);


-- CreateIndex
CREATE INDEX "AgentLoadMinute_minute_idx" ON "AgentLoadMinute"("minute");

-- AddForeignKey
ALTER TABLE "AgentLimit" ADD CONSTRAINT "AgentLimit_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentLoadMinute" ADD CONSTRAINT "AgentLoadMinute_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
