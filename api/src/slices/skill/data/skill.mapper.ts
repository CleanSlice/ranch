import { Injectable } from '@nestjs/common';
import { Skill } from '@prisma/client';
import {
  ISkillData,
  ISkillFile,
  ICreateSkillData,
  ISkillTemplateRef,
  isSkillGroup,
  estimateTokens,
} from '../domain';

/** A Skill row read with `include: { templates: { select: { id, name } } }`. */
export type SkillRecord = Skill & { templates?: ISkillTemplateRef[] };

/** What every read includes, so the list and the panel show the same templates. */
export const SKILL_INCLUDE = {
  templates: { select: { id: true, name: true } },
} as const;

@Injectable()
export class SkillMapper {
  toEntity(record: SkillRecord): ISkillData {
    const files = this.normalizeFiles(record.files);
    return {
      id: record.id,
      name: record.name,
      title: record.title,
      description: record.description,
      body: record.body,
      files,
      filesCount: files.length,
      source: record.source,
      group: isSkillGroup(record.group) ? record.group : null,
      sortOrder: record.sortOrder,
      tokenEstimate: record.tokenEstimate,
      templates: (record.templates ?? []).map((t) => ({
        id: t.id,
        name: t.name,
      })),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  toCreate(data: ICreateSkillData) {
    return {
      id: `skill-${crypto.randomUUID()}`,
      name: data.name,
      title: data.title,
      body: data.body,
      description: data.description ?? null,
      source: data.source ?? null,
      group: data.group ?? null,
      tokenEstimate: estimateTokens(data.body),
      files: (data.files ?? []) as unknown as object,
    };
  }

  private normalizeFiles(raw: unknown): ISkillFile[] {
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((entry) => {
      if (
        entry &&
        typeof entry === 'object' &&
        'path' in entry &&
        'content' in entry &&
        typeof (entry as ISkillFile).path === 'string' &&
        typeof (entry as ISkillFile).content === 'string'
      ) {
        return [
          {
            path: (entry as ISkillFile).path,
            content: (entry as ISkillFile).content,
          },
        ];
      }
      return [];
    });
  }
}
