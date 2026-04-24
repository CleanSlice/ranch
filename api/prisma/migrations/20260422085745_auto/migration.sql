-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "llmCredentialId" TEXT;

-- AlterTable
ALTER TABLE "LlmCredential" ADD COLUMN     "fallbackModel" TEXT;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_llmCredentialId_fkey" FOREIGN KEY ("llmCredentialId") REFERENCES "LlmCredential"("id") ON DELETE SET NULL ON UPDATE CASCADE;
