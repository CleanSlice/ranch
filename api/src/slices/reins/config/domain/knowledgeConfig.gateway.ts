export interface IKnowledgeConfig {
  url: string;
  apiKey: string;
  bucket: string;
  enabled: boolean;
}

export interface ISelectedCredentialIds {
  chat: string | null;
  embedding: string | null;
}

export abstract class IKnowledgeConfigGateway {
  abstract resolve(): Promise<IKnowledgeConfig>;
  abstract isEnabled(): Promise<boolean>;
  /**
   * Explicit opt-in for per-base retrieval instances. Off by default: turning
   * it on starts the one-time migration, which provisions one LightRAG
   * instance per base and RE-INGESTS every source through the LLM — a real
   * cost that an operator must choose, never a side effect of deploying.
   * While off, every base keeps reading and writing the shared pool exactly
   * as before.
   */
  abstract isInstanceIsolationEnabled(): Promise<boolean>;
  abstract getSelectedCredentialIds(): Promise<ISelectedCredentialIds>;
  /**
   * Installation-level: whether the old shared retrieval pool has been
   * removed. Until it is, the shared deployment stays as the rollback for
   * the per-base transition.
   */
  abstract isSharedPoolDecommissioned(): Promise<boolean>;
  abstract markSharedPoolDecommissioned(): Promise<void>;
  /**
   * Whether a PDF without a text layer is sent to OCR. On by default: the
   * cost is bounded by getOcrMaxPages and only scans ever reach it. When off,
   * such a PDF is recorded as failed with a reason that names this switch,
   * instead of failing later with LightRAG's "only whitespace".
   */
  abstract isOcrEnabled(): Promise<boolean>;
  /** Largest PDF, in pages, that OCR will accept. */
  abstract getOcrMaxPages(): Promise<number>;
}
