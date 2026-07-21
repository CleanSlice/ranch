import type {
  CreateAgentDto,
  UpdateAgentDto,
} from '#api/data/repositories/api/types.gen';
import type {
  AgentStatusTypes,
  IAgentData,
  IAgentEnvVar,
  IAgentMetrics,
  IAgentResources,
  ICreateAgentData,
  IUpdateAgentData,
} from '../domain/agent.types';

const KNOWN_STATUSES = new Set<AgentStatusTypes>([
  'pending',
  'deploying',
  'running',
  'failed',
  'stopped',
]);

function num(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

function strList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((x): x is string => typeof x === 'string')
    : [];
}

/**
 * Maps the agents API onto domain shapes. Endpoints are typed as `unknown`
 * (no response DTO), so `toEntity` reads defensively and drops anything without
 * a string `id`. Input payloads are structurally the wire DTOs except
 * `llmCredentialId`, which the domain models as `string | null` but the DTO as
 * `string | undefined` — coerce null → undefined so "no credential" round-trips.
 */
export class AgentMapper {
  toEntity(raw: unknown): IAgentData | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    if (typeof o.id !== 'string') return null;
    return {
      id: o.id,
      name: typeof o.name === 'string' ? o.name : '',
      templateId: typeof o.templateId === 'string' ? o.templateId : '',
      llmCredentialId:
        typeof o.llmCredentialId === 'string' ? o.llmCredentialId : null,
      status: this.toStatus(o.status),
      workflowId: typeof o.workflowId === 'string' ? o.workflowId : null,
      config:
        o.config && typeof o.config === 'object'
          ? (o.config as Record<string, unknown>)
          : {},
      resources: this.toResources(o.resources),
      isPublic: o.isPublic === true,
      allowedOrigins: strList(o.allowedOrigins),
      knowledgeIds: strList(o.knowledgeIds),
      isAdmin: o.isAdmin === true,
      debugEnabled: o.debugEnabled === true,
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

  toMetrics(raw: unknown): IAgentMetrics | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    const pod = (o.pod ?? {}) as Record<string, unknown>;
    const node = (o.node ?? {}) as Record<string, unknown>;
    if (!o.pod || !o.node) return null;
    return {
      pod: {
        cpuMilli: num(pod.cpuMilli),
        memBytes: num(pod.memBytes),
        cpuLimitMilli: num(pod.cpuLimitMilli),
        memLimitBytes: num(pod.memLimitBytes),
      },
      node: {
        name: typeof node.name === 'string' ? node.name : '',
        diskAvailBytes: num(node.diskAvailBytes),
        diskCapacityBytes: num(node.diskCapacityBytes),
      },
    };
  }

  toEnvVars(raw: unknown): IAgentEnvVar[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
      .map((e) => ({
        name: typeof e.name === 'string' ? e.name : '',
        value: typeof e.value === 'string' ? e.value : '',
      }));
  }

  toCreateDto(input: ICreateAgentData): CreateAgentDto {
    return { ...input, llmCredentialId: input.llmCredentialId ?? undefined };
  }

  toUpdateDto(input: IUpdateAgentData): UpdateAgentDto {
    return { ...input, llmCredentialId: input.llmCredentialId ?? undefined };
  }

  // ── internals ──────────────────────────────────────────────────────────

  private toStatus(raw: unknown): AgentStatusTypes {
    return typeof raw === 'string' && KNOWN_STATUSES.has(raw as AgentStatusTypes)
      ? (raw as AgentStatusTypes)
      : 'pending';
  }

  private toResources(raw: unknown): IAgentResources {
    const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    return {
      cpu: typeof r.cpu === 'string' ? r.cpu : '',
      memory: typeof r.memory === 'string' ? r.memory : '',
    };
  }
}
