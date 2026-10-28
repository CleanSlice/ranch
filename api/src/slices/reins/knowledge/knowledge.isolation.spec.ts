// SC-001 executable: an answer comes only from the base that was asked.
// Two simulated retrieval instances with disjoint content; the real client
// and the real routing policy sit between the service and the fake network,
// so what is asserted is the actual read path — which endpoint a query hits,
// and that a base with no coverage says so instead of borrowing.

import { ServiceUnavailableException } from '@nestjs/common';
import {
  KnowledgeService,
  isNoRelevantContentAnswer,
  isPartialRefusal,
  resolveReference,
  resolveAdoptedReferences,
} from './domain/knowledge.service';
import { IKnowledgeGateway } from './domain/knowledge.gateway';
import { IKnowledgeData } from './domain/knowledge.types';
import {
  LightragHttpClient,
  LightragRequestConfig,
} from '../lightrag/data/lightragHttp.client';
import { routeLightragConfig } from '../lightrag/data/lightragRouting';
import { SourceService } from '../../reins/source/domain/source.service';
import { ISourceData } from '../../reins/source/domain/source.types';
import { IInstanceGateway } from '../instance/domain/instance.gateway';
import { IKnowledgeConfigGateway } from '../config/domain/knowledgeConfig.gateway';

const K1_ENDPOINT = 'http://lightrag-kb-k1.agents.svc:9621';
const K2_ENDPOINT = 'http://lightrag-kb-k2.agents.svc:9621';
const SHARED_ENDPOINT = 'http://lightrag.platform.svc:9621';
const FALKIRK_FACT = 'The Falkirk relay uses port 7731';
const NO_CONTEXT_ANSWER =
  "Sorry, I'm not able to provide an answer to that question.[no-context]";

function base(p: Partial<IKnowledgeData> & { id: string }): IKnowledgeData {
  return {
    name: p.id,
    description: null,
    workspace: `knowledge_${p.id}`,
    indexStatus: 'ready',
    indexError: null,
    indexedAt: null,
    indexStartedAt: null,
    instanceState: 'ready',
    instanceError: null,
    instanceEndpoint: null,
    migrationState: 'done',
    readerAccess: 'closed',
    sourceCount: 0,
    indexedCount: 0,
    failedCount: 0,
    retryingCount: 0,
    processingCount: 0,
    indexRunAlive: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...p,
  };
}

function source(
  p: Partial<ISourceData> & { id: string; knowledgeId: string },
): ISourceData {
  return {
    cited: 0,
    likes: 0,
    dislikes: 0,
    type: 'text',
    name: p.id,
    url: null,
    mimeType: null,
    content: 'text',
    sizeBytes: null,
    indexed: true,
    indexStatus: 'indexed',
    indexState: 'indexed',
    indexError: null,
    indexedAt: new Date(0),
    indexAttempts: 0,
    indexRetryAt: null,
    textState: 'none',
    textUrl: null,
    textError: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...p,
  };
}

interface Harness {
  service: KnowledgeService;
  fetchedUrls: string[];
}

function makeHarness(
  bases: IKnowledgeData[],
  sources: ISourceData[],
  k1ConsoleAnswer = `${FALKIRK_FACT}, per the commissioning record.`,
): Harness {
  const fetchedUrls: string[] = [];

  // Two isolated "instances": K1's holds the Falkirk fact, K2's holds
  // nothing relevant. The shared endpoint must never be hit by a migrated
  // base, so it answers with a poisoned marker that would fail the test.
  const fakeFetch = (async (input: RequestInfo | URL) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    fetchedUrls.push(url);
    // The passages route (CLEAN-184): K1's instance holds the fact as a
    // chunk, K2's holds nothing, the shared pool holds the poison.
    if (url.startsWith(K1_ENDPOINT) && url.endsWith('/query/data')) {
      return jsonResponse({
        status: 'success',
        message: 'ok',
        data: {
          entities: [],
          relationships: [],
          chunks: [
            {
              content: `${FALKIRK_FACT}, per the commissioning record.`,
              file_path: 'src-k1',
              chunk_id: 'chunk-k1',
              reference_id: '1',
            },
          ],
          references: [{ reference_id: '1', file_path: 'src-k1' }],
        },
        metadata: {},
      });
    }
    if (url.startsWith(K2_ENDPOINT) && url.endsWith('/query/data')) {
      return jsonResponse({
        status: 'failure',
        message: 'No relevant context found for the query.',
        data: {},
        metadata: { failure_reason: 'no_results' },
      });
    }
    if (url.startsWith(SHARED_ENDPOINT) && url.endsWith('/query/data')) {
      return jsonResponse({
        status: 'success',
        message: 'ok',
        data: {
          entities: [],
          relationships: [],
          chunks: [
            {
              content: `POISON: shared pool answered — isolation broken. ${FALKIRK_FACT}`,
              file_path: 'shared.txt',
              chunk_id: 'chunk-shared',
              reference_id: '1',
            },
          ],
          references: [{ reference_id: '1', file_path: 'shared.txt' }],
        },
        metadata: {},
      });
    }
    if (url.startsWith(K1_ENDPOINT) && url.endsWith('/query')) {
      return jsonResponse({
        response: k1ConsoleAnswer,
        references: [{ reference_id: '1', file_path: 'src-k1' }],
      });
    }
    if (url.startsWith(K2_ENDPOINT) && url.endsWith('/query')) {
      return jsonResponse({ response: NO_CONTEXT_ANSWER, references: [] });
    }
    if (url.startsWith(SHARED_ENDPOINT)) {
      return jsonResponse({
        response: `POISON: shared pool answered — isolation broken. ${FALKIRK_FACT}`,
        references: [],
      });
    }
    throw new Error(`connection refused: ${url}`);
  }) as typeof fetch;

  const byId = new Map(bases.map((b) => [b.id, b]));
  const client = new LightragHttpClient({
    fetchImpl: fakeFetch,
    resolveConfig: async (ctx) => {
      const shared: LightragRequestConfig = {
        url: SHARED_ENDPOINT,
        apiKey: 'k',
        enabled: true,
      };
      const row = ctx ? (byId.get(ctx.knowledgeId) ?? null) : null;
      return routeLightragConfig(shared, row, ctx);
    },
  });

  const gateway = {
    findById: jest.fn(async (id: string) => byId.get(id) ?? null),
    searchKnowledge: jest.fn(async (knowledgeId: string, query: string) =>
      client.query({ knowledgeId, query }),
    ),
    retrieveKnowledgeContext: jest.fn(
      async (knowledgeId: string, query: string) =>
        client.retrieveContext({ knowledgeId, query }),
    ),
    listDocuments: jest.fn(async () => []),
  } as unknown as IKnowledgeGateway;

  const sourceService = {
    findByKnowledge: jest.fn(async (knowledgeId: string) =>
      sources.filter((s) => s.knowledgeId === knowledgeId),
    ),
    countByKnowledgeIds: jest.fn(async (knowledgeIds: string[]) => {
      const counts = new Map();
      for (const id of knowledgeIds) {
        const own = sources.filter((s) => s.knowledgeId === id);
        counts.set(id, {
          total: own.length,
          indexed: own.filter((s) => s.indexStatus === 'indexed').length,
          failed: own.filter((s) => s.indexStatus === 'failed').length,
          retrying: 0,
          processing: 0,
        });
      }
      return counts;
    }),
  } as unknown as SourceService;

  const instances = {} as IInstanceGateway;
  const config = {
    isEnabled: jest.fn(async () => true),
  } as unknown as IKnowledgeConfigGateway;

  return {
    service: new KnowledgeService(gateway, sourceService, instances, config),
    fetchedUrls,
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('SC-001 — an answer comes only from the base that was asked', () => {
  const k1 = base({
    id: 'k1',
    name: 'Relays',
    instanceEndpoint: K1_ENDPOINT,
  });
  const k2 = base({
    id: 'k2',
    name: 'Botany',
    instanceEndpoint: K2_ENDPOINT,
  });
  const srcK1 = source({ id: 'src-k1', knowledgeId: 'k1', name: 'relays.txt' });
  const srcK2 = source({ id: 'src-k2', knowledgeId: 'k2', name: 'plants.txt' });

  test('the base that holds the fact answers it, with references inside itself', async () => {
    const { service } = makeHarness([k1, k2], [srcK1, srcK2]);
    const result = await service.query(
      'k1',
      'What port does the Falkirk relay use?',
    );
    expect(result.answer).toContain('7731');
    expect(result.knowledgeId).toBe('k1');
    expect(result.references).toHaveLength(1);
    expect(result.references[0].sourceId).toBe('src-k1');
    expect(result.references[0].sourceName).toBe('relays.txt');
  });

  test('the base without the fact says no_relevant_content — no generated answer, no borrowing', async () => {
    const { service, fetchedUrls } = makeHarness([k1, k2], [srcK1, srcK2]);
    const result = await service.query(
      'k2',
      'What port does the Falkirk relay use?',
    );
    expect(result.answer).toBeNull();
    expect(result.reason).toBe('no_relevant_content');
    expect(result.references).toEqual([]);
    // The other base's instance and the shared pool were never contacted.
    expect(fetchedUrls.every((u) => u.startsWith(K2_ENDPOINT))).toBe(true);
  });

  test('an empty base answers nothing and the retrieval service is not even asked', async () => {
    const empty = base({ id: 'k3', instanceEndpoint: K2_ENDPOINT });
    const { service, fetchedUrls } = makeHarness([empty], []);
    const result = await service.query('k3', 'anything');
    expect(result.answer).toBeNull();
    expect(result.reason).toBe('no_relevant_content');
    expect(fetchedUrls).toHaveLength(0);
  });

  test('a migrated base with its instance down fails loudly — never falls back to the shared pool', async () => {
    const down = base({
      id: 'k4',
      instanceState: 'failed',
      instanceError: 'CrashLoopBackOff',
      instanceEndpoint: K1_ENDPOINT,
    });
    const { service, fetchedUrls } = makeHarness(
      [down],
      [source({ id: 'src-k4', knowledgeId: 'k4' })],
    );
    await expect(service.query('k4', 'anything')).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(fetchedUrls).toHaveLength(0);
  });

  test('deleting one base leaves the other answering as before (US1 scenario 6)', async () => {
    const { service } = makeHarness([k1], [srcK1]);
    const result = await service.query('k1', 'Falkirk port?');
    expect(result.answer).toContain('7731');
  });
});

// CLEAN-184: the agent path no longer asks for an answer; it asks for the
// passages. Every guarantee above holds there too, through the real client
// and the real routing against the same fake network.
describe('SC-001 on the passages path — a passage comes only from the base that was asked', () => {
  const k1 = base({ id: 'k1', name: 'Relays', instanceEndpoint: K1_ENDPOINT });
  const k2 = base({ id: 'k2', name: 'Botany', instanceEndpoint: K2_ENDPOINT });
  const srcK1 = source({ id: 'src-k1', knowledgeId: 'k1', name: 'relays.txt' });
  const srcK2 = source({ id: 'src-k2', knowledgeId: 'k2', name: 'plants.txt' });
  const QUESTION = 'What port does the Falkirk relay use?';

  test('the base that holds the fact hands over its passage, verbatim and bound to its own row', async () => {
    const { service, fetchedUrls } = makeHarness([k1, k2], [srcK1, srcK2]);
    const result = await service.retrieveContext('k1', QUESTION);

    expect(result.via).toBe('query_data');
    expect(result.passages).toHaveLength(1);
    expect(result.passages[0].text).toBe(
      `${FALKIRK_FACT}, per the commissioning record.`,
    );
    expect(result.passages[0].sourceId).toBe('src-k1');
    expect(result.passages[0].sourceName).toBe('relays.txt');
    expect(result.references).toEqual([
      {
        referenceId: '1',
        filePath: 'src-k1',
        sourceId: 'src-k1',
        sourceName: 'relays.txt',
      },
    ]);
    expect(result.reason).toBeUndefined();
    expect(fetchedUrls.every((u) => u.startsWith(K1_ENDPOINT))).toBe(true);
    expect(JSON.stringify(result)).not.toContain('POISON');
  });

  test('the base without the fact says no_relevant_content — no passage borrowed from anywhere', async () => {
    const { service, fetchedUrls } = makeHarness([k1, k2], [srcK1, srcK2]);
    const result = await service.retrieveContext('k2', QUESTION);

    expect(result.reason).toBe('no_relevant_content');
    expect(result.passages).toEqual([]);
    expect(result.facts).toEqual([]);
    expect(result.via).toBe('query_data');
    expect(fetchedUrls.every((u) => u.startsWith(K2_ENDPOINT))).toBe(true);
  });

  test('an empty isolated base answers nothing and the retrieval service is not even asked', async () => {
    const empty = base({ id: 'k3', instanceEndpoint: K2_ENDPOINT });
    const { service, fetchedUrls } = makeHarness([empty], []);
    const result = await service.retrieveContext('k3', 'anything');

    expect(result.reason).toBe('no_relevant_content');
    expect(result.via).toBeNull();
    expect(fetchedUrls).toHaveLength(0);
  });

  test('a migrated base with its instance down fails loudly — never falls back to the shared pool', async () => {
    const down = base({
      id: 'k4',
      instanceState: 'failed',
      instanceError: 'CrashLoopBackOff',
      instanceEndpoint: K1_ENDPOINT,
    });
    const { service, fetchedUrls } = makeHarness(
      [down],
      [source({ id: 'src-k4', knowledgeId: 'k4' })],
    );
    await expect(service.retrieveContext('k4', 'anything')).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(fetchedUrls).toHaveLength(0);
  });

  test('a base still on the shared pool reads the shared pool, and says it is not complete', async () => {
    const pooled = base({
      id: 'k5',
      migrationState: 'notStarted',
      instanceState: 'absent',
      instanceEndpoint: null,
    });
    const { service, fetchedUrls } = makeHarness(
      [pooled],
      [source({ id: 'shared.txt', knowledgeId: 'k5', name: 'shared.txt' })],
    );
    const result = await service.retrieveContext('k5', QUESTION);

    expect(fetchedUrls[0].startsWith(SHARED_ENDPOINT)).toBe(true);
    expect(result.complete).toBe(false);
    expect(result.passages[0].sourceId).toBe('shared.txt');
  });
});

describe('routing policy — the transition never leaks', () => {
  const shared: LightragRequestConfig = {
    url: SHARED_ENDPOINT,
    apiKey: 'k',
    enabled: true,
  };

  test('a migrated base routes reads and writes to its own instance', () => {
    const row = {
      migrationState: 'done',
      readerAccess: 'closed',
      instanceState: 'ready',
      instanceEndpoint: K1_ENDPOINT,
    };
    for (const intent of ['read', 'write'] as const) {
      const cfg = routeLightragConfig(shared, row, {
        knowledgeId: 'k1',
        intent,
      });
      expect(cfg.url).toBe(K1_ENDPOINT);
      expect(cfg.enabled).toBe(true);
    }
  });

  test('a migrated base whose instance is down is disabled — not redirected to the shared pool', () => {
    const row = {
      migrationState: 'done',
      readerAccess: 'closed',
      instanceState: 'failed',
      instanceEndpoint: K1_ENDPOINT,
    };
    const cfg = routeLightragConfig(shared, row, {
      knowledgeId: 'k1',
      intent: 'read',
    });
    expect(cfg.enabled).toBe(false);
    expect(cfg.url).not.toBe(SHARED_ENDPOINT);
  });

  test('an unmigrated base still reads the shared pool, but writes target its own instance once ready', () => {
    const row = {
      migrationState: 'inProgress',
      readerAccess: 'closed',
      instanceState: 'ready',
      instanceEndpoint: K1_ENDPOINT,
    };
    const read = routeLightragConfig(shared, row, {
      knowledgeId: 'k1',
      intent: 'read',
    });
    const write = routeLightragConfig(shared, row, {
      knowledgeId: 'k1',
      intent: 'write',
    });
    expect(read.url).toBe(SHARED_ENDPOINT);
    expect(write.url).toBe(K1_ENDPOINT);
  });

  test('no context means the shared/legacy endpoint', () => {
    expect(routeLightragConfig(shared, null, undefined).url).toBe(
      SHARED_ENDPOINT,
    );
  });
});

describe('no-relevant-content detection', () => {
  test('recognises the retrieval service fail responses', () => {
    expect(isNoRelevantContentAnswer(NO_CONTEXT_ANSWER)).toBe(true);
    expect(
      isNoRelevantContentAnswer(
        "Sorry, I'm not able to provide an answer to that question.",
      ),
    ).toBe(true);
  });

  test('does not swallow real answers', () => {
    expect(isNoRelevantContentAnswer(`${FALKIRK_FACT}.`)).toBe(false);
  });
});

// CLEAN-184, console path: the retrieval model's partial refusals used to
// come back as the base's answer. The agent no longer sees generated text;
// the console still does, so it marks these for what they are.
describe('partial-refusal detection on the console path (CLEAN-184)', () => {
  const REFUSALS = [
    // production, Mazda3 AFS, 2026-10
    'I do not have sufficient information in the provided knowledge base to generate a comprehensive list of 2026 Mazda3 Hatchback trim levels.',
    // production, CX-30 trims and pricing, 2026-10-28
    'I do not have complete information about the full 2026 Mazda CX-30 trim lineup specifications in the provided context.',
    'I do not have sufficient information in the provided context to answer your query about the 2026 CX-30 Aire Edition Turbo pricing and trim details.',
    // production, 2025 CX-30, 2026-10-28
    "I don't have access to the 2025 Mazda CX-30 specification document.",
    // wordings from the ticket's root-cause note and the server's own literal
    'The documents do not have enough information to answer that.',
    'The provided knowledge base does not contain enough information about pricing.',
    'The context does not provide a complete list of trims.',
    'I am not able to provide a complete breakdown by trim.',
    'There is insufficient information in the provided knowledge base to answer.',
    'No relevant context found for the query.',
  ];

  test.each(REFUSALS)('recognises: %s', (text) => {
    expect(isPartialRefusal(text)).toBe(true);
  });

  test('does not flag a real answer, nor the canned no-context answer (that one is no_relevant_content)', () => {
    expect(isPartialRefusal(`${FALKIRK_FACT}.`)).toBe(false);
    expect(
      isPartialRefusal(
        'AFS is standard on 2.5 S Premium and 2.5 Turbo Premium Plus; the 2.5 S does not have it and the Preferred does not provide it either.',
      ),
    ).toBe(false);
    expect(isPartialRefusal(NO_CONTEXT_ANSWER)).toBe(false);
  });

  const k1 = base({ id: 'k1', name: 'Relays', instanceEndpoint: K1_ENDPOINT });
  const srcK1 = source({ id: 'src-k1', knowledgeId: 'k1', name: 'relays.txt' });

  test("the console query reports a partial refusal as such, not as the base's answer", async () => {
    const { service } = makeHarness(
      [k1],
      [srcK1],
      'I do not have sufficient information in the provided context to answer that.',
    );
    const result = await service.query('k1', 'Falkirk port?');

    expect(result.answer).toBeNull();
    expect(result.reason).toBe('partial_refusal');
    expect(result.references).toEqual([]);
  });

  test('the console query still returns a written answer, unchanged and unflagged', async () => {
    const { service } = makeHarness([k1], [srcK1]);
    const result = await service.query('k1', 'Falkirk port?');

    expect(result.answer).toContain('7731');
    expect(result.reason).toBeUndefined();
    expect(result.references[0].sourceId).toBe('src-k1');
  });
});

describe('reference resolution', () => {
  const sources = [
    source({ id: 'src-a', knowledgeId: 'k1', name: 'doc.txt' }),
    source({
      id: 'src-b',
      knowledgeId: 'k1',
      name: 'site',
      url: 'https://example.org/page',
    }),
  ];

  test('resolves by source id (new ingests carry it in file_source)', () => {
    const ref = resolveReference(
      { referenceId: '1', filePath: 'src-a' },
      sources,
    );
    expect(ref.sourceId).toBe('src-a');
    expect(ref.sourceName).toBe('doc.txt');
  });

  test('falls back to name and url for pre-migration content', () => {
    expect(
      resolveReference({ referenceId: '1', filePath: 'doc.txt' }, sources)
        .sourceId,
    ).toBe('src-a');
    expect(
      resolveReference(
        { referenceId: '1', filePath: 'https://example.org/page' },
        sources,
      ).sourceId,
    ).toBe('src-b');
  });

  test('an unresolvable reference keeps sourceId null instead of being dropped', () => {
    const ref = resolveReference(
      { referenceId: '1', filePath: 'ghost.pdf' },
      sources,
    );
    expect(ref.sourceId).toBeNull();
    expect(ref.filePath).toBe('ghost.pdf');
  });
});

describe('resolveAdoptedReferences (CLEAN-138)', () => {
  const sources = [
    source({
      id: 'src-new',
      knowledgeId: 'k1',
      name: 'Регламент',
      lightragDocId: 'doc-1',
    }),
  ];

  test('maps a reference named after a vanished row to the row that adopted its document', () => {
    const unresolved = resolveReference(
      { referenceId: '1', filePath: 'src-old' },
      sources,
    );
    expect(unresolved.sourceId).toBeNull();
    const [fixed] = resolveAdoptedReferences([unresolved], sources, [
      { id: 'doc-1', filePath: 'src-old' },
    ]);
    expect(fixed).toMatchObject({
      sourceId: 'src-new',
      sourceName: 'Регламент',
    });
  });

  test('leaves resolved references alone and unknown ones unresolved', () => {
    const resolved = resolveReference(
      { referenceId: '1', filePath: 'src-new' },
      sources,
    );
    const [same, still] = resolveAdoptedReferences(
      [
        resolved,
        {
          referenceId: '2',
          filePath: 'ghost',
          sourceId: null,
          sourceName: null,
        },
      ],
      sources,
      [{ id: 'doc-9', filePath: 'ghost' }],
    );
    expect(same).toBe(resolved);
    expect(still.sourceId).toBeNull();
  });
});
