-- AlterTable
ALTER TABLE "Template" ALTER COLUMN "defaultResources" SET DEFAULT '{"cpu": "2000m", "memory": "2Gi"}';

-- Backfill existing Template + Agent rows that were created with the
-- old 500m/512Mi default. Headless Chromium can't boot inside 512Mi, so
-- every browser_play call on those agents hit the 120s tool timeout.
-- Bumping their JSON in place lets the next agent restart pick up the
-- new pod resources without manual edit-page clicks.
UPDATE "Template"
   SET "defaultResources" = '{"cpu": "2000m", "memory": "2Gi"}'::jsonb
 WHERE "defaultResources" = '{"cpu": "500m", "memory": "512Mi"}'::jsonb;

UPDATE "Agent"
   SET "resources" = '{"cpu": "2000m", "memory": "2Gi"}'::jsonb
 WHERE "resources" = '{"cpu": "500m", "memory": "512Mi"}'::jsonb;
