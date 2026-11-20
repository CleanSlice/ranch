import type { ConfigService } from '@nestjs/config';
import { A2aServerService } from './a2a.server.service';
import { A2aTaskStore } from './a2aTask.store';
import { A2aErrorCodes, A2aRpcError, A2aTaskStates } from './a2a.types';
import type { IA2aSendMessageParams } from './a2a.types';
import type { IBridleGateway } from '#/bridle/domain/bridle.gateway';
import type { BridleSyncService } from '#/bridle/domain/bridleSync.service';
import type { IAgentGateway } from '#/agent/agent/domain';
import { JwtService } from '@nestjs/jwt';
import { HandoverService } from './handover';
import type { IInboundPeer } from './a2a.server.service';

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
    handover,
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

/**
 * The connection every request of this spec arrives through, as the peer
 * guard resolves it: `agent-a` asks `agent-b`.
 */
const PEER: IInboundPeer = { peerId: 'peer-1', callerAgentId: 'agent-a' };

// A real signer: the claim under test is that the chain and the connection
// are read from a token this API signed, never from the field beside it.
const handover = new HandoverService(new JwtService({ secret: 'a2a-test' }));

/**
 * The same request as `DelegationService` sends it (CLEAN-236): carrying the
 * hand-over token for this connection and this agent. The chain in the token
 * is the one the request names, or just the asker.
 */
async function signed(
  request: IA2aSendMessageParams,
  over: { agentId?: string; connectionId?: string; forUserId?: string } = {},
): Promise<IA2aSendMessageParams> {
  const ranch = (request.message.metadata?.ranch ?? {}) as {
    chain?: unknown;
  };
  const chain = Array.isArray(ranch.chain)
    ? (ranch.chain as string[])
    : ['agent-a'];
  const pass = await handover.mint(
    {
      agentId: over.agentId ?? 'agent-b',
      connectionId: over.connectionId ?? PEER.peerId,
      chain,
      ...(over.forUserId ? { forUserId: over.forUserId } : {}),
      contextId: request.message.contextId ?? 'ctx-test',
    },
    180,
  );
  return {
    ...request,
    message: {
      ...request.message,
      metadata: {
        ...request.message.metadata,
        ranch: { ...ranch, chain, pass },
      },
    },
  };
}

describe('A2aServerService.sendMessage — the happy path', () => {
  it('answers a completed task carrying the reply as one artifact', async () => {
    const { service } = makeHarness({ reply: { text: 'Within 30 days.' } });

    const task = await service.sendMessage(
      'agent-b',
      PEER,
      await signed(params()),
    );

    expect(task.status.state).toBe(A2aTaskStates.Completed);
    expect(task.artifacts).toHaveLength(1);
    expect(task.artifacts[0]).toMatchObject({
      artifactId: 'reply',
      parts: [{ text: 'Within 30 days.' }],
    });
  });

  it('talks to the runtime as one conversation per connection and context', async () => {
    const { service, sendAndAwait } = makeHarness();

    await service.sendMessage(
      'agent-b',
      PEER,
      await signed(params({ contextId: 'ctx-42' })),
    );

    expect(sendAndAwait).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent-b',
        clientId: 'peer:peer-1:ctx-42',
        text: 'What is the return window for shoes?',
      }),
    );
  });

  it('declares no capabilities, so the peer streams no timeline into a void', async () => {
    const { service, sendAndAwait } = makeHarness();

    await service.sendMessage('agent-b', PEER, await signed(params()));

    expect(sendAndAwait).toHaveBeenCalledWith(
      expect.objectContaining({ capabilities: [] }),
    );
  });

  it('mints a context when the caller supplies none, and keeps a given one', async () => {
    const { service } = makeHarness();

    const minted = await service.sendMessage(
      'agent-b',
      PEER,
      await signed(params()),
    );
    const given = await service.sendMessage(
      'agent-b',
      PEER,
      await signed(params({ contextId: 'ctx-42' })),
    );

    expect(minted.contextId).toMatch(/^ctx-/);
    expect(given.contextId).toBe('ctx-42');
  });

  it('appends itself to the chain it was called with', async () => {
    const { service } = makeHarness();

    const task = await service.sendMessage(
      'agent-b',
      PEER,
      await signed(withChain(['agent-a'])),
    );

    expect(task.metadata?.ranch?.chain).toEqual(['agent-a', 'agent-b']);
  });

  it('hands back no history: a peer transcript is its own business', async () => {
    const { service } = makeHarness();

    const task = await service.sendMessage(
      'agent-b',
      PEER,
      await signed(params()),
    );

    expect(task.history).toEqual([]);
  });

  it('publishes the chain while it serves, so a second hop can continue it', async () => {
    const seen: string[][] = [];
    const { service, sendAndAwait } = makeHarness();
    sendAndAwait.mockImplementation(async (_input) => {
      seen.push(service.currentChain('agent-b'));
      return { text: 'ok', messageId: 'm', ts: 1, timedOut: false };
    });

    await service.sendMessage(
      'agent-b',
      PEER,
      await signed(withChain(['agent-a'])),
    );

    expect(seen).toEqual([['agent-a', 'agent-b']]);
    // …and stops publishing it the moment the turn is over.
    expect(service.currentChain('agent-b')).toEqual([]);
  });
});

describe('A2aServerService.sendMessage — honest failures', () => {
  it('fails fast when the peer is not running, without waiting or sending', async () => {
    const { service, sendAndAwait } = makeHarness({ connected: false });

    const task = await service.sendMessage(
      'agent-b',
      PEER,
      await signed(params()),
    );

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

    const task = await service.sendMessage(
      'agent-b',
      PEER,
      await signed(params()),
    );

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
      PEER,
      await signed(withChain(['agent-b', 'agent-a'])),
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
      PEER,
      await signed(withChain(['a1', 'a2', 'a3'])),
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
      PEER,
      await signed(withChain(['a1', 'a2'])),
    );

    expect(task.status.state).toBe(A2aTaskStates.Completed);
  });

  it('honours a configured chain limit', async () => {
    const { service } = makeHarness({ env: { A2A_MAX_CHAIN: '1' } });

    const task = await service.sendMessage(
      'agent-b',
      PEER,
      await signed(withChain(['agent-a'])),
    );

    expect(task.metadata?.ranch?.rejection).toBe('depth');
  });

  it('reads the chain from the token, not from the field a caller can write beside it', async () => {
    const { service } = makeHarness();
    const request = await signed(withChain(['agent-a']));
    // The token says [agent-a]. The field says the chain is empty, which
    // would hide a loop, and then something that is no chain at all.
    for (const claimed of [[], 'not-an-array', ['agent-z']]) {
      const ranch = request.message.metadata?.ranch as Record<string, unknown>;
      const task = await service.sendMessage('agent-b', PEER, {
        ...request,
        message: {
          ...request.message,
          metadata: { ranch: { ...ranch, chain: claimed } },
        },
      });

      expect(task.metadata?.ranch?.chain).toEqual(['agent-a', 'agent-b']);
    }
  });
});

describe('A2aServerService.sendMessage — what it will not accept', () => {
  it('refuses a non-blocking request instead of promising a push it cannot make', async () => {
    const { service } = makeHarness();

    await expect(
      service.sendMessage(
        'agent-b',
        PEER,
        await signed(
          params(
            {},
            {
              returnImmediately: true,
            },
          ),
        ),
      ),
    ).rejects.toMatchObject({ code: A2aErrorCodes.UnsupportedOperation });
  });

  it('refuses parts it cannot read', async () => {
    const { service } = makeHarness();

    await expect(
      service.sendMessage(
        'agent-b',
        PEER,
        await signed(params({ parts: [{ raw: 'ZmlsZQ==' }] })),
      ),
    ).rejects.toMatchObject({
      code: A2aErrorCodes.ContentTypeNotSupported,
    });
  });

  it('refuses a request with no message at all', async () => {
    const { service } = makeHarness();

    await expect(
      service.sendMessage('agent-b', PEER, {} as IA2aSendMessageParams),
    ).rejects.toMatchObject({ code: A2aErrorCodes.InvalidParams });
  });
});

describe('A2aServerService.getTask', () => {
  it('hands back a task it answered', async () => {
    const { service } = makeHarness();
    const task = await service.sendMessage(
      'agent-b',
      PEER,
      await signed(params()),
    );

    expect(service.getTask({ id: task.id }, PEER)).toMatchObject({
      id: task.id,
    });
    expect(service.knowsTask(task.id, PEER)).toBe(true);
  });

  it('says a task it never answered is not found', () => {
    const { service } = makeHarness();

    expect(() => service.getTask({ id: 'nope' }, PEER)).toThrow(A2aRpcError);
    try {
      service.getTask({ id: 'nope' }, PEER);
    } catch (err) {
      expect((err as A2aRpcError).code).toBe(A2aErrorCodes.TaskNotFound);
    }
    expect(service.knowsTask('nope', PEER)).toBe(false);
  });

  it('remembers failed tasks too, not only the ones that worked', async () => {
    const { service } = makeHarness({ connected: false });
    const task = await service.sendMessage(
      'agent-b',
      PEER,
      await signed(params()),
    );

    expect(service.getTask({ id: task.id }, PEER).status.state).toBe(
      A2aTaskStates.Failed,
    );
  });
});

/**
 * CLEAN-236. A question reaches an agent only with the hand-over token this
 * API minted for exactly this connection and this agent. The runtime is
 * handed the same token, which is what tells it a colleague is asking.
 */
describe('A2aServerService.sendMessage — the hand-over token', () => {
  const refused = { code: A2aErrorCodes.InvalidParams };

  it('refuses a question that carries none', async () => {
    const { service, sendAndAwait } = makeHarness();

    await expect(
      service.sendMessage('agent-b', PEER, params()),
    ).rejects.toMatchObject(refused);
    expect(sendAndAwait).not.toHaveBeenCalled();
  });

  it('refuses one minted for another agent, or for another connection', async () => {
    const { service, sendAndAwait } = makeHarness();

    for (const over of [{ agentId: 'agent-c' }, { connectionId: 'peer-9' }]) {
      await expect(
        service.sendMessage('agent-b', PEER, await signed(params(), over)),
      ).rejects.toMatchObject(refused);
    }
    expect(sendAndAwait).not.toHaveBeenCalled();
  });

  it('refuses one signed by somebody else', async () => {
    const { service } = makeHarness();
    const forged = await new HandoverService(
      new JwtService({ secret: 'not-ours' }),
    ).mint(
      {
        agentId: 'agent-b',
        connectionId: PEER.peerId,
        chain: ['agent-a'],
        contextId: 'ctx',
      },
      180,
    );

    await expect(
      service.sendMessage(
        'agent-b',
        PEER,
        params({ metadata: { ranch: { chain: ['agent-a'], pass: forged } } }),
      ),
    ).rejects.toMatchObject(refused);
  });

  it('hands the runtime the very token, and names the conversation by the connection', async () => {
    const { service, sendAndAwait } = makeHarness();
    const request = await signed(params({ contextId: 'ctx-42' }));

    await service.sendMessage('agent-b', PEER, request);

    const ranch = request.message.metadata?.ranch as { pass: string };
    expect(sendAndAwait).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'peer:peer-1:ctx-42',
        handover: { token: ranch.pass },
        source: 'peer',
      }),
    );
    // Nothing of the asking agent is in the name the receiving side stores.
    const [[input]] = sendAndAwait.mock.calls as unknown as [
      [{ clientId: string }],
    ];
    expect(input.clientId).not.toContain('agent-a');
  });

  it('two questions served at once keep their own chains, and each is refused on its own', async () => {
    const { service, sendAndAwait } = makeHarness({
      env: { A2A_MAX_CHAIN: '3' },
    });
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    sendAndAwait.mockImplementation(async () => {
      await held;
      return { text: 'ok', messageId: 'm', ts: 1, timedOut: false };
    });

    // One still has a hop left and is being served …
    const first = service.sendMessage(
      'agent-b',
      PEER,
      await signed(withChain(['agent-a'])),
    );
    // … while a second arrives that would loop, and a third that is too deep.
    const loop = await service.sendMessage(
      'agent-b',
      PEER,
      await signed(withChain(['agent-b', 'agent-a'])),
    );
    const deep = await service.sendMessage(
      'agent-b',
      PEER,
      await signed(withChain(['agent-x', 'agent-y', 'agent-a'])),
    );
    release();

    expect(loop.metadata?.ranch?.rejection).toBe('loop');
    expect(deep.metadata?.ranch?.rejection).toBe('depth');
    expect((await first).metadata?.ranch?.chain).toEqual([
      'agent-a',
      'agent-b',
    ]);
  });
});

/** CLEAN-236. A task is answerable to the connection it was made through. */
describe('A2aServerService.getTask — bound to the connection', () => {
  it('is not found for any other connection, as a task that never was', async () => {
    const { service } = makeHarness();
    const task = await service.sendMessage(
      'agent-b',
      PEER,
      await signed(params()),
    );
    const other: IInboundPeer = { peerId: 'peer-2', callerAgentId: 'agent-c' };

    expect(service.knowsTask(task.id, other)).toBe(false);
    expect(() => service.getTask({ id: task.id }, other)).toThrow(
      expect.objectContaining({ code: A2aErrorCodes.TaskNotFound }),
    );
    expect(service.getTask({ id: task.id }, PEER).id).toBe(task.id);
  });
});
