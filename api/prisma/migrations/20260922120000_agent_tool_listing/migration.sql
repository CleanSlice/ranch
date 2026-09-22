-- Additive: new table AgentToolListing — the tool names the API last served to
-- an agent's pod on MCP tools/list, so the console can mark tools the running
-- pod does not have yet (CLEAN-109). One row per agent, cascades with it.
-- Safe on an existing database.

-- CreateTable
CREATE TABLE "AgentToolListing" (
    "agentId" TEXT NOT NULL,
    "toolNames" JSONB NOT NULL,
    "listedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentToolListing_pkey" PRIMARY KEY ("agentId")
);

-- AddForeignKey
ALTER TABLE "AgentToolListing" ADD CONSTRAINT "AgentToolListing_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
