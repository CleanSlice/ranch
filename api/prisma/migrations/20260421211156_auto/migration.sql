-- CreateTable
CREATE TABLE "LlmCredential" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "label" TEXT,
    "apiKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LlmCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Usage" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "llmCredentialId" TEXT,
    "model" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "callCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LlmCredential_status_idx" ON "LlmCredential"("status");

-- CreateIndex
CREATE INDEX "Usage_agentId_idx" ON "Usage"("agentId");

-- CreateIndex
CREATE INDEX "Usage_date_idx" ON "Usage"("date");

-- CreateIndex
CREATE UNIQUE INDEX "Usage_agentId_model_date_key" ON "Usage"("agentId", "model", "date");

-- AddForeignKey
ALTER TABLE "Usage" ADD CONSTRAINT "Usage_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Usage" ADD CONSTRAINT "Usage_llmCredentialId_fkey" FOREIGN KEY ("llmCredentialId") REFERENCES "LlmCredential"("id") ON DELETE SET NULL ON UPDATE CASCADE;
