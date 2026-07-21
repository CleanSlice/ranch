import type {
  CreateLlmCredentialDto,
  UpdateLlmCredentialDto,
} from '#api/data/repositories/api/types.gen';
import type {
  ILlmCredentialData,
  ILlmCredentialInput,
  ILlmHealthCheckResult,
} from '../domain/llm.types';

type LlmStatusDto = 'active' | 'disabled';

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function toStatusDto(status: unknown): LlmStatusDto | undefined {
  return status === 'active' || status === 'disabled' ? status : undefined;
}

/** Maps the LLM credentials API onto domain shapes; reads defensively. */
export class LlmMapper {
  toEntity(raw: unknown): ILlmCredentialData | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    if (typeof o.id !== 'string') return null;
    return {
      id: o.id,
      provider: str(o.provider),
      model: str(o.model),
      fallbackModel: typeof o.fallbackModel === 'string' ? o.fallbackModel : null,
      label: typeof o.label === 'string' ? o.label : null,
      apiKey: str(o.apiKey),
      status: str(o.status),
      supportsChat: o.supportsChat === true,
      supportsEmbedding: o.supportsEmbedding === true,
      createdAt: str(o.createdAt),
      updatedAt: str(o.updatedAt),
    };
  }

  toList(raw: unknown): ILlmCredentialData[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item) => this.toEntity(item))
      .filter((x): x is ILlmCredentialData => x !== null);
  }

  toHealthResult(raw: unknown): ILlmHealthCheckResult | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    return {
      ok: o.ok === true,
      latencyMs: typeof o.latencyMs === 'number' ? o.latencyMs : 0,
      provider: str(o.provider),
      model: str(o.model),
      error: typeof o.error === 'string' ? o.error : undefined,
    };
  }

  // The DTO narrows `status` to a union; coerce the domain's free `string`.
  toCreateDto(input: ILlmCredentialInput): CreateLlmCredentialDto {
    return {
      provider: input.provider,
      model: input.model,
      apiKey: input.apiKey,
      fallbackModel: input.fallbackModel,
      label: input.label,
      status: toStatusDto(input.status),
      supportsChat: input.supportsChat,
      supportsEmbedding: input.supportsEmbedding,
    };
  }

  toUpdateDto(input: Partial<ILlmCredentialInput>): UpdateLlmCredentialDto {
    return {
      provider: input.provider,
      model: input.model,
      apiKey: input.apiKey,
      fallbackModel: input.fallbackModel,
      label: input.label,
      status: toStatusDto(input.status),
      supportsChat: input.supportsChat,
      supportsEmbedding: input.supportsEmbedding,
    };
  }
}
