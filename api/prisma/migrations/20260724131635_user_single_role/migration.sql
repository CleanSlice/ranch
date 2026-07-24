-- Collapse the multi-role array to a single hierarchical role.
-- Highest role wins: Owner > Admin > User. Legacy lowercase values
-- (pre-20260430 single-role column) are folded in defensively.
ALTER TABLE "User" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'User';

UPDATE "User" SET "role" = CASE
  WHEN 'Owner' = ANY("roles") OR 'owner' = ANY("roles") THEN 'Owner'
  WHEN 'Admin' = ANY("roles") OR 'admin' = ANY("roles") THEN 'Admin'
  ELSE 'User'
END;

ALTER TABLE "User" DROP COLUMN "roles";
