import type { IApiKeyData, ICreateApiKeyInput, ICreatedApiKey } from './apiKey.types';

/** Contract for the API keys API. Implemented by `ApiKeyGateway`. */
export abstract class IApiKeyGateway {
  abstract findAll(): Promise<IApiKeyData[]>;
  abstract create(input: ICreateApiKeyInput): Promise<ICreatedApiKey | null>;
  abstract remove(id: string): Promise<void>;
}
