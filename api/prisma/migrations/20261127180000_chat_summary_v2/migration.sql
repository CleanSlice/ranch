-- Conversation summaries, version 2 (CLEAN-270, spec 038 research R7).
-- Additive: one table and four columns. Nothing is dropped and `summary`,
-- `summaryAt` and `insights` keep what they hold.
--
-- ChatTopic: one subject as the installation's summaries name it. The model
-- chooses among these by key instead of writing a free-text tag per
-- conversation, so the same subject gets the same label.
--
-- ChatSession: `outcome` (resolved | open | unknown), `question` (the
-- person's main question, one line), `topicIds` (the topics assigned with a
-- clear fit) and `insightVersion` (0 none, 1 before this migration, 2 from
-- the new prompt).
--
-- Structure only, as generated. The summaries that exist are marked as
-- version 1 by the next migration, 20261127180100_chat_summary_v2_backfill,
-- and not here: a migration is one transaction, and the ALTER TABLE below
-- takes an exclusive lock on "ChatSession" that is held until the
-- transaction ends. With the UPDATE in the same file, every read and write
-- of a conversation would have waited for as long as the rows took to
-- update. On its own this file adds columns with constant defaults, which
-- Postgres does without rewriting the table, and lets go at once.

-- AlterTable
ALTER TABLE "ChatSession" ADD COLUMN     "insightVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "outcome" TEXT,
ADD COLUMN     "question" TEXT,
ADD COLUMN     "topicIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "ChatTopic" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "labels" JSONB NOT NULL,
    "mergedIntoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatTopic_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChatTopic_key_key" ON "ChatTopic"("key");
