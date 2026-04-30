-- Rename table
ALTER TABLE "ReinsSource" RENAME TO "Source";

-- Rename primary key constraint
ALTER TABLE "Source" RENAME CONSTRAINT "ReinsSource_pkey" TO "Source_pkey";

-- Rename foreign key constraint
ALTER TABLE "Source" RENAME CONSTRAINT "ReinsSource_knowledgeId_fkey" TO "Source_knowledgeId_fkey";

-- Rename indexes
ALTER INDEX "ReinsSource_knowledgeId_idx" RENAME TO "Source_knowledgeId_idx";
ALTER INDEX "ReinsSource_lightragDocId_idx" RENAME TO "Source_lightragDocId_idx";
