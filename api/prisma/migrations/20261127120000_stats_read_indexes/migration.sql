-- Read indexes for the profile statistics (CLEAN-258, spec 038). Indexes only:
-- no table, column or row changes. Each serves one read of a period:
-- a person's conversations, a person's ratings, an installation's ratings,
-- a person's cited answers, the hand-overs made while answering a person.
-- ChatMessageSource(clientId) is replaced by (clientId, createdAt), which
-- answers the same lookups.

-- DropIndex
DROP INDEX "ChatMessageSource_clientId_idx";

-- CreateIndex
CREATE INDEX "AgentDelegation_clientId_startedAt_idx" ON "AgentDelegation"("clientId", "startedAt");

-- CreateIndex
CREATE INDEX "ChatSession_externalUserId_channel_lastMessageAt_idx" ON "ChatSession"("externalUserId", "channel", "lastMessageAt");

-- CreateIndex
CREATE INDEX "ChatFeedback_authorId_createdAt_idx" ON "ChatFeedback"("authorId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatFeedback_createdAt_idx" ON "ChatFeedback"("createdAt");

-- CreateIndex
CREATE INDEX "ChatMessageSource_clientId_createdAt_idx" ON "ChatMessageSource"("clientId", "createdAt");

