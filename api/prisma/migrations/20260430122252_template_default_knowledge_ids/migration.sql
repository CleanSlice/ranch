-- AlterTable
ALTER TABLE "Template" ADD COLUMN "defaultKnowledgeIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
