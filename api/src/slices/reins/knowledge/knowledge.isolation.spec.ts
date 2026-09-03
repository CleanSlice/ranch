// SC-001 executable: an answer comes only from the base that was asked.
// Two simulated retrieval instances with disjoint content; the real client
// and the real routing policy sit between the service and the fake network,
// so what is asserted is the actual read path — which endpoint a query hits,
// and that a base with no coverage says so instead of borrowing.

import { ServiceUnavailableException } from '@nestjs/common';
import {
  KnowledgeService,
  isNoRelevantContentAnswer,
  resolveReference,
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
    sourceCount: 0,
    indexedCount: 0,
    failedCount: 0,
    processingCount: 0,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...p,
  };
}

function source(
  p: Partial<ISourceData> & { id: string; knowledgeId: string },
): ISourceData {
  return {
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
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...p,
  };
}

interface Harness {
  service: KnowledgeService;
  fetchedUrls: string[];
}

function makeHarness(bases: IKnowledgeData[], sources: ISourceData[]): Harness {
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
    if (url.startsWith(K1_ENDPOINT) && url.endsWith('/query')) {
      return jsonResponse({
        response: `${FALKIRK_FACT}, per the commissioning record.`,
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

describe('routing policy — the transition never leaks', () => {
  const shared: LightragRequestConfig = {
    url: SHARED_ENDPOINT,
    apiKey: 'k',
    enabled: true,
  };

  test('a migrated base routes reads and writes to its own instance', () => {
    const row = {
      migrationState: 'done',
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
