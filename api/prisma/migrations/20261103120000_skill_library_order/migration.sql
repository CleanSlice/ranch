-- Additive (CLEAN-205): the admin Skills page gets a library group, a shared
-- display order and a token estimate per skill. None of the three decides
-- anything for agents or templates. Safe on a live database: the two
-- backfills below give every existing row a position (by creation, then
-- name, so the first list looks like the old one) and a size, so the summary
-- is right from the first deploy instead of showing zeros until a save.

-- AlterTable
ALTER TABLE "Skill" ADD COLUMN     "group" TEXT,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tokenEstimate" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Skill_sortOrder_idx" ON "Skill"("sortOrder");

-- Backfill: 1-based positions in creation order.
UPDATE "Skill" AS s
SET "sortOrder" = r.n
FROM (
    SELECT id, ROW_NUMBER() OVER (ORDER BY "createdAt", name) AS n
    FROM "Skill"
) AS r
WHERE r.id = s.id;

-- Backfill: the same ceil(chars / 4) the gateway writes on every body save.
UPDATE "Skill" SET "tokenEstimate" = CEIL(LENGTH(body) / 4.0);
