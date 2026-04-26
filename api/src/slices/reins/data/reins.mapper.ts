import { Injectable } from '@nestjs/common';
import type {
  Knowledge as PrismaKnowledge,
  ReinsSource as PrismaReinsSource,
} from '@prisma/client';
import {
  IKnowledgeData,
  IReinsSourceData,
  IndexStatusTypes,
  SourceTypes,
} from '../domain/reins.types';

const INDEX_STATUSES: readonly IndexStatusTypes[] = [
  'idle',
  'indexing',
  'ready',
  'failed',
];
const SOURCE_TYPES: readonly SourceTypes[] = ['file', 'url', 'text'];

function isIndexStatus(value: string): value is IndexStatusTypes {
  return (INDEX_STATUSES as readonly string[]).includes(value);
}

function isSourceType(value: string): value is SourceTypes {
  return (SOURCE_TYPES as readonly string[]).includes(value);
}

function parseIndexStatus(value: string): IndexStatusTypes {
  return isIndexStatus(value) ? value : 'idle';
}

function parseSourceType(value: string): SourceTypes {
  return isSourceType(value) ? value : 'text';
}

@Injectable()
export class ReinsMapper {
  toKnowledgeEntity(
    record: PrismaKnowledge & { sources?: PrismaReinsSource[] },
  ): IKnowledgeData {
    return {
      id: record.id,
      name: record.name,
      description: record.description ?? null,
      entityTypes: record.entityTypes,
      relationshipTypes: record.relationshipTypes,
      indexStatus: parseIndexStatus(record.indexStatus),
      indexError: record.indexError ?? null,
      indexedAt: record.indexedAt ?? null,
      indexStartedAt: record.indexStartedAt ?? null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      sources: record.sources?.map((s) => this.toSourceEntity(s)),
    };
  }

  toSourceEntity(record: PrismaReinsSource): IReinsSourceData {
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
}
