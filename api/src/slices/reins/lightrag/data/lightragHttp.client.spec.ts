import { LightragHttpClient } from './lightragHttp.client';
import { LightragTimeoutError } from '../domain/lightrag.types';

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
      Promise.resolve({ url: 'http://lightrag:9621', apiKey: 'k', enabled: true }),
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
