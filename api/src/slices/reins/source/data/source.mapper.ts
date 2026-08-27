import { Injectable } from '@nestjs/common';
import type { Source as PrismaSource, Prisma } from '@prisma/client';
import {
  ISourceData,
  ICreateSourceData,
  SourceIndexStateTypes,
  SourceTypes,
} from '../domain/source.types';

const SOURCE_TYPES: readonly SourceTypes[] = ['file', 'url', 'text'];

const INDEX_STATES: readonly SourceIndexStateTypes[] = [
  'queued',
  'processing',
  'indexed',
  'failed',
];

function isSourceType(value: string): value is SourceTypes {
  return (SOURCE_TYPES as readonly string[]).includes(value);
}

function parseSourceType(value: string): SourceTypes {
  return isSourceType(value) ? value : 'text';
}

function parseIndexState(value: string): SourceIndexStateTypes {
  return (INDEX_STATES as readonly string[]).includes(value)
    ? (value as SourceIndexStateTypes)
    : 'queued';
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
      indexState: parseIndexState(record.indexState),
      indexError: record.indexError ?? null,
      indexedAt: record.indexedAt ?? null,
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
