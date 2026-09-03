/**
 * Per-knowledge workspace name sent with every ingest.
 *
 * ⚠️ LightRAG currently ignores it. A workspace there is a property of the
 * *instance*, set by the `WORKSPACE` env var or the `--workspace` flag at
 * startup; there is no per-request equivalent on the document or query
 * endpoints. Everything Ranch ingests therefore lands in the one workspace the
 * container was started with (`default` for PostgreSQL storages), and a query
 * searches across every knowledge base at once - an agent bound to base A can
 * be answered from base B's documents.
 *
 * Real isolation needs one LightRAG instance per base, each with its own
 * `WORKSPACE` over the shared Postgres, which is an infrastructure decision
 * rather than something this function can fix. The value is kept because it
 * costs nothing, is already what the ingest calls carry, and is exactly what
 * those instances would be named. See api/src/slices/reins/README.md.
 */
export function workspaceOf(knowledgeId: string): string {
  return `knowledge_${knowledgeId.replace(/-/g, '')}`;
}
