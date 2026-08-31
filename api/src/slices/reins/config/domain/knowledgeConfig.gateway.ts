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
  abstract getSelectedCredentialIds(): Promise<ISelectedCredentialIds>;
  /**
   * Installation-level: whether the old shared retrieval pool has been
   * removed. Until it is, the shared deployment stays as the rollback for
   * the per-base transition.
   */
  abstract isSharedPoolDecommissioned(): Promise<boolean>;
  abstract markSharedPoolDecommissioned(): Promise<void>;
}
