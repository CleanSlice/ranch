-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "peersServedAt" TIMESTAMP(3),
ADD COLUMN     "peersServedHash" TEXT;

-- AlterTable
ALTER TABLE "AgentDelegation" ALTER COLUMN "peerAgentId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "AgentPeer" ADD COLUMN     "origin" TEXT NOT NULL DEFAULT 'internal',
ADD COLUMN     "outboundToken" TEXT,
ALTER COLUMN "peerAgentId" DROP NOT NULL,
ALTER COLUMN "token" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "AgentPeer_agentId_cardUrl_idx" ON "AgentPeer"("agentId", "cardUrl");

-- External dedup: one row per (agentId, cardUrl) among imported peers.
-- Partial: internal rows may legitimately share a cardUrl shape and are
-- already unique on (agentId, peerAgentId).
CREATE UNIQUE INDEX "AgentPeer_agentId_cardUrl_external_key"
  ON "AgentPeer"("agentId", "cardUrl") WHERE "origin" = 'external';
