import type { CreateSkillDto } from '#api/data/repositories/api/types.gen';
import type {
  ISkillData,
  ISkillDependentAgent,
  ISkillFile,
  ISkillInput,
  ISkillSearchHit,
} from '../domain/skill.types';

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function nullableStr(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** Maps the skills API onto domain shapes; reads responses defensively. */
export class SkillMapper {
  toEntity(raw: unknown): ISkillData | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    if (typeof o.id !== 'string') return null;
    return {
      id: o.id,
      name: str(o.name),
      title: str(o.title),
      description: nullableStr(o.description),
      body: str(o.body),
      files: this.toFiles(o.files),
      source: nullableStr(o.source),
      createdAt: str(o.createdAt),
      updatedAt: str(o.updatedAt),
    };
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
    return { ...input };
  }

  toUpdateDto(input: Partial<ISkillInput>): Partial<CreateSkillDto> {
    return { ...input };
  }

  private toFiles(raw: unknown): ISkillFile[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
      .map((f) => ({ path: str(f.path), content: str(f.content) }));
  }
}
