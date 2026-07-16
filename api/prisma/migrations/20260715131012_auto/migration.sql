-- CreateTable
CREATE TABLE "ChatSession" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "externalUserId" TEXT NOT NULL,
    "sessionKey" TEXT NOT NULL,
    "title" TEXT,
    "preview" TEXT,
    "lastRole" TEXT,
    "lastMessageAt" TIMESTAMP(3) NOT NULL,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "userMessageCount" INTEGER NOT NULL DEFAULT 0,
    "lastIndexedEventId" TEXT,
    "lastIndexedSize" INTEGER NOT NULL DEFAULT 0,
    "summary" TEXT,
    "summaryAt" TIMESTAMP(3),
    "insights" JSONB,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatFeedback" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "source" TEXT NOT NULL,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatSession_agentId_lastMessageAt_idx" ON "ChatSession"("agentId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "ChatSession_channel_lastMessageAt_idx" ON "ChatSession"("channel", "lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChatSession_agentId_sessionKey_key" ON "ChatSession"("agentId", "sessionKey");

-- CreateIndex
CREATE UNIQUE INDEX "ChatFeedback_sessionId_messageId_authorId_key" ON "ChatFeedback"("sessionId", "messageId", "authorId");

-- AddForeignKey
ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatFeedback" ADD CONSTRAINT "ChatFeedback_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
