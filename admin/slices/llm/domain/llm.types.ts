// Domain types for LLM credentials.

export interface ILlmCredentialData {
  id: string;
  provider: string;
  model: string;
  fallbackModel: string | null;
  label: string | null;
  apiKey: string;
  status: string;
  supportsChat: boolean;
  supportsEmbedding: boolean;
  /** The Ranch assistant is built from it: read-only to anybody but the Owner (CLEAN-271). */
  assistantDependency: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ILlmHealthCheckResult {
  ok: boolean;
  latencyMs: number;
  provider: string;
  model: string;
  error?: string;
}

export interface ILlmCredentialInput {
  provider: string;
  model: string;
  apiKey: string;
  fallbackModel?: string;
  label?: string;
  status?: string;
  supportsChat?: boolean;
  supportsEmbedding?: boolean;
}
