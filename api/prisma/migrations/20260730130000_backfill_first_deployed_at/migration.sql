-- Agents created before firstDeployedAt existed: any non-pending status means
-- the agent has been deployed at least once, so backfill (updatedAt is the
-- closest available approximation). Without this, their first post-migration
-- deploy would read as launchContext='initial' ("Setting up agent…") even
-- though they have been running for weeks.
UPDATE "Agent"
SET "firstDeployedAt" = "updatedAt"
WHERE "firstDeployedAt" IS NULL
  AND "status" <> 'pending';
