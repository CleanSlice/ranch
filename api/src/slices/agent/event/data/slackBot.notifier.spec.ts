import { SlackBotNotifier } from './slackBot.notifier';

const CRED = { token: 'xoxb-SECRETSECRET', channelId: 'C0123456789' };
const MESSAGE = { text: 'Support Bot — incident #12', blocks: [] };

function answer(
  status: number,
  body: unknown = { ok: true },
  headers: Record<string, string> = {},
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

describe('SlackBotNotifier', () => {
  const notifier = new SlackBotNotifier();
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  const callOf = (n = 0) => {
    const [url, init] = fetchMock.mock.calls[n] as [string, RequestInit];
    return {
      url,
      body: JSON.parse(init.body as string) as Record<string, unknown>,
      auth: (init.headers as Record<string, string>).Authorization,
    };
  };

  describe('post', () => {
    it('posts to the channel with the token in the header and hands the ts back', async () => {
      fetchMock.mockResolvedValue(answer(200, { ok: true, ts: '1712.0001' }));

      const result = await notifier.post(CRED, MESSAGE);

      expect(result).toEqual({ ok: true, ts: '1712.0001' });
      const call = callOf();
      expect(call.url).toBe('https://slack.com/api/chat.postMessage');
      expect(call.auth).toBe(`Bearer ${CRED.token}`);
      expect(call.body).toMatchObject({
        channel: CRED.channelId,
        text: MESSAGE.text,
        unfurl_links: false,
      });
      expect(call.body.thread_ts).toBeUndefined();
    });

    it('replies in a thread when given its root', async () => {
      fetchMock.mockResolvedValue(answer(200, { ok: true, ts: '1712.0002' }));

      await notifier.post(CRED, MESSAGE, '1712.0001');

      expect(callOf().body.thread_ts).toBe('1712.0001');
    });

    it('does not trust an acceptance without an id', async () => {
      fetchMock.mockResolvedValue(answer(200, { ok: true }));

      expect(await notifier.post(CRED, MESSAGE)).toMatchObject({
        ok: false,
        retryable: false,
      });
    });
  });

  describe('update', () => {
    it('rewrites the message by its ts', async () => {
      fetchMock.mockResolvedValue(answer(200, { ok: true }));

      expect(await notifier.update(CRED, '1712.0001', MESSAGE)).toEqual({
        ok: true,
      });
      const call = callOf();
      expect(call.url).toBe('https://slack.com/api/chat.update');
      expect(call.body).toMatchObject({
        channel: CRED.channelId,
        ts: '1712.0001',
        text: MESSAGE.text,
      });
    });

    it.each(['message_not_found', 'cant_update_message', 'edit_window_closed'])(
      'reports a lost rewrite (%s) as final, in words for the owner',
      async (code) => {
        fetchMock.mockResolvedValue(answer(200, { ok: false, error: code }));

        expect(await notifier.update(CRED, '1712.0001', MESSAGE)).toEqual({
          ok: false,
          retryable: false,
          error: `Could not update the incident message: ${code}`,
        });
      },
    );
  });

  describe('setReaction', () => {
    it('removes the previous reaction before adding the new one', async () => {
      fetchMock.mockResolvedValue(answer(200, { ok: true }));

      const result = await notifier.setReaction(
        CRED,
        '1712.0001',
        'white_check_mark',
        'red_circle',
      );

      expect(result).toEqual({ ok: true });
      expect(callOf(0).url).toBe('https://slack.com/api/reactions.remove');
      expect(callOf(0).body).toMatchObject({
        timestamp: '1712.0001',
        name: 'red_circle',
      });
      expect(callOf(1).url).toBe('https://slack.com/api/reactions.add');
      expect(callOf(1).body).toMatchObject({ name: 'white_check_mark' });
    });

    it('only adds when there is nothing to remove', async () => {
      fetchMock.mockResolvedValue(answer(200, { ok: true }));

      await notifier.setReaction(CRED, '1712.0001', 'red_circle', null);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(callOf().url).toBe('https://slack.com/api/reactions.add');
    });

    it('treats "already there" and "was not there" as the state it wanted', async () => {
      fetchMock
        .mockResolvedValueOnce(answer(200, { ok: false, error: 'no_reaction' }))
        .mockResolvedValueOnce(
          answer(200, { ok: false, error: 'already_reacted' }),
        );

      expect(
        await notifier.setReaction(
          CRED,
          '1712.0001',
          'large_green_circle',
          'red_circle',
        ),
      ).toEqual({ ok: true });
    });
  });

  describe("Slack's answers", () => {
    it.each([
      ['invalid_auth', 'The bot token is not valid — paste a new one'],
      ['token_revoked', 'The bot token was revoked — paste a new one'],
      ['channel_not_found', 'No channel with this id'],
      [
        'not_in_channel',
        'The bot is not in the channel — invite it (/invite @<the bot>)',
      ],
      ['is_archived', 'The channel is archived'],
    ])(
      'turns %s into words the owner can act on, with no retry',
      async (code, words) => {
        fetchMock.mockResolvedValue(answer(200, { ok: false, error: code }));

        expect(await notifier.post(CRED, MESSAGE)).toEqual({
          ok: false,
          retryable: false,
          error: words,
        });
      },
    );

    it('names the permission the bot lacks', async () => {
      fetchMock.mockResolvedValue(
        answer(200, {
          ok: false,
          error: 'missing_scope',
          needed: 'reactions:write',
        }),
      );

      expect(await notifier.post(CRED, MESSAGE)).toMatchObject({
        retryable: false,
        error: 'The bot lacks a permission: reactions:write',
      });
    });

    it('passes on how long Slack asks to wait when it is rate-limiting', async () => {
      fetchMock.mockResolvedValue(
        answer(429, 'ratelimited', { 'retry-after': '20' }),
      );

      expect(await notifier.post(CRED, MESSAGE)).toEqual({
        ok: false,
        retryable: true,
        retryAfterMs: 20_000,
        error: 'Slack answered 429',
      });
    });

    it('retries a 5xx and gives up on a 4xx that is not Slack JSON', async () => {
      fetchMock.mockResolvedValueOnce(answer(503, 'upstream'));
      expect(await notifier.post(CRED, MESSAGE)).toMatchObject({
        retryable: true,
      });

      fetchMock.mockResolvedValueOnce(answer(400, 'bad request'));
      expect(await notifier.post(CRED, MESSAGE)).toMatchObject({
        retryable: false,
      });
    });

    it('retries after a timeout, and says so in words of its own', async () => {
      fetchMock.mockRejectedValue(
        Object.assign(new Error('timeout'), { name: 'TimeoutError' }),
      );

      expect(await notifier.post(CRED, MESSAGE)).toEqual({
        ok: false,
        retryable: true,
        error: 'Slack did not answer within 5 s',
      });
    });

    it('never quotes the token, even when Slack echoes it', async () => {
      fetchMock.mockResolvedValue(
        answer(200, { ok: false, error: `bad token ${CRED.token} rejected` }),
      );

      const result = await notifier.post(CRED, MESSAGE);

      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain('SECRETSECRET');
      expect(JSON.stringify(result)).toContain('[token]');
    });
  });
});
