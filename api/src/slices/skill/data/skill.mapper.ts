import { Injectable } from '@nestjs/common';
import { Skill } from '@prisma/client';
import { ISkillData, ISkillFile, ICreateSkillData } from '../domain';

@Injectable()
export class SkillMapper {
  toEntity(record: Skill): ISkillData {
    return {
      id: record.id,
      name: record.name,
      title: record.title,
      description: record.description,
      body: record.body,
      files: this.normalizeFiles(record.files),
      source: record.source,
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
