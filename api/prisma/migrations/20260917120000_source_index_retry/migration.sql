-- Automatic retry of index failures that pass on their own (a model outage, a
-- lost connection). `indexAttempts` counts the failures since the last success
-- or manual retry and sets the pause before the next try; `indexRetryAt` is
-- when the reconciler may try again, null when it never will. Existing failed
-- rows keep null: nothing is retried behind anyone's back by the migration.
ALTER TABLE "Source" ADD COLUMN     "indexAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "indexRetryAt" TIMESTAMP(3),
-- LightRAG's timestamp on the failed verdict a row was last re-queued over,
-- so the reconciler can tell that verdict from a new one.
ADD COLUMN     "indexRequeuedOverAt" TIMESTAMP(3);

-- The reconciler asks for due rows every minute across every knowledge.
CREATE INDEX "Source_indexRetryAt_idx" ON "Source"("indexRetryAt");
