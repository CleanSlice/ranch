-- Additive, nullable-only: safe on an existing database.
ALTER TABLE "Agent" ADD COLUMN "statusReason" TEXT;
ALTER TABLE "Agent" ADD COLUMN "firstDeployedAt" TIMESTAMP(3);
ALTER TABLE "Agent" ADD COLUMN "lastDeployStartedAt" TIMESTAMP(3);
ALTER TABLE "Agent" ADD COLUMN "lastLaunchContext" TEXT;
