import { LightragHttpClient } from './lightragHttp.client';
import {
  LightragClientError,
  LightragTimeoutError,
} from '../domain/lightrag.types';

type FetchImpl = typeof fetch;

type FetchMock = jest.Mock<Promise<Response>, [string, RequestInit?]>;

/** A LightRAG that takes the connection and never answers, until aborted. */
function hangingFetch(): FetchMock {
  return jest.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(
            Object.assign(new Error('This operation was aborted'), {
              name: 'AbortError',
            }),
          );
        });
      }),
  );
}

function makeClient(fetchImpl: FetchMock): LightragHttpClient {
  return new LightragHttpClient({
    resolveConfig: () =>
      Promise.resolve({
        url: 'http://lightrag:9621',
        apiKey: 'k',
        enabled: true,
      }),
    fetchImpl: fetchImpl as unknown as FetchImpl,
  });
}

describe('LightragHttpClient: a LightRAG that never answers', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('gives up on a query before the MCP client does, and says what it waited for', async () => {
    // The MCP client stops at 60 s with a transport error that reads as "MCP
    // is broken". Stopping first is what lets the tool answer in words.
    const client = makeClient(hangingFetch());

    const pending = client.query({ knowledgeId: 'k1', query: 'anything' });
    const outcome = expect(pending).rejects.toThrow(
      'LightRAG /query timed out after 50 s',
    );
    await jest.advanceTimersByTimeAsync(50_000);

    await outcome;
    await expect(pending).rejects.toBeInstanceOf(LightragTimeoutError);
  });

  it('does not give up on a query a second early', async () => {
    const client = makeClient(hangingFetch());
    let settled = false;

    const pending = client
      .query({ knowledgeId: 'k1', query: 'anything' })
      .catch(() => undefined)
      .finally(() => {
        settled = true;
      });
    await jest.advanceTimersByTimeAsync(49_000);
    expect(settled).toBe(false);

    await jest.advanceTimersByTimeAsync(1_000);
    await pending;
    expect(settled).toBe(true);
  });

  it('bounds the status reads the reconciler makes inside its lock', async () => {
    // One unbounded listDocuments and no reconcile pass ever runs again.
    const client = makeClient(hangingFetch());

    const documents = expect(client.listDocuments('k1')).rejects.toThrow(
      'LightRAG /documents timed out after 30 s',
    );
    const pipeline = expect(client.getPipelineStatus('k1')).rejects.toThrow(
      'LightRAG /documents/pipeline_status timed out after 30 s',
    );
    const track = expect(
      client.getTrackStatus('k1', 'track-9'),
    ).rejects.toBeInstanceOf(LightragTimeoutError);
    await jest.advanceTimersByTimeAsync(30_000);

    await Promise.all([documents, pipeline, track]);
  });

  it('hands the abort signal to fetch so the socket is released too', async () => {
    const fetchImpl = hangingFetch();
    const client = makeClient(fetchImpl);

    const pending = client.listDocuments('k1').catch(() => undefined);
    await jest.advanceTimersByTimeAsync(30_000);
    await pending;

    const [, init] = fetchImpl.mock.calls[0];
    expect(init?.signal?.aborted).toBe(true);
  });
});

describe('LightragHttpClient: a LightRAG that answers', () => {
  it('returns the answer and leaves no timer behind', async () => {
    jest.useFakeTimers();
    try {
      const fetchImpl: FetchMock = jest.fn((_url: string) =>
        Promise.resolve(
          new Response(JSON.stringify({ statuses: {} }), { status: 200 }),
        ),
      );
      const client = makeClient(fetchImpl);

      expect(await client.listDocuments('k1')).toEqual([]);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('passes any other failure through untouched', async () => {
    const fetchImpl: FetchMock = jest.fn((_url: string) =>
      Promise.reject<Response>(new TypeError('fetch failed')),
    );
    const client = makeClient(fetchImpl);

    const failure = client.listDocuments('k1');

    await expect(failure).rejects.toThrow('fetch failed');
    await expect(failure).rejects.not.toBeInstanceOf(LightragTimeoutError);
  });
});

// CLEAN-184: the agent path asks for what LightRAG found, never for what its
// model wrote. The structured route is preferred; the text-context route is
// the fallback for a deployment that predates it.
describe('LightragHttpClient.retrieveContext: passages, not prose (CLEAN-184)', () => {
  const AFS_ROW =
    'Headlights - adaptive Front-Lighting System (AFS) | - | - | - | Std | - | Std';

  const DATA_BODY = {
    status: 'success',
    message: 'Query processed successfully',
    data: {
      entities: [
        {
          entity_name: 'AFS',
          entity_type: 'feature',
          description: 'model-written summary, never forwarded',
          file_path: 'deck.docx',
          reference_id: '1',
        },
      ],
      relationships: [
        {
          src_id: 'AFS',
          tgt_id: '2.5 S Premium',
          description: 'standard on',
          keywords: 'lighting',
          weight: 1,
          file_path: 'deck.docx',
          reference_id: '1',
        },
      ],
      chunks: [
        {
          content: AFS_ROW,
          file_path: 'deck.docx',
          chunk_id: 'chunk-1',
          reference_id: '1',
        },
        { content: 'a chunk the server forgot to label' },
        {
          content: 'second',
          file_path: 'guide.md',
          chunk_id: 'chunk-2',
          reference_id: '2',
        },
      ],
      references: [
        { reference_id: '1', file_path: 'deck.docx' },
        { reference_id: '2', file_path: 'guide.md' },
      ],
    },
    metadata: { query_mode: 'naive' },
  };

  const CONTEXT_TEXT = [
    '-----Knowledge Graph Data (Entity):-----',
    '```json',
    '[{"entity":"AFS","type":"feature","description":"d","created_at":"x","file_path":"deck.docx"}]',
    '```',
    '',
    '-----Knowledge Graph Data (Relationship):-----',
    '```json',
    '[{"entity1":"AFS","entity2":"2.5 S Premium","description":"standard on","created_at":"x","file_path":"deck.docx"}]',
    '```',
    '',
    '-----Document Chunks (Each entry has a reference_id refer to the `Reference Document List`):-----',
    '```json',
    `[{"reference_id":"1","file_path":"deck.docx","content":${JSON.stringify(AFS_ROW)}},{"reference_id":"2","file_path":"guide.md","content":"second"}]`,
    '```',
    '',
    '-----Reference Document List (Each entry starts with a [reference_id]):-----',
    '```',
    '[1] deck.docx',
    '[2] guide.md',
    '```',
  ].join('\n');

  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status });
  }

  function sentBody(
    fetchImpl: FetchMock,
    call: number,
  ): Record<string, unknown> {
    const init = fetchImpl.mock.calls[call][1];
    const body = init?.body;
    if (typeof body !== 'string') throw new Error('request body is not a string');
    return JSON.parse(body) as Record<string, unknown>;
  }

  it('asks /query/data for retrieval only and maps chunks, relations and references in order', async () => {
    const fetchImpl: FetchMock = jest.fn((_url: string) =>
      Promise.resolve(jsonResponse(DATA_BODY)),
    );
    const client = makeClient(fetchImpl);

    const result = await client.retrieveContext({
      knowledgeId: 'k1',
      query: 'adaptive headlights trims',
    });

    expect(fetchImpl.mock.calls[0][0]).toBe('http://lightrag:9621/query/data');
    expect(sentBody(fetchImpl, 0)).toEqual({
      query: 'adaptive headlights trims',
      mode: 'naive',
      top_k: 20,
      chunk_top_k: 12,
      include_references: true,
    });
    expect(result.via).toBe('query_data');
    // The unlabelled chunk is dropped; the order of the rest is the server's.
    expect(result.chunks).toEqual([
      { text: AFS_ROW, filePath: 'deck.docx', chunkId: 'chunk-1' },
      { text: 'second', filePath: 'guide.md', chunkId: 'chunk-2' },
    ]);
    expect(result.relations).toEqual([
      { source: 'AFS', target: '2.5 S Premium', description: 'standard on' },
    ]);
    expect(result.references).toEqual([
      { referenceId: '1', filePath: 'deck.docx' },
      { referenceId: '2', filePath: 'guide.md' },
    ]);
    expect(JSON.stringify(result)).not.toContain('model-written summary');
  });

  it('treats status "failure" (nothing matched) as an empty result, not an error', async () => {
    const fetchImpl: FetchMock = jest.fn((_url: string) =>
      Promise.resolve(
        jsonResponse({
          status: 'failure',
          message: 'No relevant context found for the query.',
          data: {},
          metadata: { failure_reason: 'no_results' },
        }),
      ),
    );
    const client = makeClient(fetchImpl);

    const result = await client.retrieveContext({
      knowledgeId: 'k1',
      query: 'nothing',
    });

    expect(result).toEqual({
      chunks: [],
      relations: [],
      references: [],
      via: 'query_data',
    });
  });

  it('falls back to /query with only_need_context when /query/data is missing (404)', async () => {
    const fetchImpl: FetchMock = jest.fn((url: string) =>
      Promise.resolve(
        url.endsWith('/query/data')
          ? new Response('Not Found', { status: 404 })
          : jsonResponse({ response: CONTEXT_TEXT, references: [] }),
      ),
    );
    const client = makeClient(fetchImpl);

    const result = await client.retrieveContext({
      knowledgeId: 'k1',
      query: 'adaptive headlights',
    });

    expect(fetchImpl.mock.calls[1][0]).toBe('http://lightrag:9621/query');
    expect(sentBody(fetchImpl, 1)).toMatchObject({
      query: 'adaptive headlights',
      mode: 'naive',
      only_need_context: true,
    });
    expect(result.via).toBe('only_need_context');
    expect(result.chunks).toEqual([
      { text: AFS_ROW, filePath: 'deck.docx', chunkId: null },
      { text: 'second', filePath: 'guide.md', chunkId: null },
    ]);
    expect(result.relations).toEqual([
      { source: 'AFS', target: '2.5 S Premium', description: 'standard on' },
    ]);
    expect(result.references).toEqual([
      { referenceId: '1', filePath: 'deck.docx' },
      { referenceId: '2', filePath: 'guide.md' },
    ]);
  });

  it('fails loudly when the fallback text has no Document Chunks block', async () => {
    const fetchImpl: FetchMock = jest.fn((url: string) =>
      Promise.resolve(
        url.endsWith('/query/data')
          ? new Response('Not Found', { status: 404 })
          : jsonResponse({
              response:
                "Sorry, I'm not able to provide an answer to that question.[no-context]",
            }),
      ),
    );
    const client = makeClient(fetchImpl);

    const failure = client.retrieveContext({ knowledgeId: 'k1', query: 'x' });

    await expect(failure).rejects.toBeInstanceOf(LightragClientError);
    await expect(failure).rejects.toThrow('Document Chunks');
  });

  it('passes any other HTTP failure through as a client error', async () => {
    const fetchImpl: FetchMock = jest.fn((_url: string) =>
      Promise.resolve(new Response('boom', { status: 500 })),
    );
    const client = makeClient(fetchImpl);

    const failure = client.retrieveContext({ knowledgeId: 'k1', query: 'x' });

    await expect(failure).rejects.toThrow(
      'LightRAG /query/data failed: 500 boom',
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  describe('under the 30 s bound', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it('gives up on /query/data after 30 s with a timeout the tool can name', async () => {
      // Generation is gone; what is left is the same class of work as the
      // 30 s status reads, and it must stay under the MCP client's 60 s.
      const client = makeClient(hangingFetch());

      const pending = client.retrieveContext({
        knowledgeId: 'k1',
        query: 'anything',
      });
      const outcome = expect(pending).rejects.toThrow(
        'LightRAG /query/data timed out after 30 s',
      );
      await jest.advanceTimersByTimeAsync(30_000);

      await outcome;
      await expect(pending).rejects.toBeInstanceOf(LightragTimeoutError);
      expect(jest.getTimerCount()).toBe(0);
    });
  });
});
