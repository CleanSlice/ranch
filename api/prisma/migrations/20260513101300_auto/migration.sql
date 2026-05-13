-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "knowledgeIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
