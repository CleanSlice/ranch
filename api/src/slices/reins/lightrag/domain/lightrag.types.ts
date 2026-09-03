export type QueryModeTypes = 'hybrid' | 'local' | 'global' | 'naive';

// The instance IS the workspace: each call names the base it belongs to and
// the client resolves that base's endpoint. The old `workspace` body field
// was silently ignored by the server — that is the defect this replaces.
export interface IIngestTextInput {
  knowledgeId: string;
  text: string;
  fileSource?: string;
}

export interface IIngestUrlInput {
  knowledgeId: string;
  url: string;
  /** Recorded as the document's file_source; defaults to the url. */
  fileSource?: string;
}

export interface IIngestFileInput {
  knowledgeId: string;
  filename: string;
  mimeType: string;
  content: Buffer;
}

export interface IIngestResult {
  docId: string;
}

export interface IQueryInput {
  knowledgeId: string;
  query: string;
  mode?: QueryModeTypes;
  topK?: number;
}

// Ingest endpoints only enqueue: they return a track id and LightRAG builds
// chunks, embeddings and the graph in a background pipeline afterwards. A
// document is searchable only once it reaches 'processed'.
export type DocumentProcessingStatusTypes =
  | 'pending'
  | 'processing'
  | 'processed'
  | 'failed';

export interface IDocumentProcessingStatus {
  id: string;
  status: DocumentProcessingStatusTypes;
  errorMessage: string | null;
}

export interface ITrackStatus {
  documents: IDocumentProcessingStatus[];
}

/**
 * A document as LightRAG stores it. `filePath` matters because LightRAG
 * refuses an upload whose filename it already holds, and that refusal names
 * only the file - resolving it back to a doc id needs this listing.
 */
export interface IDocumentRecord {
  id: string;
  status: DocumentProcessingStatusTypes;
  filePath: string | null;
}

export interface IQueryReference {
  referenceId: string;
  filePath: string;
}

export interface IQueryResult {
  answer: string;
  references: IQueryReference[];
}

/**
 * What the LightRAG process is actually running, as reported by /health. Its
 * bindings come from the container env and are resolved once at startup, so
 * this is the only honest answer to "which embedding model is in use". Picking
 * a credential in the admin expresses intent; this is the effect.
 */
export interface ILightragRuntimeConfig {
  llmBinding: string | null;
  llmModel: string | null;
  embeddingBinding: string | null;
  embeddingModel: string | null;
  embeddingBindingHost: string | null;
}

export interface ILightragHealth {
  ok: boolean;
  configuration: ILightragRuntimeConfig | null;
}

export interface IGetGraphInput {
  // Optional until the graph endpoints become base-scoped; undefined reads
  // the shared instance exactly as before.
  knowledgeId?: string;
  label: string;
  maxDepth?: number;
  maxNodes?: number;
}

export interface ILightragGraphNode {
  id: string;
  label: string;
  entityType: string;
  description: string;
}

export interface ILightragGraphEdge {
  id: string;
  source: string;
  target: string;
  weight: number;
  keywords: string;
  description: string;
}

export interface ILightragGraph {
  nodes: ILightragGraphNode[];
  edges: ILightragGraphEdge[];
  isTruncated: boolean;
}

/**
 * What LightRAG's ingest pipeline is doing right now.
 *
 * `busy` is the only field that matters for recovery and it is the one that
 * cannot be inferred from document status: a queue of PENDING documents looks
 * identical whether the pipeline is chewing through them or has forgotten they
 * exist. The queue itself lives in the LightRAG process, so it does not survive
 * that process being replaced, while the PENDING rows in its database do.
 */
export interface IPipelineStatus {
  busy: boolean;
  /** Documents in the batch the current job is working through. */
  docs: number;
  /** How many of them are done. */
  currentBatch: number;
  /** Last line the pipeline logged, useful in our own logs when it stalls. */
  latestMessage: string;
}

export class LightragClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly path: string,
  ) {
    super(message);
    this.name = 'LightragClientError';
  }
}
