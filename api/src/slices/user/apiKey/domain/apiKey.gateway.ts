import { IApiKeyData, ICreateApiKeyData } from './apiKey.types';

export abstract class IApiKeyGateway {
  abstract findAll(): Promise<IApiKeyData[]>;
  abstract findById(id: string): Promise<IApiKeyData | null>;
  abstract findByHash(keyHash: string): Promise<IApiKeyData | null>;
  abstract create(
    data: ICreateApiKeyData & { keyHash: string; prefix: string },
  ): Promise<IApiKeyData>;
  abstract delete(id: string): Promise<void>;
  abstract touchLastUsed(id: string): Promise<void>;
}
