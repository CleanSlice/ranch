-- Additive: per-user MCP OAuth tokens (CLEAN-80). The PKCE handshake state
-- remembers whose token the callback will store, so the bundle lands under
-- mcpOauth:<serverId>:<subject> instead of the agent-wide key. Nullable —
-- a connection started on the agent's behalf keeps the old behaviour.
-- Safe on an existing database — no backfill, no drops.

-- AlterTable
ALTER TABLE "McpOauthState" ADD COLUMN "subject" TEXT;
ALTER TABLE "McpOauthState" ADD COLUMN "subjectEmail" TEXT;
