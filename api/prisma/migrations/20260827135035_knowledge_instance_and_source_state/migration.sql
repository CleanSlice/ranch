-- AlterTable
ALTER TABLE "Knowledge" ADD COLUMN     "instanceEndpoint" TEXT,
ADD COLUMN     "instanceError" TEXT,
ADD COLUMN     "instanceState" TEXT NOT NULL DEFAULT 'absent',
ADD COLUMN     "migrationState" TEXT NOT NULL DEFAULT 'notStarted';

-- AlterTable
ALTER TABLE "Source" ADD COLUMN     "indexError" TEXT,
ADD COLUMN     "indexState" TEXT NOT NULL DEFAULT 'queued',
ADD COLUMN     "indexedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Source_indexState_idx" ON "Source"("indexState");

-- Backfill: a source already handed to the shared pool is the closest thing
-- to "indexed" the old data can express; the one-time migration re-ingests
-- every source into its base's own instance and rewrites this state anyway.
UPDATE "Source" SET "indexState" = 'indexed', "indexedAt" = "updatedAt"
WHERE "lightragDocId" IS NOT NULL;
