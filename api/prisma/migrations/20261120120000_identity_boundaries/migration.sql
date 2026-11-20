-- Additive (CLEAN-236): identity boundaries.
--
-- AgentPeer: who made a connection, whether an internal one is open to
-- visitors (and who opened it), and the one person a personal external one
-- serves. Connections that exist today serve every caller of the asking
-- agent, so the backfill keeps them doing that (internal: open to visitors;
-- external: shared, ownerUserId stays null) and marks each for review.
-- AgentDelegation.forUserId: the person a chain of hand-overs was started
-- for. Session.surface: the console a sign-in was made in; existing rows keep
-- null, which is what makes them non-renewable. No row is deleted.

-- AlterTable
ALTER TABLE "AgentDelegation" ADD COLUMN     "forUserId" TEXT;

-- AlterTable
ALTER TABLE "AgentPeer" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "needsReview" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "openToVisitors" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "openedAt" TIMESTAMP(3),
ADD COLUMN     "openedById" TEXT,
ADD COLUMN     "ownerUserId" TEXT;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "surface" TEXT;

-- Backfill: what exists keeps serving whom it serves, and is listed for the
-- Owner to look at.
UPDATE "AgentPeer" SET "openToVisitors" = true, "needsReview" = true
 WHERE "origin" = 'internal';
UPDATE "AgentPeer" SET "needsReview" = true WHERE "origin" = 'external';

-- The visitors mark belongs to internal rows, a personal owner to external
-- ones. PeerService enforces both; this is the second lock.
ALTER TABLE "AgentPeer" ADD CONSTRAINT "AgentPeer_scope_by_origin_check"
  CHECK (
    ("origin" = 'internal' AND "ownerUserId" IS NULL)
    OR ("origin" = 'external' AND "openToVisitors" = false)
  );

-- External dedup, now per audience. A shared row is unique per address; a
-- personal row is unique per address and person, so two people may each have
-- their own connection to an address a manager also shares.
DROP INDEX "AgentPeer_agentId_cardUrl_external_key";

CREATE UNIQUE INDEX "AgentPeer_agentId_cardUrl_shared_key"
  ON "AgentPeer"("agentId", "cardUrl")
  WHERE "origin" = 'external' AND "ownerUserId" IS NULL;

CREATE UNIQUE INDEX "AgentPeer_agentId_cardUrl_owner_key"
  ON "AgentPeer"("agentId", "cardUrl", "ownerUserId")
  WHERE "origin" = 'external' AND "ownerUserId" IS NOT NULL;
