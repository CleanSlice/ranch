import { Injectable } from '@nestjs/common';
import type { Source as PrismaSource, Prisma } from '@prisma/client';
import {
  ISourceData,
  ICreateSourceData,
  SourceIndexStatusTypes,
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

/**
 * `indexedAt` is the only proof that LightRAG finished the document, and it
 * wins over any leftover error from an earlier run. `lightragDocId` is
 * deliberately NOT consulted: it is written as soon as ingest is accepted so a
 * later run can resume the wait instead of re-uploading, which means a row can
 * hold an id while the pipeline is still chewing. Treating that id as proof is
 * what showed a base as fully indexed while its graph was still being built.
 */
export function deriveIndexStatus(record: {
  indexedAt: Date | null;
  indexError: string | null;
}): SourceIndexStatusTypes {
  if (record.indexedAt !== null) return 'indexed';
  if (record.indexError !== null) return 'failed';
  return 'pending';
}

function parseIndexState(value: string): SourceIndexStateTypes {
  return (INDEX_STATES as readonly string[]).includes(value)
    ? (value as SourceIndexStateTypes)
    : 'queued';
}

@Injectable()
export class SourceMapper {
  toEntity(record: PrismaSource): ISourceData {
    const indexStatus = deriveIndexStatus(record);
    return {
      id: record.id,
      knowledgeId: record.knowledgeId,
      type: parseSourceType(record.type),
      name: record.name,
      url: record.url ?? null,
      mimeType: record.mimeType ?? null,
      content: record.content ?? null,
      sizeBytes: record.sizeBytes ?? null,
      indexed: indexStatus === 'indexed',
      indexStatus,
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
