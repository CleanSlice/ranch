import type { IApiKeyGateway } from './apiKey.gateway';
import type { IApiKeyData, ICreateApiKeyInput, ICreatedApiKey } from './apiKey.types';

/** Domain service for API keys. The store layers list/loading/error. */
export class ApiKeyService {
  constructor(private gateway: IApiKeyGateway) {}

  findAll(): Promise<IApiKeyData[]> {
    return this.gateway.findAll();
  }

  create(input: ICreateApiKeyInput): Promise<ICreatedApiKey | null> {
    return this.gateway.create(input);
  }

  remove(id: string): Promise<void> {
    return this.gateway.remove(id);
  }
}
