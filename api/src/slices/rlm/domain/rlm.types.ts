// A source of context the RLM executor is allowed to recursively read.
// `agentFile` is always scoped to the calling agent's own S3 prefix and
// restricted to a path prefix (workspace/, never memory/ or sessions/ —
// see IRlmJobScope.filePrefix).
export type IRlmContextRef =
  | { type: 'knowledge'; knowledgeId: string }
  | { type: 'source'; sourceId: string }
  | { type: 'agentFile'; agentId: string; path: string };

export interface IRlmExecuteInput {
  question: string;
  contextRefs: IRlmContextRef[];
}

export interface IRlmJobResult {
  answer: string;
  iterations: number;
  toolCalls: number;
  durationMs: number;
  error?: string;
}
