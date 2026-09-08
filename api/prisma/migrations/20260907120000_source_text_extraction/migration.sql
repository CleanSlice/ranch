-- Text extracted for PDFs that have no text layer (reins/extraction). Every
-- existing row reads `none`, which is exactly today's behaviour: the file goes
-- to LightRAG as-is.
ALTER TABLE "Source" ADD COLUMN     "textState" TEXT NOT NULL DEFAULT 'none',
ADD COLUMN     "textUrl" TEXT,
ADD COLUMN     "textError" TEXT;

-- The boot-time requeue asks for every `pending` row; nothing else filters on it.
CREATE INDEX "Source_textState_idx" ON "Source"("textState");
