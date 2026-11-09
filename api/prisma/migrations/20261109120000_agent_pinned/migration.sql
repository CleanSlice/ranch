-- Additive (CLEAN-216): one installation-wide flag that keeps an agent at
-- the top of every agent list in both consoles. Decides nothing for the pod
-- or for access. Safe on a live database: NOT NULL with a default needs no
-- backfill, every existing agent starts unpinned.

-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "pinned" BOOLEAN NOT NULL DEFAULT false;
