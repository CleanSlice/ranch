-- Additive: new tables AgentPeer (directed peer connection + pair credential +
-- card snapshot) and AgentDelegation (audit row per delegated task), both with
-- FKs to Agent. Safe on an existing database.

-- CreateTable
CREATE TABLE "AgentPeer" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "peerAgentId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "cardSnapshot" JSONB NOT NULL,
    "cardUrl" TEXT NOT NULL,
    "cardReadAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentPeer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentDelegation" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "peerId" TEXT,
    "peerAgentId" TEXT NOT NULL,
    "peerName" TEXT NOT NULL,
    "contextId" TEXT NOT NULL,
    "turnId" TEXT,
    "clientId" TEXT,
    "task" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "matchedSkills" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "errorCode" TEXT,
    "excerpt" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,

    CONSTRAINT "AgentDelegation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentPeer_token_key" ON "AgentPeer"("token");

-- CreateIndex
CREATE INDEX "AgentPeer_agentId_idx" ON "AgentPeer"("agentId");

-- CreateIndex
CREATE INDEX "AgentPeer_peerAgentId_idx" ON "AgentPeer"("peerAgentId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentPeer_agentId_peerAgentId_key" ON "AgentPeer"("agentId", "peerAgentId");

-- CreateIndex
CREATE INDEX "AgentDelegation_agentId_startedAt_idx" ON "AgentDelegation"("agentId", "startedAt");

-- AddForeignKey
ALTER TABLE "AgentPeer" ADD CONSTRAINT "AgentPeer_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentPeer" ADD CONSTRAINT "AgentPeer_peerAgentId_fkey" FOREIGN KEY ("peerAgentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentDelegation" ADD CONSTRAINT "AgentDelegation_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentDelegation" ADD CONSTRAINT "AgentDelegation_peerId_fkey" FOREIGN KEY ("peerId") REFERENCES "AgentPeer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
