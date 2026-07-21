import { LlmsService } from '#api/data';
import { BaseGateway } from '#common/data/BaseGateway';
import { unwrapEnvelope } from '#common/data/unwrapEnvelope';
import { ILlmGateway } from '../domain/llm.gateway';
import type {
  ILlmCredentialData,
  ILlmCredentialInput,
  ILlmHealthCheckResult,
} from '../domain/llm.types';
import { LlmMapper } from './llm.mapper';

export class LlmGateway extends BaseGateway implements ILlmGateway {
  private mapper = new LlmMapper();

  findAll(): Promise<ILlmCredentialData[]> {
    return this.execute(async () => {
      const res = await LlmsService.llmControllerFindAll();
      return this.mapper.toList(unwrapEnvelope(res.data));
    });
  }

  findById(id: string): Promise<ILlmCredentialData | null> {
    return this.execute(async () => {
      const res = await LlmsService.llmControllerFindById({ path: { id } });
      return this.mapper.toEntity(unwrapEnvelope(res.data));
    });
  }

  create(input: ILlmCredentialInput): Promise<ILlmCredentialData | null> {
    return this.execute(async () => {
      const res = await LlmsService.llmControllerCreate({
        body: this.mapper.toCreateDto(input),
      });
      return this.mapper.toEntity(unwrapEnvelope(res.data));
    });
  }

  update(
    id: string,
    input: Partial<ILlmCredentialInput>,
  ): Promise<ILlmCredentialData | null> {
    return this.execute(async () => {
      const res = await LlmsService.llmControllerUpdate({
        path: { id },
        body: this.mapper.toUpdateDto(input),
      });
      return this.mapper.toEntity(unwrapEnvelope(res.data));
    });
  }

  remove(id: string): Promise<void> {
    return this.execute(async () => {
      await LlmsService.llmControllerRemove({ path: { id } });
    });
  }

  checkHealth(id: string): Promise<ILlmHealthCheckResult> {
    return this.execute(async () => {
      const res = await LlmsService.healthCheckLlmCredential({ path: { id } });
      const result = this.mapper.toHealthResult(unwrapEnvelope(res.data));
      if (!result) {
        throw new Error('Empty response from health-check endpoint');
      }
      return result;
    });
  }
}
