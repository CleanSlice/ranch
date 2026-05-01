-- Replace single-string `role` with multi-value `roles String[]`.
-- Backfill: owner → ['Owner'], admin → ['Admin'], anything else → ['User'].

-- 1. Add the new column with a temporary default so existing rows get a value.
ALTER TABLE "User" ADD COLUMN "roles" TEXT[] NOT NULL DEFAULT ARRAY['User']::TEXT[];

-- 2. Backfill from the legacy `role` column.
UPDATE "User"
SET "roles" = CASE "role"
  WHEN 'owner'  THEN ARRAY['Owner']::TEXT[]
  WHEN 'admin'  THEN ARRAY['Admin']::TEXT[]
  WHEN 'member' THEN ARRAY['User']::TEXT[]
  ELSE ARRAY['User']::TEXT[]
END;

-- 3. Drop the legacy column.
ALTER TABLE "User" DROP COLUMN "role";
