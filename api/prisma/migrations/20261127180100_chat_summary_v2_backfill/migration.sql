-- Conversation summaries, version 2: the summaries that exist (CLEAN-270,
-- spec 038 research R7). By hand; no structure changes here.
--
-- In a migration of its own, right after 20261127180000_chat_summary_v2,
-- which adds the columns this one fills. A migration is one transaction,
-- and that one's ALTER TABLE holds an exclusive lock on "ChatSession" until
-- its transaction ends: with this UPDATE in the same file the lock was held
-- for as long as the rows took to update, and every read and write of a
-- conversation waited behind it. Here the UPDATE takes row locks only, on
-- the conversations that have a summary; chats go on meanwhile.
--
-- Only a conversation that has a summary is touched. It becomes version 1,
-- and its outcome is read from the boolean version 1 stored:
--
--   true            -> resolved
--   anything else   -> unknown   (false, missing, or not a boolean)
--
-- Version 1 only ever wrote a boolean there, so "anything else" is `false`
-- on the rows that exist; a row with no such key is unknown as well.
--
-- Not `open` for false. Version 1 stored "could not tell" as
-- `resolved: false`, so a false was never a judgment that the person was
-- left without an answer, and no threshold was ever calibrated for it. The
-- outcome `open` is what the page lists under "open questions", the one
-- figure a person acts on: every old summary landing there would fill that
-- list with conversations nobody judged open. `unknown` is what such a row
-- is. The batch takes version 1 rows again within its 180-day window
-- (`ChatInsightService`), and each gets a real outcome from the version 2
-- prompt then.
--
-- A conversation with no summary stays at version 0 with no outcome: "no
-- summary" is not an outcome.
--
-- `"insightVersion" < 2`: never a summary the new prompt wrote, so running
-- this again changes nothing it should not.
UPDATE "ChatSession"
SET "insightVersion" = 1,
    "outcome" = CASE WHEN "insights"->>'resolved' = 'true' THEN 'resolved' ELSE 'unknown' END
WHERE "summaryAt" IS NOT NULL
  AND "insightVersion" < 2;
