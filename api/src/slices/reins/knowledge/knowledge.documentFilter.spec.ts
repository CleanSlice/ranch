// CLEAN-203: `retrieveContext` with `documents` reads the named documents
// only. The names resolve the way list_knowledge_documents matches them,
// the retrieval service gets their LightRAG ids, and whatever it returns
// from any other document is dropped — a server that ignored `ids` must
// not pass another deck's rows off as the named one's.

import { Logger } from '@nestjs/common';
import { KnowledgeService } from './domain/knowledge.service';
import { IKnowledgeGateway } from './domain/knowledge.gateway';
import { IInstanceGateway } from '../instance/domain/instance.gateway';
import { IKnowledgeConfigGateway } from '../config/domain/knowledgeConfig.gateway';
import { SourceService } from '../source/domain/source.service';
import type { ISourceData } from '../source/domain/source.types';
import type { IContextResult } from '../lightrag/domain/lightrag.types';

const AFS_ROW =
  'Headlights - adaptive Front-Lighting System (AFS) | 2.5 S: - | 2.5 S Premium: Std | 2.5 Turbo Premium Plus: Std';
const OTHER_ROW = 'Adaptive headlights (AFS) standard on Premium (23MY)';

const HATCHBACK_SHEET =
  '26my-mazda3-spec-deck-final-effective-06122026 - Equipment and Features - Hatchback.csv';
const OLD_GUIDE = '2023 Mazda3 Order Guide 2022-10-20.md';

function source(name: string, lightragDocId: string | null): ISourceData {
  return {
    id: `src-${name}`,
    knowledgeId: 'k1',
    name,
    type: 'file',
    url: null,
    indexState: 'indexed',
    indexStatus: 'indexed',
    lightragDocId,
  } as ISourceData;
}

interface Harness {
  service: KnowledgeService;
  retrieve: jest.Mock;
}

function makeHarness(
  sources: ISourceData[],
  chunks: Array<{ text: string; filePath: string }>,
): Harness {
  const retrieve = jest.fn(
    async (): Promise<IContextResult> => ({
      chunks: chunks.map((c, i) => ({ ...c, chunkId: `chunk-${i + 1}` })),
      relations: [],
      references: [],
      via: 'query_data',
    }),
  );
  const gateway = {
    findById: jest.fn(async (id: string) => ({
      id,
      name: 'Mazda',
      migrationState: 'done',
      instanceState: 'ready',
    })),
    retrieveKnowledgeContext: retrieve,
    listDocuments: jest.fn(async () => []),
  } as unknown as IKnowledgeGateway;
  const sourceService = {
    findByKnowledge: jest.fn(async () => sources),
    countByKnowledgeIds: jest.fn(
      async (ids: string[]) =>
        new Map(
          ids.map((id) => [
            id,
            {
              total: sources.length,
              indexed: sources.length,
              failed: 0,
              retrying: 0,
              processing: 0,
            },
          ]),
        ),
    ),
  } as unknown as SourceService;
  const instances = {} as IInstanceGateway;
  const config = {
    isEnabled: jest.fn(async () => true),
  } as unknown as IKnowledgeConfigGateway;
  return {
    service: new KnowledgeService(gateway, sourceService, instances, config),
    retrieve,
  };
}

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

describe('KnowledgeService.retrieveContext — the document filter (CLEAN-203)', () => {
  const sources = [
    source(HATCHBACK_SHEET, 'insert_hb'),
    source(OLD_GUIDE, 'upload_og'),
  ];
  const chunks = [
    { text: OTHER_ROW, filePath: OLD_GUIDE },
    { text: AFS_ROW, filePath: HATCHBACK_SHEET },
  ];

  it('hands the retrieval service the ids of the named documents and keeps only their passages', async () => {
    const { service, retrieve } = makeHarness(sources, chunks);

    const result = await service.retrieveContext('k1', 'AFS by trim', {
      documents: ['26MY Mazda3 Equipment and Features Hatchback'],
    });

    expect(retrieve).toHaveBeenCalledWith('k1', 'AFS by trim', undefined, [
      'insert_hb',
    ]);
    expect(result.documents).toEqual([HATCHBACK_SHEET]);
    expect(result.passages.map((p) => [p.text, p.sourceName])).toEqual([
      [AFS_ROW, HATCHBACK_SHEET],
    ]);
    expect(result.references.map((r) => r.sourceName)).toEqual([
      HATCHBACK_SHEET,
    ]);
  });

  it('matches the exact listed name as well as the loose spelling', async () => {
    const { service, retrieve } = makeHarness(sources, chunks);

    await service.retrieveContext('k1', 'q', { documents: [HATCHBACK_SHEET] });
    await service.retrieveContext('k1', 'q', {
      documents: ['2023 mazda3 order guide'],
    });

    expect(retrieve.mock.calls[0][3]).toEqual(['insert_hb']);
    expect(retrieve.mock.calls[1][3]).toEqual(['upload_og']);
  });

  it('says document_not_found without asking the retrieval service when no name matches', async () => {
    const { service, retrieve } = makeHarness(sources, chunks);

    const result = await service.retrieveContext('k1', 'q', {
      documents: ['No Such Deck'],
    });

    expect(result.reason).toBe('document_not_found');
    expect(result.passages).toEqual([]);
    expect(retrieve).not.toHaveBeenCalled();
  });

  it('skips a document the retrieval service has no id for', async () => {
    const { service, retrieve } = makeHarness(
      [source(HATCHBACK_SHEET, null), source(OLD_GUIDE, 'upload_og')],
      chunks,
    );

    const result = await service.retrieveContext('k1', 'q', {
      documents: ['Equipment and Features'],
    });

    expect(result.reason).toBe('document_not_found');
    expect(retrieve).not.toHaveBeenCalled();
  });

  it('leaves the unfiltered path as it was', async () => {
    const { service, retrieve } = makeHarness(sources, chunks);

    const result = await service.retrieveContext('k1', 'q');

    expect(retrieve).toHaveBeenCalledWith('k1', 'q', undefined, undefined);
    expect(result.documents).toBeUndefined();
    expect(result.passages.map((p) => p.text)).toEqual([OTHER_ROW, AFS_ROW]);
  });
});
