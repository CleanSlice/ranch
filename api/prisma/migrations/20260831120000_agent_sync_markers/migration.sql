-- Additive, nullable-only: safe on an existing database.
ALTER TABLE "Agent" ADD COLUMN "lastPullAt" TIMESTAMP(3);
ALTER TABLE "Agent" ADD COLUMN "lastSyncAt" TIMESTAMP(3);
