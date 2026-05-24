-- DropIndex
DROP INDEX "IntegrationAccount_aliases_idx";

-- AlterTable
ALTER TABLE "IntegrationAccount" DROP COLUMN "aliases";
