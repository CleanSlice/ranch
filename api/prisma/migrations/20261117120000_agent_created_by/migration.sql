-- Additive (CLEAN-232): who created an agent. A bare user id with no foreign
-- key, written once at creation: the agent outlives the account, and a creator
-- whose row is gone is shown as a removed account. Null for every agent that
-- exists today and for agents a trusted party creates. Safe on a live
-- database: one nullable column, no default, no rewrite of existing rows.

-- AlterTable
ALTER TABLE "Agent" ADD COLUMN "createdById" TEXT;
