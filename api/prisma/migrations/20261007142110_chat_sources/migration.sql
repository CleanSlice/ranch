-- AlterTable
ALTER TABLE "Knowledge" ADD COLUMN     "readerAccess" TEXT NOT NULL DEFAULT 'closed';

-- CreateTable
CREATE TABLE "ChatMessageSource" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "sessionKey" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "n" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceId" TEXT,
    "knowledgeId" TEXT,
    "knowledgeName" TEXT,
    "name" TEXT NOT NULL,
    "url" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessageSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceRating" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceRating_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatMessageSource_sourceId_idx" ON "ChatMessageSource"("sourceId");

-- CreateIndex
CREATE INDEX "ChatMessageSource_agentId_sessionKey_idx" ON "ChatMessageSource"("agentId", "sessionKey");

-- CreateIndex
CREATE INDEX "ChatMessageSource_clientId_idx" ON "ChatMessageSource"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatMessageSource_messageId_n_key" ON "ChatMessageSource"("messageId", "n");

-- CreateIndex
CREATE INDEX "SourceRating_sourceId_idx" ON "SourceRating"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "SourceRating_sourceId_messageId_authorId_key" ON "SourceRating"("sourceId", "messageId", "authorId");

-- AddForeignKey
ALTER TABLE "ChatMessageSource" ADD CONSTRAINT "ChatMessageSource_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceRating" ADD CONSTRAINT "SourceRating_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;
