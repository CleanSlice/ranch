import type {
  CreateAgentDto,
  UpdateAgentDto,
} from '#api/data/repositories/api/types.gen';
import type {
  IAgentCreateInput,
  IAgentData,
  IAgentUpdateInput,
} from '../domain/agent.types';

/**
 * Maps the agents API onto domain shapes. The endpoints are typed as `unknown`
 * (no response DTO), so `toEntity` reads defensively and drops anything without
 * a string `id`. Input payloads are structurally identical to the wire DTOs, so
 * the `to*Dto` converters are thin — they exist to keep `#api` types out of the
 * domain and to be the one place that breaks if the DTOs drift.
 */
export class AgentMapper {
  toEntity(raw: unknown): IAgentData | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    if (typeof o.id !== 'string') return null;
    const resources =
      o.resources && typeof o.resources === 'object'
        ? (o.resources as Record<string, unknown>)
        : {};
    return {
      id: o.id,
      name: typeof o.name === 'string' ? o.name : '',
      status: typeof o.status === 'string' ? o.status : '',
      templateId: typeof o.templateId === 'string' ? o.templateId : '',
      workflowId: typeof o.workflowId === 'string' ? o.workflowId : null,
      config:
        o.config && typeof o.config === 'object'
          ? (o.config as Record<string, unknown>)
          : {},
      resources: {
        cpu: typeof resources.cpu === 'string' ? resources.cpu : '',
        memory: typeof resources.memory === 'string' ? resources.memory : '',
      },
      isPublic: o.isPublic === true,
      createdAt: typeof o.createdAt === 'string' ? o.createdAt : '',
      updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : '',
    };
  }

  toList(raw: unknown): IAgentData[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item) => this.toEntity(item))
      .filter((a): a is IAgentData => a !== null);
  }

  toCreateDto(input: IAgentCreateInput): CreateAgentDto {
    return { ...input };
  }

  toUpdateDto(input: IAgentUpdateInput): UpdateAgentDto {
    return { ...input };
  }
}
