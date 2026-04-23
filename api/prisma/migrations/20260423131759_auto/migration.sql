-- CreateTable
CREATE TABLE "Knowledge" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "workspace" TEXT NOT NULL,
    "entityTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "relationshipTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "indexStatus" TEXT NOT NULL DEFAULT 'idle',
    "indexError" TEXT,
    "indexedAt" TIMESTAMP(3),
    "indexStartedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Knowledge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReinsSource" (
    "id" TEXT NOT NULL,
    "knowledgeId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT,
    "mimeType" TEXT,
    "content" TEXT,
    "sizeBytes" INTEGER,
    "lightragDocId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReinsSource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Knowledge_workspace_key" ON "Knowledge"("workspace");

-- CreateIndex
CREATE INDEX "Knowledge_indexStatus_idx" ON "Knowledge"("indexStatus");

-- CreateIndex
CREATE INDEX "ReinsSource_knowledgeId_idx" ON "ReinsSource"("knowledgeId");

-- CreateIndex
CREATE INDEX "ReinsSource_lightragDocId_idx" ON "ReinsSource"("lightragDocId");

-- AddForeignKey
ALTER TABLE "ReinsSource" ADD CONSTRAINT "ReinsSource_knowledgeId_fkey" FOREIGN KEY ("knowledgeId") REFERENCES "Knowledge"("id") ON DELETE CASCADE ON UPDATE CASCADE;
