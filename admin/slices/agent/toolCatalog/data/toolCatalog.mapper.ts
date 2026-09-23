import type {
  AgentToolCatalogDto,
  AgentToolEntryDto,
  AgentToolGroupDto,
} from '#api/data/repositories/api/types.gen';
import type {
  IAgentToolCatalog,
  IAgentToolEntry,
  IAgentToolGroup,
} from '../domain/toolCatalog.types';

const str = (v: unknown, fallback = ''): string =>
  typeof v === 'string' ? v : fallback;

/**
 * DTO → domain, defensively: a missing field becomes an empty string or an
 * empty list rather than an exception, because a half-broken catalogue is
 * still a usable menu.
 */
export class ToolCatalogMapper {
  toEntry(dto: AgentToolEntryDto): IAgentToolEntry {
    return {
      name: str(dto.name),
      title: str(dto.title, str(dto.name)),
      description: str(dto.description),
      template: str(dto.template),
      destructive: dto.destructive === true,
      inPod:
        dto.inPod === true ? true : dto.inPod === false ? false : null,
    };
  }

  toGroup(dto: AgentToolGroupDto): IAgentToolGroup {
    const tools = Array.isArray(dto.tools)
      ? dto.tools.map((t) => this.toEntry(t))
      : [];
    return {
      key: str(dto.key),
      title: str(dto.title, str(dto.key)),
      kind: dto.kind === 'external' ? 'external' : 'builtin',
      ...(dto.description ? { description: dto.description } : {}),
      afterRestart: dto.afterRestart === true,
      tools,
    };
  }

  toCatalog(dto: AgentToolCatalogDto): IAgentToolCatalog {
    return {
      agentId: str(dto.agentId),
      podStartedAt: dto.podStartedAt ?? null,
      listedAt: dto.listedAt ?? null,
      groups: Array.isArray(dto.groups)
        ? dto.groups.map((g) => this.toGroup(g))
        : [],
    };
  }
}
