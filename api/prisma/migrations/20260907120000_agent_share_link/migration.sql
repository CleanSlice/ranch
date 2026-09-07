-- Additive: new table AgentShareLink + FK to Agent (cascade). Safe on an existing database.

-- CreateTable
CREATE TABLE "AgentShareLink" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "rotatedAt" TIMESTAMP(3),
    "rotationCount" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentShareLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentShareLink_agentId_key" ON "AgentShareLink"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentShareLink_token_key" ON "AgentShareLink"("token");

-- AddForeignKey
ALTER TABLE "AgentShareLink" ADD CONSTRAINT "AgentShareLink_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
