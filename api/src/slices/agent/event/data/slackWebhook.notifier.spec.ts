import { SlackWebhookNotifier } from './slackWebhook.notifier';

const ADDRESS = 'https://hooks.slack.com/services/T000/B000/SECRETSECRET';
const MESSAGE = { text: 'Agent failed: Support Bot', blocks: [] };

function answer(
  status: number,
  body = '',
  headers: Record<string, string> = {},
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    text: async () => body,
  } as unknown as Response;
}

describe('SlackWebhookNotifier', () => {
  const notifier = new SlackWebhookNotifier();
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  it('posts the message as JSON to the address', async () => {
    fetchMock.mockResolvedValue(answer(200, 'ok'));

    const result = await notifier.send(ADDRESS, MESSAGE);

    expect(result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(ADDRESS);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual(MESSAGE);
    expect(init.signal).toBeDefined();
  });

  it.each([400, 403, 404, 410])(
    'treats %d as final: the address is wrong, revoked or gone',
    async (status) => {
      fetchMock.mockResolvedValue(answer(status, 'no_service'));

      const result = await notifier.send(ADDRESS, MESSAGE);

      expect(result).toEqual({
        ok: false,
        retryable: false,
        error: `Slack answered ${status}: no_service`,
      });
    },
  );

  it.each([500, 502, 503])('treats %d as worth another try', async (status) => {
    fetchMock.mockResolvedValue(answer(status));

    const result = await notifier.send(ADDRESS, MESSAGE);

    expect(result).toEqual({
      ok: false,
      retryable: true,
      error: `Slack answered ${status}`,
    });
  });

  it('passes on how long Slack asks to wait when it is rate-limiting', async () => {
    fetchMock.mockResolvedValue(
      answer(429, 'rate_limited', { 'retry-after': '30' }),
    );

    const result = await notifier.send(ADDRESS, MESSAGE);

    expect(result).toEqual({
      ok: false,
      retryable: true,
      retryAfterMs: 30_000,
      error: 'Slack answered 429: rate_limited',
    });
  });

  it('retries after a timeout, and says so in words of its own', async () => {
    fetchMock.mockRejectedValue(
      Object.assign(new Error(`timeout calling ${ADDRESS}`), {
        name: 'TimeoutError',
      }),
    );

    const result = await notifier.send(ADDRESS, MESSAGE);

    expect(result).toEqual({
      ok: false,
      retryable: true,
      error: 'Slack did not answer within 5 s',
    });
  });

  it('never lets the address into what it returns', async () => {
    const results: unknown[] = [];
    fetchMock.mockRejectedValueOnce(
      new Error(`getaddrinfo failed for ${ADDRESS}`),
    );
    results.push(await notifier.send(ADDRESS, MESSAGE));
    fetchMock.mockResolvedValueOnce(answer(404, `no such hook ${ADDRESS}`));
    results.push(await notifier.send(ADDRESS, MESSAGE));

    for (const result of results) {
      expect(JSON.stringify(result)).not.toContain('SECRETSECRET');
    }
  });

  it('keeps a long answer short', async () => {
    fetchMock.mockResolvedValue(answer(500, 'x'.repeat(5000)));

    const result = await notifier.send(ADDRESS, MESSAGE);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeLessThan(330);
  });
});
