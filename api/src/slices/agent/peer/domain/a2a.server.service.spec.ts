import type { ConfigService } from '@nestjs/config';
import { A2aServerService } from './a2a.server.service';
import { A2aTaskStore } from './a2aTask.store';
import { A2aErrorCodes, A2aRpcError, A2aTaskStates } from './a2a.types';
import type { IA2aSendMessageParams } from './a2a.types';
import type { IBridleGateway } from '#/bridle/domain/bridle.gateway';
import type { BridleSyncService } from '#/bridle/domain/bridleSync.service';
import type { IAgentGateway } from '#/agent/agent/domain';

/**
 * The receiving half of a delegation. Every case here exists because the
 * caller is a language model: a silence, an empty answer or a fabricated one
 * would all be indistinguishable to it from a real reply, so each failure has
 * to come back as a task state with a cause written in words.
 */
function makeHarness(
  options: {
    connected?: boolean;
    reply?: { text: string; timedOut?: boolean };
    env?: Record<string, string>;
    agentName?: string;
  } = {},
) {
  const connected = options.connected ?? true;
  const sendAndAwait = jest.fn(async (_input: { capabilities?: string[] }) => ({
    text: options.reply?.text ?? 'the answer',
    messageId: 'm1',
    ts: 1,
    timedOut: options.reply?.timedOut ?? false,
  }));

  const hub = {
    isAgentConnected: jest.fn(() => connected),
  } as unknown as IBridleGateway;

  const agents = {
    findById: jest.fn(async () => ({
      id: 'agent-b',
      name: options.agentName ?? 'Support Bot',
    })),
  } as unknown as IAgentGateway;

  const store = new A2aTaskStore();
  const config = {
    get: (key: string) => options.env?.[key],
  } as unknown as ConfigService;

  const service = new A2aServerService(
    hub,
    { sendAndAwait } as unknown as BridleSyncService,
    agents,
    store,
    config,
  );

  return { service, sendAndAwait, hub, store };
}

const params = (
  overrides: Partial<IA2aSendMessageParams['message']> = {},
  configuration?: IA2aSendMessageParams['configuration'],
): IA2aSendMessageParams => ({
  message: {
    messageId: 'm-in',
    role: 'ROLE_USER',
    parts: [{ text: 'What is the return window for shoes?' }],
    ...overrides,
  },
  ...(configuration ? { configuration } : {}),
});

const withChain = (chain: string[]) =>
  params({ metadata: { ranch: { chain } } });

describe('A2aServerService.sendMessage — the happy path', () => {
  it('answers a completed task carrying the reply as one artifact', async () => {
    const { service } = makeHarness({ reply: { text: 'Within 30 days.' } });

    const task = await service.sendMessage('agent-b', 'agent-a', params());

    expect(task.status.state).toBe(A2aTaskStates.Completed);
    expect(task.artifacts).toHaveLength(1);
    expect(task.artifacts[0]).toMatchObject({
      artifactId: 'reply',
      parts: [{ text: 'Within 30 days.' }],
    });
  });

  it('talks to the runtime as one conversation per caller and context', async () => {
    const { service, sendAndAwait } = makeHarness();

    await service.sendMessage(
      'agent-b',
      'agent-a',
      params({ contextId: 'ctx-42' }),
    );

    expect(sendAndAwait).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent-b',
        clientId: 'peer:agent-a:ctx-42',
        text: 'What is the return window for shoes?',
      }),
    );
  });

  it('declares no capabilities, so the peer streams no timeline into a void', async () => {
    const { service, sendAndAwait } = makeHarness();

    await service.sendMessage('agent-b', 'agent-a', params());

    expect(sendAndAwait).toHaveBeenCalledWith(
      expect.objectContaining({ capabilities: [] }),
    );
  });

  it('mints a context when the caller supplies none, and keeps a given one', async () => {
    const { service } = makeHarness();

    const minted = await service.sendMessage('agent-b', 'agent-a', params());
    const given = await service.sendMessage(
      'agent-b',
      'agent-a',
      params({ contextId: 'ctx-42' }),
    );

    expect(minted.contextId).toMatch(/^ctx-/);
    expect(given.contextId).toBe('ctx-42');
  });

  it('appends itself to the chain it was called with', async () => {
    const { service } = makeHarness();

    const task = await service.sendMessage(
      'agent-b',
      'agent-a',
      withChain(['agent-a']),
    );

    expect(task.metadata?.ranch?.chain).toEqual(['agent-a', 'agent-b']);
  });

  it('hands back no history: a peer transcript is its own business', async () => {
    const { service } = makeHarness();

    const task = await service.sendMessage('agent-b', 'agent-a', params());

    expect(task.history).toEqual([]);
  });

  it('publishes the chain while it serves, so a second hop can continue it', async () => {
    const seen: string[][] = [];
    const { service, sendAndAwait } = makeHarness();
    sendAndAwait.mockImplementation(async (_input) => {
      seen.push(service.currentChain('agent-b'));
      return { text: 'ok', messageId: 'm', ts: 1, timedOut: false };
    });

    await service.sendMessage('agent-b', 'agent-a', withChain(['agent-a']));

    expect(seen).toEqual([['agent-a', 'agent-b']]);
    // …and stops publishing it the moment the turn is over.
    expect(service.currentChain('agent-b')).toEqual([]);
  });
});

describe('A2aServerService.sendMessage — honest failures', () => {
  it('fails fast when the peer is not running, without waiting or sending', async () => {
    const { service, sendAndAwait } = makeHarness({ connected: false });

    const task = await service.sendMessage('agent-b', 'agent-a', params());

    expect(task.status.state).toBe(A2aTaskStates.Failed);
    expect(task.metadata?.ranch?.failure).toBe('not_running');
    expect(task.status.message?.parts[0]).toEqual({ text: 'peer not running' });
    expect(task.artifacts).toEqual([]);
    expect(sendAndAwait).not.toHaveBeenCalled();
  });

  it('fails with a stated timeout rather than an empty answer', async () => {
    const { service } = makeHarness({
      reply: { text: '', timedOut: true },
      env: { A2A_SYNC_TIMEOUT_MS: '5000' },
    });

    const task = await service.sendMessage('agent-b', 'agent-a', params());

    expect(task.status.state).toBe(A2aTaskStates.Failed);
    expect(task.metadata?.ranch?.failure).toBe('timeout');
    expect(task.status.message?.parts[0]).toEqual({
      text: 'timed out after 5s',
    });
  });

  it('rejects a task that would put an agent back into its own chain', async () => {
    const { service, sendAndAwait } = makeHarness({ agentName: 'Support Bot' });

    const task = await service.sendMessage(
      'agent-b',
      'agent-a',
      withChain(['agent-b', 'agent-a']),
    );

    expect(task.status.state).toBe(A2aTaskStates.Rejected);
    expect(task.metadata?.ranch?.rejection).toBe('loop');
    expect(task.status.message?.parts[0]).toEqual({
      text: 'would loop: «Support Bot» is already in this chain',
    });
    expect(sendAndAwait).not.toHaveBeenCalled();
  });

  it('rejects a chain that has already used up its hops', async () => {
    const { service, sendAndAwait } = makeHarness();

    const task = await service.sendMessage(
      'agent-b',
      'agent-a',
      withChain(['a1', 'a2', 'a3']),
    );

    expect(task.status.state).toBe(A2aTaskStates.Rejected);
    expect(task.metadata?.ranch?.rejection).toBe('depth');
    expect(task.status.message?.parts[0]).toEqual({
      text: 'too deep: the chain limit is 3 hops',
    });
    expect(sendAndAwait).not.toHaveBeenCalled();
  });

  it('allows a chain that still has a hop left', async () => {
    const { service } = makeHarness();

    const task = await service.sendMessage(
      'agent-b',
      'agent-a',
      withChain(['a1', 'a2']),
    );

    expect(task.status.state).toBe(A2aTaskStates.Completed);
  });

  it('honours a configured chain limit', async () => {
    const { service } = makeHarness({ env: { A2A_MAX_CHAIN: '1' } });

    const task = await service.sendMessage(
      'agent-b',
      'agent-a',
      withChain(['agent-a']),
    );

    expect(task.metadata?.ranch?.rejection).toBe('depth');
  });

  it('ignores a chain a caller filled with nonsense', async () => {
    const { service } = makeHarness();

    const task = await service.sendMessage('agent-b', 'agent-a', {
      message: {
        messageId: 'm',
        role: 'ROLE_USER',
        parts: [{ text: 'hi' }],
        metadata: { ranch: { chain: 'not-an-array' } },
      },
    } as unknown as IA2aSendMessageParams);

    expect(task.status.state).toBe(A2aTaskStates.Completed);
    expect(task.metadata?.ranch?.chain).toEqual(['agent-b']);
  });
});

describe('A2aServerService.sendMessage — what it will not accept', () => {
  it('refuses a non-blocking request instead of promising a push it cannot make', async () => {
    const { service } = makeHarness();

    await expect(
      service.sendMessage(
        'agent-b',
        'agent-a',
        params(
          {},
          {
            returnImmediately: true,
          },
        ),
      ),
    ).rejects.toMatchObject({ code: A2aErrorCodes.UnsupportedOperation });
  });

  it('refuses parts it cannot read', async () => {
    const { service } = makeHarness();

    await expect(
      service.sendMessage(
        'agent-b',
        'agent-a',
        params({ parts: [{ raw: 'ZmlsZQ==' }] }),
      ),
    ).rejects.toMatchObject({
      code: A2aErrorCodes.ContentTypeNotSupported,
    });
  });

  it('refuses a request with no message at all', async () => {
    const { service } = makeHarness();

    await expect(
      service.sendMessage('agent-b', 'agent-a', {} as IA2aSendMessageParams),
    ).rejects.toMatchObject({ code: A2aErrorCodes.InvalidParams });
  });
});

describe('A2aServerService.getTask', () => {
  it('hands back a task it answered', async () => {
    const { service } = makeHarness();
    const task = await service.sendMessage('agent-b', 'agent-a', params());

    expect(service.getTask({ id: task.id })).toMatchObject({ id: task.id });
    expect(service.knowsTask(task.id)).toBe(true);
  });

  it('says a task it never answered is not found', () => {
    const { service } = makeHarness();

    expect(() => service.getTask({ id: 'nope' })).toThrow(A2aRpcError);
    try {
      service.getTask({ id: 'nope' });
    } catch (err) {
      expect((err as A2aRpcError).code).toBe(A2aErrorCodes.TaskNotFound);
    }
    expect(service.knowsTask('nope')).toBe(false);
  });

  it('remembers failed tasks too, not only the ones that worked', async () => {
    const { service } = makeHarness({ connected: false });
    const task = await service.sendMessage('agent-b', 'agent-a', params());

    expect(service.getTask({ id: task.id }).status.state).toBe(
      A2aTaskStates.Failed,
    );
  });
});
