import type { CreateSkillDto } from '#api/data/repositories/api/types.gen';
import { isSkillGroup } from '../domain/skill.groups';
import type {
  INameAvailability,
  ISkillData,
  ISkillDependentAgent,
  ISkillFile,
  ISkillInput,
  ISkillOrder,
  ISkillSearchHit,
  ISkillTemplateRef,
} from '../domain/skill.types';

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function nullableStr(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function int(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 0;
}

/** Maps the skills API onto domain shapes; reads responses defensively. */
export class SkillMapper {
  toEntity(raw: unknown): ISkillData | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    if (typeof o.id !== 'string') return null;
    const files = this.toFiles(o.files);
    return {
      id: o.id,
      name: str(o.name),
      title: str(o.title),
      description: nullableStr(o.description),
      body: str(o.body),
      files,
      filesCount: typeof o.filesCount === 'number' ? int(o.filesCount) : files.length,
      source: nullableStr(o.source),
      group: isSkillGroup(o.group) ? o.group : null,
      sortOrder: int(o.sortOrder),
      tokenEstimate: int(o.tokenEstimate),
      templates: this.toTemplateRefs(o.templates),
      createdAt: str(o.createdAt),
      updatedAt: str(o.updatedAt),
    };
  }

  toOrder(raw: unknown): ISkillOrder {
    const o = (raw ?? {}) as Record<string, unknown>;
    const items = Array.isArray(o.items) ? o.items : [];
    return {
      version: str(o.version),
      items: items
        .filter((i): i is Record<string, unknown> => !!i && typeof i === 'object')
        .map((i) => ({ id: str(i.id), sortOrder: int(i.sortOrder) })),
    };
  }

  toNameAvailability(raw: unknown, name: string): INameAvailability {
    const o = (raw ?? {}) as Record<string, unknown>;
    return {
      name: str(o.name) || name,
      available: o.available === true,
      ...(typeof o.existingId === 'string' ? { existingId: o.existingId } : {}),
    };
  }

  private toTemplateRefs(raw: unknown): ISkillTemplateRef[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
      .map((t) => ({ id: str(t.id), name: str(t.name) }))
      .filter((t) => t.id !== '');
  }

  toList(raw: unknown): ISkillData[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item) => this.toEntity(item))
      .filter((s): s is ISkillData => s !== null);
  }

  toSearchHits(raw: unknown): ISkillSearchHit[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((h): h is Record<string, unknown> => !!h && typeof h === 'object')
      .map((h) => ({
        source: str(h.source),
        repo: str(h.repo),
        path: str(h.path),
        name: str(h.name),
        title: str(h.title),
        description: nullableStr(h.description),
        url: str(h.url),
        snippet: nullableStr(h.snippet),
      }));
  }

  toDependentAgents(raw: unknown): ISkillDependentAgent[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
      .map((a) => ({
        id: str(a.id),
        name: str(a.name),
        status: str(a.status),
        templateId: str(a.templateId),
        templateName: str(a.templateName),
      }));
  }

  toCreateDto(input: ISkillInput): CreateSkillDto {
    return { ...input, group: this.toGroupDto(input.group) };
  }

  toUpdateDto(input: Partial<ISkillInput>): Partial<CreateSkillDto> {
    const { group, ...rest } = input;
    return group === undefined ? rest : { ...rest, group: this.toGroupDto(group) };
  }

  /**
   * The SDK publishes the group as a string enum whose values are the slugs
   * the domain uses, so the string is the enum member at runtime; only the
   * type needs convincing.
   */
  private toGroupDto(group: ISkillInput['group']): CreateSkillDto['group'] {
    return (group ?? null) as CreateSkillDto['group'];
  }

  private toFiles(raw: unknown): ISkillFile[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
      .map((f) => ({ path: str(f.path), content: str(f.content) }));
  }
}
