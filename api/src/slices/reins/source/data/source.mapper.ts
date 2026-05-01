import { Injectable } from '@nestjs/common';
import type { Source as PrismaSource, Prisma } from '@prisma/client';
import {
  ISourceData,
  ICreateSourceData,
  SourceTypes,
} from '../domain/source.types';

const SOURCE_TYPES: readonly SourceTypes[] = ['file', 'url', 'text'];

function isSourceType(value: string): value is SourceTypes {
  return (SOURCE_TYPES as readonly string[]).includes(value);
}

function parseSourceType(value: string): SourceTypes {
  return isSourceType(value) ? value : 'text';
}

@Injectable()
export class SourceMapper {
  toEntity(record: PrismaSource): ISourceData {
    return {
      id: record.id,
      knowledgeId: record.knowledgeId,
      type: parseSourceType(record.type),
      name: record.name,
      url: record.url ?? null,
      mimeType: record.mimeType ?? null,
      content: record.content ?? null,
      sizeBytes: record.sizeBytes ?? null,
      indexed: record.lightragDocId !== null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  toCreate(data: ICreateSourceData): Prisma.SourceUncheckedCreateInput {
    return {
      id: `source-${crypto.randomUUID()}`,
      knowledgeId: data.knowledgeId,
      type: data.type,
      name: data.name,
      url: data.url ?? null,
      mimeType: data.mimeType ?? null,
      content: data.content ?? null,
      sizeBytes: data.sizeBytes ?? null,
    };
  }
}
