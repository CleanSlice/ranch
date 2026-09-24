-- Additive: new table FileChangeProposal — a file change an agent proposed
-- through a confirm-gated file tool (CLEAN-112). Nothing is written to the
-- workspace until a row is applied; the proposed content lives in S3. One
-- row per proposal, cascades with the target agent. Safe on an existing
-- database.

-- CreateTable
CREATE TABLE "FileChangeProposal" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "chatAgentId" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'admin',
    "clientId" TEXT,
    "turnId" TEXT,
    "kind" TEXT NOT NULL,
    "op" TEXT NOT NULL,
    "path" TEXT,
    "baseEtag" TEXT,
    "contentKey" TEXT,
    "importId" TEXT,
    "mode" TEXT,
    "includeSessions" BOOLEAN NOT NULL DEFAULT false,
    "proposedBytes" INTEGER NOT NULL DEFAULT 0,
    "diffStatus" TEXT NOT NULL DEFAULT 'none',
    "additions" INTEGER,
    "deletions" INTEGER,
    "changedLines" INTEGER,
    "firstChangedLine" INTEGER,
    "inlineDiff" TEXT,
    "summary" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "actedBy" TEXT,
    "actedVia" TEXT,
    "actedAt" TIMESTAMP(3),
    "result" JSONB,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileChangeProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FileChangeProposal_chatAgentId_channel_createdAt_idx" ON "FileChangeProposal"("chatAgentId", "channel", "createdAt");

-- CreateIndex
CREATE INDEX "FileChangeProposal_agentId_path_status_idx" ON "FileChangeProposal"("agentId", "path", "status");

-- AddForeignKey
ALTER TABLE "FileChangeProposal" ADD CONSTRAINT "FileChangeProposal_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
