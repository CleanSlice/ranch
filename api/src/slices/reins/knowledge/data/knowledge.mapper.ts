import { Injectable } from '@nestjs/common';
import type { Knowledge as PrismaKnowledge, Prisma } from '@prisma/client';
import {
  IKnowledgeData,
  ICreateKnowledgeData,
  IndexStatusTypes,
} from '../domain/knowledge.types';

const INDEX_STATUSES: readonly IndexStatusTypes[] = [
  'idle',
  'indexing',
  'ready',
  'failed',
];

function isIndexStatus(value: string): value is IndexStatusTypes {
  return (INDEX_STATUSES as readonly string[]).includes(value);
}

function parseIndexStatus(value: string): IndexStatusTypes {
  return isIndexStatus(value) ? value : 'idle';
}

@Injectable()
export class KnowledgeMapper {
  toEntity(record: PrismaKnowledge): IKnowledgeData {
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
    };
  }

  toCreate(data: ICreateKnowledgeData): Prisma.KnowledgeCreateInput {
    return {
      id: `knowledge-${crypto.randomUUID()}`,
      name: data.name,
      description: data.description ?? null,
      entityTypes: data.entityTypes ?? [],
      relationshipTypes: data.relationshipTypes ?? [],
      workspace: 'pending',
    };
  }
}
