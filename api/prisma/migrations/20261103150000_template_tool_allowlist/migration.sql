-- Additive (CLEAN-209): a template may name the Documents MCP tools its
-- agents list and call. NULL means every tool, which is what every existing
-- row keeps, so Rancher and every deployed agent see no change until an
-- operator sets a list on a template. Safe on a live database: no backfill.

-- AlterTable
ALTER TABLE "Template" ADD COLUMN     "toolAllowlist" JSONB;
