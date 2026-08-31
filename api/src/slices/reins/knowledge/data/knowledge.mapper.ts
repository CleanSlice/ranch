import { Injectable } from '@nestjs/common';
import type { Knowledge as PrismaKnowledge, Prisma } from '@prisma/client';
import {
  IKnowledgeData,
  ICreateKnowledgeData,
  IndexStatusTypes,
  InstanceStateTypes,
  MigrationStateTypes,
} from '../domain/knowledge.types';

const INDEX_STATUSES: readonly IndexStatusTypes[] = [
  'idle',
  'indexing',
  'ready',
  'failed',
];

const INSTANCE_STATES: readonly InstanceStateTypes[] = [
  'absent',
  'starting',
  'ready',
  'failed',
  'stopping',
];

const MIGRATION_STATES: readonly MigrationStateTypes[] = [
  'notStarted',
  'inProgress',
  'done',
  'failed',
];

function parseIndexStatus(value: string): IndexStatusTypes {
  return (INDEX_STATUSES as readonly string[]).includes(value)
    ? (value as IndexStatusTypes)
    : 'idle';
}

function parseInstanceState(value: string): InstanceStateTypes {
  return (INSTANCE_STATES as readonly string[]).includes(value)
    ? (value as InstanceStateTypes)
    : 'absent';
}

function parseMigrationState(value: string): MigrationStateTypes {
  return (MIGRATION_STATES as readonly string[]).includes(value)
    ? (value as MigrationStateTypes)
    : 'notStarted';
}

@Injectable()
export class KnowledgeMapper {
  toEntity(record: PrismaKnowledge): IKnowledgeData {
    return {
      id: record.id,
      name: record.name,
      description: record.description ?? null,
      workspace: record.workspace,
      indexStatus: parseIndexStatus(record.indexStatus),
      indexError: record.indexError ?? null,
      indexedAt: record.indexedAt ?? null,
      indexStartedAt: record.indexStartedAt ?? null,
      instanceState: parseInstanceState(record.instanceState),
      instanceError: record.instanceError ?? null,
      instanceEndpoint: record.instanceEndpoint ?? null,
      migrationState: parseMigrationState(record.migrationState),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  toCreate(data: ICreateKnowledgeData): Prisma.KnowledgeCreateInput {
    return {
      id: `knowledge-${crypto.randomUUID()}`,
      name: data.name,
      description: data.description ?? null,
      workspace: 'pending',
      // A base born after the transition has nothing to migrate — its
      // content only ever lands in its own area.
      migrationState: 'done',
    };
  }
}
