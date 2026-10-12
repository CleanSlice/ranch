-- Additive: four new tables for agent events and failure notifications
-- (CLEAN-139). AgentEvent is one report about an agent, from an outside
-- sender or from Ranch itself; AgentIncident groups a stretch of trouble
-- for one agent and its unique "openKey" keeps at most one open per agent;
-- AgentNotification is the outbox of messages about an incident;
-- AgentEventDestination holds where they go. Nothing existing is altered.
-- Safe on an existing database.

-- CreateTable
CREATE TABLE "AgentEvent" (
    "id" TEXT NOT NULL,
    "agentId" TEXT,
    "agentRef" TEXT NOT NULL,
    "agentName" TEXT,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "witness" TEXT NOT NULL,
    "apiKeyId" TEXT,
    "senderName" TEXT NOT NULL,
    "tool" TEXT,
    "ranchStatus" TEXT,
    "outcome" TEXT NOT NULL,
    "incidentId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dedupeKey" TEXT,

    CONSTRAINT "AgentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentIncident" (
    "id" TEXT NOT NULL,
    "agentId" TEXT,
    "agentName" TEXT NOT NULL,
    "openKey" TEXT,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "ranchWitnessed" BOOLEAN NOT NULL DEFAULT false,
    "openedAt" TIMESTAMP(3) NOT NULL,
    "lastFailureAt" TIMESTAMP(3) NOT NULL,
    "upSince" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "resolution" TEXT,

    CONSTRAINT "AgentIncident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentNotification" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMP(3),
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentEventDestination" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "webhookUrl" TEXT NOT NULL,
    "hint" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastDeliveryAt" TIMESTAMP(3),
    "lastDeliveryOk" BOOLEAN,
    "lastDeliveryError" TEXT,

    CONSTRAINT "AgentEventDestination_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentEvent_dedupeKey_key" ON "AgentEvent"("dedupeKey");

-- CreateIndex
CREATE INDEX "AgentEvent_receivedAt_idx" ON "AgentEvent"("receivedAt");

-- CreateIndex
CREATE INDEX "AgentEvent_agentId_receivedAt_idx" ON "AgentEvent"("agentId", "receivedAt");

-- CreateIndex
CREATE INDEX "AgentEvent_apiKeyId_receivedAt_idx" ON "AgentEvent"("apiKeyId", "receivedAt");

-- CreateIndex
CREATE INDEX "AgentEvent_incidentId_idx" ON "AgentEvent"("incidentId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentIncident_openKey_key" ON "AgentIncident"("openKey");

-- CreateIndex
CREATE INDEX "AgentIncident_agentId_openedAt_idx" ON "AgentIncident"("agentId", "openedAt");

-- CreateIndex
CREATE INDEX "AgentIncident_closedAt_idx" ON "AgentIncident"("closedAt");

-- CreateIndex
CREATE INDEX "AgentNotification_status_nextAttemptAt_idx" ON "AgentNotification"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentNotification_incidentId_kind_key" ON "AgentNotification"("incidentId", "kind");

-- AddForeignKey
ALTER TABLE "AgentEvent" ADD CONSTRAINT "AgentEvent_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentEvent" ADD CONSTRAINT "AgentEvent_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "AgentIncident"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentIncident" ADD CONSTRAINT "AgentIncident_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentNotification" ADD CONSTRAINT "AgentNotification_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "AgentIncident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

