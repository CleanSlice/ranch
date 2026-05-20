-- AlterTable
ALTER TABLE "IntegrationAccount" ADD COLUMN     "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "IntegrationAccount_aliases_idx" ON "IntegrationAccount"("aliases");
