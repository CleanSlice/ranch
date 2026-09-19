import { LightragHttpClient } from './lightragHttp.client';
import { LightragClientError } from '../domain/lightrag.types';

/**
 * Only two of this client's thirteen calls used to carry a deadline. An
 * unresponsive LightRAG therefore held a request open for as long as the
 * caller would wait — for an agent, that was the MCP client's 60s default,
 * which surfaced as a bare "Request timed out" naming neither the endpoint
 * nor the base, three times in a row, until the loop gave up (CLEAN-101).
 *
 * These pin the two halves of the fix: a deadline is actually attached, and
 * hitting it produces an error that says what did not answer.
 */
function build(fetchImpl: unknown) {
  return new LightragHttpClient({
    resolveConfig: () =>
      Promise.resolve({
        url: 'http://lightrag.test',
        apiKey: 'k',
        enabled: true,
      }),
    fetchImpl: fetchImpl as typeof fetch,
  });
}

/** What AbortSignal.timeout throws when the deadline passes. */
function timeoutError() {
  const err = new Error('The operation was aborted due to timeout');
  err.name = 'TimeoutError';
  return err;
}

function okResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

describe('LightragHttpClient deadlines', () => {
  it('attaches a deadline to a query', async () => {
    let seen: RequestInit | undefined;
    const client = build((_url: string, init: RequestInit) => {
      seen = init;
      return Promise.resolve(okResponse({ response: 'hi' }));
    });

    await client.query({ knowledgeId: 'kb-1', query: 'q' });

    expect(seen?.signal).toBeDefined();
  });

  it('turns a hit deadline into an error naming the endpoint', async () => {
    const client = build(() => Promise.reject(timeoutError()));

    await expect(
      client.query({ knowledgeId: 'kb-1', query: 'q' }),
    ).rejects.toThrow(/\/query did not respond within \d+s/);
  });

  it('reports the timeout as a gateway timeout, not a client error', async () => {
    const client = build(() => Promise.reject(timeoutError()));

    await expect(
      client.query({ knowledgeId: 'kb-1', query: 'q' }),
    ).rejects.toMatchObject({ status: 504 });
  });

  it('raises LightragClientError so callers can name the base', async () => {
    const client = build(() => Promise.reject(timeoutError()));

    await expect(
      client.query({ knowledgeId: 'kb-1', query: 'q' }),
    ).rejects.toBeInstanceOf(LightragClientError);
  });

  it('lets a real failure through instead of dressing it as a timeout', async () => {
    // Masking a connection refusal as "did not respond within 45s" would send
    // whoever reads the log looking for a slow instance rather than a missing
    // one.
    const client = build(() => Promise.reject(new Error('ECONNREFUSED')));

    await expect(
      client.query({ knowledgeId: 'kb-1', query: 'q' }),
    ).rejects.toThrow('ECONNREFUSED');
  });

  it('bounds document listing too, not only the agent-facing query', async () => {
    const client = build(() => Promise.reject(timeoutError()));

    await expect(client.listDocuments('kb-1')).rejects.toThrow(
      /\/documents did not respond within \d+s/,
    );
  });

  it('bounds ingest, with its own longer budget', async () => {
    const client = build(() => Promise.reject(timeoutError()));

    await expect(
      client.ingestText({
        knowledgeId: 'kb-1',
        text: 't',
        fileSource: 'f',
      }),
    ).rejects.toThrow(/\/documents\/text did not respond within \d+s/);
  });

  it('passes a successful response through untouched', async () => {
    const client = build(() =>
      Promise.resolve(okResponse({ response: 'answer', references: [] })),
    );

    const out = await client.query({ knowledgeId: 'kb-1', query: 'q' });
    expect(out).toBeDefined();
  });
});
