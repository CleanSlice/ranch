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
}
