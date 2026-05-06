-- AlterTable
ALTER TABLE "LlmCredential" ADD COLUMN     "supportsChat" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "supportsEmbedding" BOOLEAN NOT NULL DEFAULT false;
