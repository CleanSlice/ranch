-- Additive: MCP OAuth connect (CLEAN-75). Adds a nullable McpServer.oauthClientId
-- (the shared client_id from one-time dynamic client registration) and the
-- McpOauthState table (short-lived PKCE handshake state for the in-chat connect
-- flow). Safe on an existing database — no backfill, no drops.

-- AlterTable
ALTER TABLE "McpServer" ADD COLUMN "oauthClientId" TEXT;

-- CreateTable
CREATE TABLE "McpOauthState" (
    "state" TEXT NOT NULL,
    "mcpServerId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "codeVerifier" TEXT NOT NULL,
    "redirectBack" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "McpOauthState_pkey" PRIMARY KEY ("state")
);

-- CreateIndex
CREATE INDEX "McpOauthState_mcpServerId_agentId_idx" ON "McpOauthState"("mcpServerId", "agentId");

-- CreateIndex
CREATE INDEX "McpOauthState_createdAt_idx" ON "McpOauthState"("createdAt");
