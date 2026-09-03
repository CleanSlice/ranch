-- The source list is paged and filtered per knowledge base, oldest first.
-- Upstream already has every column this slice reads ("indexError",
-- "indexedAt", "indexState" arrived with 20260827135035); the only thing the
-- fork's schema declares that this one does not is the index that list walks.
CREATE INDEX "Source_knowledgeId_createdAt_idx" ON "Source"("knowledgeId", "createdAt");
