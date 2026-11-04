// CLEAN-203: `retrieveContext` with `documents` reads the named documents
// only. The names resolve the way list_knowledge_documents matches them,
// the retrieval service gets their LightRAG ids, and whatever it returns
// from any other document is dropped — a server that ignored `ids` must
// not pass another deck's rows off as the named one's.

import { Logger } from '@nestjs/common';
import { Readable } from 'node:stream';
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
  texts: Record<string, string> = {},
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
    readContent: jest.fn(async (_knowledgeId: string, sourceId: string) => {
      const s = sources.find((x) => x.id === sourceId);
      return {
        filename: s?.name ?? sourceId,
        contentType: 'text/csv',
        contentLength: null,
        body: Readable.from([Buffer.from(texts[s?.name ?? ''] ?? '', 'utf8')]),
      };
    }),
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

  // Production, 2026-11-02: "power liftgate" against the named 16 KB
  // equipment sheet came back empty from LightRAG (similarity threshold)
  // while the row sat in the sheet. The document's own text is the fallback.
  it('reads the named document itself when the retrieval service returns nothing for it', async () => {
    const SHEET_TEXT = [
      'Category,Feature,2.5 S,2.5 S Premium,2.5 Turbo Premium Plus',
      'Exterior Features,Power rear liftgate,-,Std,Std',
      'Interior Features,Power windows,Std,Std,Std',
    ].join('\n');
    const { service, retrieve } = makeHarness(sources, [], {
      [HATCHBACK_SHEET]: SHEET_TEXT,
    });

    const result = await service.retrieveContext('k1', 'power liftgate', {
      documents: [HATCHBACK_SHEET],
    });

    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(result.via).toBe('document_scan');
    expect(result.passages.map((p) => p.text)).toEqual([
      'Category,Feature,2.5 S,2.5 S Premium,2.5 Turbo Premium Plus',
      'Exterior Features,Power rear liftgate,-,Std,Std',
      'Interior Features,Power windows,Std,Std,Std',
    ]);
    expect(
      result.passages.every((p) => p.sourceId === `src-${HATCHBACK_SHEET}`),
    ).toBe(true);
    expect(result.references.map((r) => r.sourceName)).toEqual([
      HATCHBACK_SHEET,
    ]);
    expect(result.documents).toEqual([HATCHBACK_SHEET]);
  });

  it('keeps the retrieval passages when the named document carries no phrase of the query, and never reads a document without a filter', async () => {
    const { service, retrieve } = makeHarness(sources, chunks, {
      [HATCHBACK_SHEET]: 'Exterior Features,Power rear liftgate,-,Std,Std',
    });
    const sourceService = (
      service as unknown as { sources: { readContent: jest.Mock } }
    ).sources;

    const filtered = await service.retrieveContext('k1', 'AFS', {
      documents: [HATCHBACK_SHEET],
    });
    expect(sourceService.readContent).toHaveBeenCalledTimes(1);
    const unfiltered = await service.retrieveContext('k1', 'liftgate');

    expect(filtered.via).toBe('query_data');
    expect(filtered.passages.map((p) => p.text)).toEqual([AFS_ROW]);
    expect(unfiltered.via).toBe('query_data');
    expect(unfiltered.passages).toHaveLength(2);
    expect(sourceService.readContent).toHaveBeenCalledTimes(1);
    expect(retrieve).toHaveBeenCalledTimes(2);
  });

  it('a phrase the named document carries verbatim leads the passages even when the retrieval service returned other rows (CLEAN-211)', async () => {
    const OM = '2026_CX70_PHEV_OM.md';
    const DAA_TEXT =
      'The DAA operates when all of the following conditions are met and the system detects driver fatigue.';
    const UDS_TEXT =
      'If the specific conditions are met during the CTS operation, the Unresponsive Driver Support is a function that decelerates the vehicle and makes an emergency call.';
    const OM_TEXT = [
      '###### **How to Use the Driver Attention Alert (DAA)**',
      '',
      DAA_TEXT,
      '',
      '###### **Unresponsive Driver Support**',
      '',
      UDS_TEXT,
    ].join('\n');
    const omSources = [...sources, source(OM, 'insert_om')];
    const { service } = makeHarness(
      omSources,
      [{ text: DAA_TEXT, filePath: OM }],
      { [OM]: OM_TEXT },
    );

    const result = await service.retrieveContext(
      'k1',
      'CX-70 PHEV driver attention alert unresponsive driver',
      { documents: [OM] },
    );

    expect(result.via).toBe('query_data');
    expect(result.passages.map((p) => p.text)).toEqual([
      `###### **How to Use the Driver Attention Alert (DAA)**\n${DAA_TEXT}`,
      `###### **Unresponsive Driver Support**\n${UDS_TEXT}`,
      DAA_TEXT,
    ]);
    expect(result.passages.every((p) => p.sourceId === `src-${OM}`)).toBe(true);
    expect(result.references.map((r) => r.sourceName)).toEqual([OM]);
  });

  it('skips a document that is not text, and stays empty when nothing is scannable', async () => {
    const pdf = {
      ...source('26MY CX-30 Spec Deck.pdf', 'upload_pdf'),
      mimeType: 'application/pdf',
    } as ISourceData;
    const { service } = makeHarness([pdf], [], {
      '26MY CX-30 Spec Deck.pdf': 'binary soup liftgate',
    });
    const sourceService = (
      service as unknown as { sources: { readContent: jest.Mock } }
    ).sources;

    const result = await service.retrieveContext('k1', 'liftgate', {
      documents: ['26MY CX-30 Spec Deck'],
    });

    expect(sourceService.readContent).not.toHaveBeenCalled();
    expect(result.passages).toEqual([]);
    expect(result.reason).toBe('no_relevant_content');
    expect(result.documents).toEqual(['26MY CX-30 Spec Deck.pdf']);
  });

  it('leaves the unfiltered path as it was', async () => {
    const { service, retrieve } = makeHarness(sources, chunks);

    const result = await service.retrieveContext('k1', 'q');

    expect(retrieve).toHaveBeenCalledWith('k1', 'q', undefined, undefined);
    expect(result.documents).toBeUndefined();
    expect(result.passages.map((p) => p.text)).toEqual([OTHER_ROW, AFS_ROW]);
  });
});
