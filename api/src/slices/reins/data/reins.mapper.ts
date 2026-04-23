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

function parseIndexStatus(value: string): IndexStatusTypes {
  return INDEX_STATUSES.includes(value as IndexStatusTypes)
    ? (value as IndexStatusTypes)
    : 'idle';
}

function parseSourceType(value: string): SourceTypes {
  return SOURCE_TYPES.includes(value as SourceTypes)
    ? (value as SourceTypes)
    : 'text';
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
      workspace: record.workspace,
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
      lightragDocId: record.lightragDocId ?? null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
