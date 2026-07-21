import { ApiKeysService } from '#api/data';
import { BaseGateway } from '#common/data/BaseGateway';
import { unwrapEnvelope } from '#common/data/unwrapEnvelope';
import { IApiKeyGateway } from '../domain/apiKey.gateway';
import type {
  IApiKeyData,
  ICreateApiKeyInput,
  ICreatedApiKey,
} from '../domain/apiKey.types';
import { ApiKeyMapper } from './apiKey.mapper';

export class ApiKeyGateway extends BaseGateway implements IApiKeyGateway {
  private mapper = new ApiKeyMapper();

  findAll(): Promise<IApiKeyData[]> {
    return this.execute(async () => {
      const res = await ApiKeysService.apiKeyControllerFindAll();
      return this.mapper.toList(unwrapEnvelope(res.data));
    });
  }

  create(input: ICreateApiKeyInput): Promise<ICreatedApiKey | null> {
    return this.execute(async () => {
      const res = await ApiKeysService.apiKeyControllerCreate({
        body: this.mapper.toCreateDto(input),
      });
      return this.mapper.toCreated(unwrapEnvelope(res.data));
    });
  }

  remove(id: string): Promise<void> {
    return this.execute(async () => {
      await ApiKeysService.apiKeyControllerRemove({ path: { id } });
    });
  }
}
