-- Additive, then destructive (CLEAN-231): agent access lists and personal pins.
-- UserAgentAccess: one row per account whose access was ever edited; no row
-- means "not limited, no entries", so every existing account reaches exactly
-- the agents it reached before. UserAgentAccessEntry: one row per account and
-- agent, carrying the list it is on, so an agent cannot be on both.
-- AgentPin: one row per account and agent it pinned.
-- Then Agent.pinned is dropped: the installation-wide pin ceases to exist and
-- its marks are discarded on purpose; every account starts with no pins. That
-- step is not reversible. No backfill anywhere.

-- CreateTable
CREATE TABLE "UserAgentAccess" (
    "userId" TEXT NOT NULL,
    "limited" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserAgentAccess_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "UserAgentAccessEntry" (
    "userId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "list" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserAgentAccessEntry_pkey" PRIMARY KEY ("userId","agentId")
);

-- CreateTable
CREATE TABLE "AgentPin" (
    "userId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentPin_pkey" PRIMARY KEY ("userId","agentId")
);

-- CreateIndex
CREATE INDEX "UserAgentAccessEntry_agentId_idx" ON "UserAgentAccessEntry"("agentId");

-- CreateIndex
CREATE INDEX "AgentPin_agentId_idx" ON "AgentPin"("agentId");

-- AddForeignKey
ALTER TABLE "UserAgentAccessEntry" ADD CONSTRAINT "UserAgentAccessEntry_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentPin" ADD CONSTRAINT "AgentPin_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Agent" DROP COLUMN "pinned";
