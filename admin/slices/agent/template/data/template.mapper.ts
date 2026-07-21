import type {
  CreateTemplateDto,
  UpdateTemplateDto,
} from '#api/data/repositories/api/types.gen';
import type {
  ICreateTemplateData,
  IRestartAgentsResult,
  ITemplateData,
  ITemplateResources,
  IUpdateTemplateData,
} from '../domain/template.types';

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function num(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

function strList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((x): x is string => typeof x === 'string')
    : [];
}

/** Maps the templates API onto domain shapes; reads responses defensively. */
export class TemplateMapper {
  toEntity(raw: unknown): ITemplateData | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    if (typeof o.id !== 'string') return null;
    return {
      id: o.id,
      name: str(o.name),
      description: str(o.description),
      image: str(o.image),
      defaultConfig:
        o.defaultConfig && typeof o.defaultConfig === 'object'
          ? (o.defaultConfig as Record<string, unknown>)
          : {},
      defaultResources: this.toResources(o.defaultResources),
      defaultKnowledgeIds: strList(o.defaultKnowledgeIds),
      skillIds: strList(o.skillIds),
      mcpServerIds: strList(o.mcpServerIds),
      createdAt: str(o.createdAt),
      updatedAt: str(o.updatedAt),
    };
  }

  toList(raw: unknown): ITemplateData[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item) => this.toEntity(item))
      .filter((t): t is ITemplateData => t !== null);
  }

  toRestartResult(raw: unknown): IRestartAgentsResult {
    if (!raw || typeof raw !== 'object') {
      return { restarted: 0, failed: 0, total: 0 };
    }
    const o = raw as Record<string, unknown>;
    return {
      restarted: num(o.restarted),
      failed: num(o.failed),
      total: num(o.total),
    };
  }

  toCreateDto(input: ICreateTemplateData): CreateTemplateDto {
    return {
      name: input.name,
      description: input.description,
      image: input.image,
      defaultConfig: input.defaultConfig,
      defaultResources: this.toResourcesDto(input.defaultResources),
      defaultKnowledgeIds: input.defaultKnowledgeIds,
    };
  }

  toUpdateDto(input: IUpdateTemplateData): UpdateTemplateDto {
    return {
      name: input.name,
      description: input.description,
      image: input.image,
      defaultConfig: input.defaultConfig,
      defaultResources: this.toResourcesDto(input.defaultResources),
      defaultKnowledgeIds: input.defaultKnowledgeIds,
    };
  }

  private toResources(raw: unknown): ITemplateResources {
    const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    return { cpu: str(r.cpu), memory: str(r.memory) };
  }

  // `ITemplateResources` is an interface, which TS won't assign to the DTO's
  // index-signature type; a plain object literal satisfies it.
  private toResourcesDto(
    r: ITemplateResources | undefined,
  ): Record<string, unknown> | undefined {
    return r ? { cpu: r.cpu, memory: r.memory } : undefined;
  }
}
