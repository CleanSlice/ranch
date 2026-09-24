import { DelegationService } from './delegation.service';
import {
  A2aTaskStates,
  type A2aSendMessageResult,
  type IA2aAgentCard,
  type IA2aTask,
} from './a2a.types';
import { A2aDialects } from './a2a.legacy';
import {
  DelegationError,
  DelegationErrorCodes,
  PeerOrigins,
  type IAgentPeerData,
} from './peer.types';
import type { IPeerGateway } from './peer.gateway';
import type { IDelegationGateway } from './delegation.gateway';
import type { A2aClient } from './a2a.client';
import type { IBridleGateway } from '#/bridle/domain/bridle.gateway';

/**
 * One delegation end to end. The invariants worth defending are about order
 * and honesty: the audit row exists before the outbound call (a crash must
 * leave a trace), the step is pushed before the wait (the chat must never look
 * idle), the row is finished exactly once, and a failure never comes back
 * looking like an answer.
 */
const card = (
  name: string,
  skills: IA2aAgentCard['skills'] = [],
): IA2aAgentCard => ({
  name,
  description: `${name} answers things`,
  version: '1',
  supportedInterfaces: [
    {
      url: `https://api.test/a2a/agents/${name}`,
      protocolBinding: 'JSONRPC',
      protocolVersion: '1.0',
    },
  ],
  capabilities: {},
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['text/plain'],
  skills,
});

const connection = (
  overrides: Partial<IAgentPeerData> = {},
): IAgentPeerData => ({
  id: 'peer-1',
  agentId: 'a',
  peerAgentId: 'b',
  origin: PeerOrigins.Internal,
  token: 'ap_' + 'x'.repeat(43),
  outboundToken: null,
  cardSnapshot: card('Support Bot', [
    {
      id: 'knowledge:9a',
      name: 'Returns policy',
      description: 'Answers questions about returns and refunds',
      tags: ['knowledge'],
    },
    {
      id: 'skill:1',
      name: 'Order lookup',
      description: 'Finds an order by number',
      tags: ['skill'],
    },
  ]),
  cardUrl: 'https://api.test/a2a/agents/b/.well-known/agent-card.json',
  cardReadAt: '2026-09-14T10:00:00.000Z',
  createdAt: '2026-09-14T10:00:00.000Z',
  updatedAt: '2026-09-14T10:00:00.000Z',
  ...overrides,
});

const completed = (text = 'Within 30 days.'): IA2aTask => ({
  id: 't1',
  contextId: 'ctx-1',
  status: { state: A2aTaskStates.Completed, timestamp: '2026-09-14T10:00:03Z' },
  artifacts: [{ artifactId: 'reply', parts: [{ text }] }],
  history: [],
  metadata: { ranch: { chain: ['a', 'b'] } },
});

const failedTask = (
  failure: 'not_running' | 'timeout',
  text: string,
): IA2aTask => ({
  id: 't2',
  contextId: 'ctx-1',
  status: {
    state: A2aTaskStates.Failed,
    timestamp: '2026-09-14T10:00:00Z',
    message: { messageId: 'm', role: 'ROLE_AGENT', parts: [{ text }] },
  },
  artifacts: [],
  history: [],
  metadata: { ranch: { chain: ['a', 'b'], failure } },
});

const rejectedTask = (rejection: 'loop' | 'depth', text: string): IA2aTask => ({
  id: 't3',
  contextId: 'ctx-1',
  status: {
    state: A2aTaskStates.Rejected,
    timestamp: '2026-09-14T10:00:00Z',
    message: { messageId: 'm', role: 'ROLE_AGENT', parts: [{ text }] },
  },
  artifacts: [],
  history: [],
  metadata: { ranch: { chain: ['a', 'b'], rejection } },
});

function makeHarness(
  options: {
    connections?: IAgentPeerData[];
    task?: IA2aTask;
    /** The whole client result, for message replies (CLEAN-97). */
    reply?: A2aSendMessageResult;
    sendThrows?: Error;
    activeTurn?: { clientId: string; turnId: string; ts: number } | null;
  } = {},
) {
  const order: string[] = [];
  const rows: Record<string, any> = {};
  let seq = 0;

  const peers = {
    listByAgent: jest.fn(async () => options.connections ?? [connection()]),
  } as unknown as IPeerGateway;

  const delegationMocks = {
    create: jest.fn(async (input: Record<string, any>) => {
      order.push('create');
      const id = `del-${(seq += 1)}`;
      rows[id] = {
        id,
        status: 'waiting',
        errorCode: null,
        excerpt: null,
        startedAt: '2026-09-14T10:00:00.000Z',
        finishedAt: null,
        durationMs: null,
        ...input,
      };
      return rows[id];
    }),
    finish: jest.fn(async (id: string, input: Record<string, any>) => {
      order.push('finish');
      Object.assign(rows[id], input, {
        finishedAt: input.finishedAt.toISOString(),
      });
      return rows[id];
    }),
    listRecent: jest.fn(async () => []),
  };

  const sendMessage = jest.fn(async (..._args: unknown[]) => {
    order.push('send');
    if (options.sendThrows) throw options.sendThrows;
    return options.reply ?? { task: options.task ?? completed() };
  });
  const client = { sendMessage } as unknown as A2aClient;

  const sent: Array<{ clientId: string; agentId: string; data: any }> = [];
  const hub = {
    findActiveTurn: jest.fn(() =>
      options.activeTurn === undefined
        ? { clientId: 'admin', turnId: 'turn-1', ts: 1 }
        : options.activeTurn,
    ),
    sendToClient: jest.fn(
      (clientId: string, agentId: string, data: unknown) => {
        order.push('push');
        sent.push({ clientId, agentId, data });
      },
    ),
  } as unknown as IBridleGateway;

  const service = new DelegationService(
    peers,
    delegationMocks as unknown as IDelegationGateway,
    client,
    hub,
  );

  const run = (overrides: Record<string, unknown> = {}) =>
    service.run(
      {
        callerAgentId: 'a',
        peer: 'peer-1',
        task: 'What is the return window for shoes?',
        reason: 'Support Bot holds the returns policy base',
        inboundChain: [],
        ...overrides,
      } as never,
      120_000,
    );

  return {
    service,
    run,
    delegations: delegationMocks,
    sendMessage,
    hub,
    sent,
    order,
    rows,
  };
}

describe('DelegationService.run — choosing the peer', () => {
  it('matches a peer by its connection id', async () => {
    const { run } = makeHarness();

    const outcome = await run({ peer: 'peer-1' });

    expect(outcome).toMatchObject({ kind: 'done', peerName: 'Support Bot' });
  });

  it('matches a peer by the agent id', async () => {
    const { run } = makeHarness();

    await expect(run({ peer: 'b' })).resolves.toMatchObject({ kind: 'done' });
  });

  it('matches a peer by the name on its card, whatever the case', async () => {
    const { run } = makeHarness();

    await expect(run({ peer: 'support bot' })).resolves.toMatchObject({
      kind: 'done',
    });
  });

  it('reports the peers it does have when the name matches none', async () => {
    const { run, sendMessage } = makeHarness();

    const outcome = await run({ peer: 'Nobody' });

    expect(outcome).toEqual({ kind: 'no_match', peers: ['Support Bot'] });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('quotes the card skills that matched the reason', async () => {
    const { run, rows } = makeHarness();

    await run({ reason: 'it holds the returns policy' });

    const [row] = Object.values(rows);
    expect(row.matchedSkills).toEqual([
      { id: 'knowledge:9a', name: 'Returns policy' },
    ]);
  });

  it('names the first skill when nothing in the reason overlaps', async () => {
    const { run, rows } = makeHarness();

    await run({ reason: 'xyz', task: 'zzz' });

    const [row] = Object.values(rows);
    expect(row.matchedSkills).toEqual([
      { id: 'knowledge:9a', name: 'Returns policy' },
    ]);
  });

  it('records no skills for a peer that advertises none', async () => {
    const { run, rows } = makeHarness({
      connections: [connection({ cardSnapshot: card('Bare') })],
    });

    await run({ peer: 'Bare' });

    const [row] = Object.values(rows);
    expect(row.matchedSkills).toEqual([]);
  });
});

describe('DelegationService.run — the audit row', () => {
  it('opens the row before it asks anything, and closes it after', async () => {
    const { run, order } = makeHarness();

    await run();

    expect(order.indexOf('create')).toBeLessThan(order.indexOf('send'));
    expect(order.indexOf('send')).toBeLessThan(order.indexOf('finish'));
  });

  it('records an answer with its duration and an excerpt', async () => {
    const { run, delegations } = makeHarness({
      task: completed('Shoes can be returned within 30 days.'),
    });

    await run();

    expect(delegations.finish).toHaveBeenCalledWith(
      'del-1',
      expect.objectContaining({
        status: 'answered',
        errorCode: null,
        excerpt: 'Shoes can be returned within 30 days.',
      }),
    );
  });

  it('truncates a long reply so the record stays readable', async () => {
    const { run, rows } = makeHarness({ task: completed('x'.repeat(1000)) });

    await run();

    const [row] = Object.values(rows);
    expect(row.excerpt).toHaveLength(300);
  });

  it('closes the row exactly once, even when the call throws', async () => {
    const { run, delegations } = makeHarness({
      sendThrows: new DelegationError(
        DelegationErrorCodes.Unreachable,
        'socket hang up',
      ),
    });

    await run();

    expect(delegations.finish).toHaveBeenCalledTimes(1);
  });
});

describe('DelegationService.run — outcomes', () => {
  it('hands back the reply text on success', async () => {
    const { run } = makeHarness({ task: completed('Within 30 days.') });

    await expect(run()).resolves.toMatchObject({
      status: 'answered',
      text: 'Within 30 days.',
    });
  });

  it('turns a peer that is not running into a stated failure', async () => {
    const { run } = makeHarness({
      task: failedTask('not_running', 'peer not running'),
    });

    await expect(run()).resolves.toMatchObject({
      status: 'failed',
      errorCode: DelegationErrorCodes.NotRunning,
    });
  });

  it('turns a timeout into a stated failure', async () => {
    const { run } = makeHarness({
      task: failedTask('timeout', 'timed out after 120s'),
    });

    await expect(run()).resolves.toMatchObject({
      status: 'failed',
      errorCode: DelegationErrorCodes.Timeout,
    });
  });

  it('separates a loop refusal from a depth refusal', async () => {
    const loop = await makeHarness({
      task: rejectedTask('loop', 'would loop'),
    }).run();
    const depth = await makeHarness({
      task: rejectedTask('depth', 'too deep'),
    }).run();

    expect(loop).toMatchObject({
      status: 'rejected',
      errorCode: DelegationErrorCodes.RejectedLoop,
    });
    expect(depth).toMatchObject({
      status: 'rejected',
      errorCode: DelegationErrorCodes.RejectedDepth,
    });
  });

  it('keeps a transport failure as the code the client gave it', async () => {
    const { run } = makeHarness({
      sendThrows: new DelegationError(
        DelegationErrorCodes.Unauthorized,
        'refused this credential',
      ),
    });

    await expect(run()).resolves.toMatchObject({
      status: 'failed',
      errorCode: DelegationErrorCodes.Unauthorized,
    });
  });

  it('never returns reply text for anything that was not an answer', async () => {
    const { run } = makeHarness({
      task: failedTask('not_running', 'peer not running'),
    });

    const outcome = await run();

    expect(outcome).not.toHaveProperty('text');
  });
});

describe('DelegationService.run — what goes over the wire', () => {
  it('asks at the address on the stored card, with the pair credential', async () => {
    const { run, sendMessage } = makeHarness();

    await run();

    const [url, token] = sendMessage.mock.calls[0] as [string, string];
    expect(url).toBe('https://api.test/a2a/agents/Support Bot');
    expect(token).toMatch(/^ap_/);
  });

  it('appends itself to the chain it was called with', async () => {
    const { run, sendMessage } = makeHarness();

    await run({ inboundChain: ['origin'] });

    const params = sendMessage.mock.calls[0][2] as any;
    expect(params.message.metadata.ranch.chain).toEqual(['origin', 'a']);
  });

  it('starts a chain when the caller is not itself a peer', async () => {
    const { run, sendMessage } = makeHarness();

    await run();

    const params = sendMessage.mock.calls[0][2] as any;
    expect(params.message.metadata.ranch.chain).toEqual(['a']);
  });

  it('continues an earlier exchange when given its context', async () => {
    const { run, sendMessage } = makeHarness();

    const outcome = await run({ context_id: 'ctx-42', contextId: 'ctx-42' });

    const params = sendMessage.mock.calls[0][2] as any;
    expect(params.message.contextId).toBe('ctx-42');
    expect(outcome).toMatchObject({ contextId: 'ctx-42' });
  });

  it('mints a context to continue from when none was given', async () => {
    const { run } = makeHarness();

    const outcome = await run();

    expect((outcome as { contextId: string }).contextId).toMatch(/^ctx-/);
  });
});

describe('DelegationService.run — the visible step', () => {
  it('pushes the step before the wait and again when it is over', async () => {
    const { run, order, sent } = makeHarness();

    await run();

    expect(order).toEqual(['create', 'push', 'send', 'finish', 'push']);
    expect(sent).toHaveLength(2);
    expect(sent[0].data.step.state).toBe('active');
    expect(sent[1].data.step.state).toBe('done');
  });

  it('uses one step id, so the second push replaces the first', async () => {
    const { run, sent } = makeHarness();

    await run();

    expect(sent[0].data.step.id).toBe(sent[1].data.step.id);
  });

  it('joins the turn the runtime already opened', async () => {
    const { run, sent } = makeHarness();

    await run();

    expect(sent[0]).toMatchObject({ clientId: 'admin', agentId: 'a' });
    expect(sent[0].data).toMatchObject({ turnId: 'turn-1', type: 'thinking' });
  });

  it('never closes the turn it borrowed', async () => {
    const { run, sent } = makeHarness();

    await run();

    for (const push of sent) expect(push.data.done).toBeUndefined();
  });

  it('remembers which turn it spoke into', async () => {
    const { run, rows } = makeHarness();

    await run();

    const [row] = Object.values(rows);
    expect(row).toMatchObject({ turnId: 'turn-1', clientId: 'admin' });
  });

  it('runs the delegation anyway when nobody is watching', async () => {
    const { run, sent, delegations } = makeHarness({ activeTurn: null });

    const outcome = await run();

    expect(sent).toHaveLength(0);
    expect(outcome).toMatchObject({ status: 'answered' });
    expect(delegations.finish).toHaveBeenCalledTimes(1);
  });

  it('shows the failure in the step, not only in the tool result', async () => {
    const { run, sent } = makeHarness({
      task: failedTask('not_running', 'peer not running'),
    });

    await run();

    expect(sent[1].data.step.label).toBe('Could not reach «Support Bot»');
    expect(sent[1].data.step.delegation.status).toBe('failed');
  });
});

describe('DelegationService.run — external peers (CLEAN-95)', () => {
  const externalConnection = (): IAgentPeerData =>
    connection({
      id: 'peer-ext',
      peerAgentId: null,
      origin: PeerOrigins.External,
      token: null,
      outboundToken: 'ext-secret-1',
      cardSnapshot: {
        ...connection().cardSnapshot,
        name: 'Foreign Bot',
        supportedInterfaces: [
          {
            url: 'https://other.example/a2a/agents/agent-x',
            protocolBinding: 'JSONRPC',
            protocolVersion: '1.0',
          },
        ],
      },
      cardUrl:
        'https://other.example/a2a/agents/agent-x/.well-known/agent-card.json',
    });

  it('authenticates with the outbound credential, never a pair token', async () => {
    const { run, sendMessage } = makeHarness({
      connections: [externalConnection()],
    });

    await run({ peer: 'Foreign Bot' });

    expect(sendMessage).toHaveBeenCalledWith(
      'https://other.example/a2a/agents/agent-x',
      'ext-secret-1',
      expect.anything(),
      120_000,
      A2aDialects.V1,
    );
  });

  it('records the audit row with a null peer agent id', async () => {
    const { run, delegations } = makeHarness({
      connections: [externalConnection()],
    });

    await run({ peer: 'Foreign Bot' });

    expect(delegations.create).toHaveBeenCalledWith(
      expect.objectContaining({ peerId: 'peer-ext', peerAgentId: null }),
    );
  });

  it('refuses a private interface URL before any request goes out (SSRF)', async () => {
    const sneaky = externalConnection();
    sneaky.cardSnapshot.supportedInterfaces[0].url =
      'http://169.254.169.254/latest/meta-data';
    const { run, sendMessage } = makeHarness({ connections: [sneaky] });

    const outcome = await run({ peer: 'Foreign Bot' });

    expect(sendMessage).not.toHaveBeenCalled();
    // A named cause, not "it answered with an error": nothing was sent, so
    // the peer answered nothing (CLEAN-97).
    expect(outcome).toMatchObject({
      kind: 'done',
      status: 'failed',
      errorCode: DelegationErrorCodes.AddressRefused,
    });
  });

  it('an internal peer keeps using its pair token', async () => {
    const { run, sendMessage } = makeHarness();

    await run();

    expect(sendMessage).toHaveBeenCalledWith(
      expect.any(String),
      'ap_' + 'x'.repeat(43),
      expect.anything(),
      120_000,
      A2aDialects.V1,
    );
  });
});

describe('DelegationService.run — reading what a real peer sends back (CLEAN-97)', () => {
  const task = (overrides: Partial<IA2aTask>): IA2aTask => ({
    id: 't',
    contextId: 'ctx-1',
    status: {
      state: A2aTaskStates.Completed,
      timestamp: '2026-09-17T10:00:00Z',
    },
    artifacts: [],
    history: [],
    ...overrides,
  });

  it('takes a plain message as the answer — most public agents reply that way', async () => {
    const { run, rows } = makeHarness({
      reply: {
        message: {
          messageId: 'm-reply',
          role: 'ROLE_AGENT',
          parts: [{ text: 'Crown Hill Senior Care Home, Seattle, WA' }],
        },
      },
    });

    const outcome = await run();

    expect(outcome).toMatchObject({
      status: 'answered',
      text: 'Crown Hill Senior Care Home, Seattle, WA',
    });
    const [row] = Object.values(rows);
    expect(row).toMatchObject({ status: 'answered', errorCode: null });
  });

  it('hands structured data over as JSON instead of dropping it', async () => {
    const { run } = makeHarness({
      task: task({
        artifacts: [
          { artifactId: 'a', parts: [{ data: { accepted: true, count: 3 } }] },
        ],
      }),
    });

    await expect(run()).resolves.toMatchObject({
      status: 'answered',
      text: '{"accepted":true,"count":3}',
    });
  });

  it('keeps links as links and names binary parts without inlining them', async () => {
    const { run } = makeHarness({
      task: task({
        artifacts: [
          {
            artifactId: 'a',
            parts: [
              { url: 'https://example.test/page', filename: 'page.html' },
              {
                raw: 'aGVsbG8=',
                filename: 'report.pdf',
                mediaType: 'application/pdf',
              },
            ],
          },
        ],
      }),
    });

    const outcome = (await run()) as { text: string };

    expect(outcome.text).toContain('page.html: https://example.test/page');
    expect(outcome.text).toContain(
      '[binary attachment not included: report.pdf]',
    );
    expect(outcome.text).not.toContain('aGVsbG8=');
  });

  it('joins every artifact, not only the first', async () => {
    const { run } = makeHarness({
      task: task({
        artifacts: [
          { artifactId: 'a', parts: [{ text: 'first' }] },
          { artifactId: 'b', parts: [{ text: 'second' }] },
        ],
      }),
    });

    await expect(run()).resolves.toMatchObject({ text: 'first\n\nsecond' });
  });

  it('reads the status message when a finished task leaves its artifacts empty', async () => {
    const { run } = makeHarness({
      task: task({
        status: {
          state: A2aTaskStates.Completed,
          timestamp: '2026-09-17T10:00:00Z',
          message: {
            messageId: 's',
            role: 'ROLE_AGENT',
            parts: [{ text: 'No public places matched.' }],
          },
        },
      }),
    });

    await expect(run()).resolves.toMatchObject({
      status: 'answered',
      text: 'No public places matched.',
    });
  });

  it('prefers the artifacts over a status message that only says it is done', async () => {
    const { run } = makeHarness({
      task: task({
        artifacts: [{ artifactId: 'a', parts: [{ text: 'the answer' }] }],
        status: {
          state: A2aTaskStates.Completed,
          timestamp: '2026-09-17T10:00:00Z',
          message: {
            messageId: 's',
            role: 'ROLE_AGENT',
            parts: [{ text: 'Request is completed!' }],
          },
        },
      }),
    });

    await expect(run()).resolves.toMatchObject({ text: 'the answer' });
  });

  it('records a truly empty reply as answered, and says so', async () => {
    const { run, rows, sent } = makeHarness({
      task: task({ artifacts: [{ artifactId: 'a', parts: [{ data: {} }] }] }),
    });

    const outcome = await run();

    expect(outcome).toMatchObject({ status: 'answered', text: '' });
    const [row] = Object.values(rows);
    expect(row.excerpt).toBe(
      'The peer answered, but its reply had no text, data or links.',
    );
    expect(sent[1].data.step.label).toBe('Answered by «Support Bot»');
  });

  it('treats a message with nothing readable the same way', async () => {
    const { run, rows } = makeHarness({
      reply: { message: { messageId: 'm', role: 'ROLE_AGENT', parts: [] } },
    });

    await expect(run()).resolves.toMatchObject({
      status: 'answered',
      text: '',
    });
    const [row] = Object.values(rows);
    expect(row.excerpt).toMatch(/no text, data or links/);
  });

  it('quotes a failure reason given as data, not just as text', async () => {
    const { run, rows } = makeHarness({
      task: task({
        status: {
          state: A2aTaskStates.Failed,
          timestamp: '2026-09-17T10:00:00Z',
          message: {
            messageId: 's',
            role: 'ROLE_AGENT',
            parts: [{ data: { error: 'quota exceeded' } }],
          },
        },
      }),
    });

    await run();

    const [row] = Object.values(rows);
    expect(row.excerpt).toBe('{"error":"quota exceeded"}');
  });
});

describe('DelegationService.run — which interface gets called (CLEAN-97)', () => {
  const withInterfaces = (
    supportedInterfaces: IA2aAgentCard['supportedInterfaces'],
  ): IAgentPeerData =>
    connection({
      id: 'peer-ext',
      peerAgentId: null,
      origin: PeerOrigins.External,
      token: null,
      outboundToken: null,
      cardSnapshot: {
        ...connection().cardSnapshot,
        name: 'Foreign Bot',
        supportedInterfaces,
      },
      cardUrl: 'https://other.example/.well-known/agent-card.json',
    });

  it('calls the JSON-RPC interface even when the card prefers another binding', async () => {
    const { run, sendMessage } = makeHarness({
      connections: [
        withInterfaces([
          {
            url: 'https://other.example/rest',
            protocolBinding: 'HTTP+JSON',
            protocolVersion: '1.0',
          },
          {
            url: 'https://other.example/jsonrpc',
            protocolBinding: 'JSONRPC',
            protocolVersion: '1.0',
          },
        ]),
      ],
    });

    await run({ peer: 'Foreign Bot' });

    expect(sendMessage).toHaveBeenCalledWith(
      'https://other.example/jsonrpc',
      undefined,
      expect.anything(),
      120_000,
      A2aDialects.V1,
    );
  });

  it('speaks the old dialect to a JSON-RPC interface that is not 1.0', async () => {
    const { run, sendMessage } = makeHarness({
      connections: [
        withInterfaces([
          {
            url: 'https://other.example/rest',
            protocolBinding: 'HTTP+JSON',
            protocolVersion: '1.0',
          },
          {
            url: 'https://other.example/old',
            protocolBinding: 'JSONRPC',
            protocolVersion: '0.3',
          },
        ]),
      ],
    });

    await run({ peer: 'Foreign Bot' });

    expect(sendMessage).toHaveBeenCalledWith(
      'https://other.example/old',
      undefined,
      expect.anything(),
      120_000,
      A2aDialects.Legacy,
    );
  });

  it('prefers 1.0 when the card offers both dialects', async () => {
    const { run, sendMessage } = makeHarness({
      connections: [
        withInterfaces([
          {
            url: 'https://other.example/old',
            protocolBinding: 'JSONRPC',
            protocolVersion: '0.3',
          },
          {
            url: 'https://other.example/jsonrpc',
            protocolBinding: 'JSONRPC',
            protocolVersion: '1.0',
          },
        ]),
      ],
    });

    await run({ peer: 'Foreign Bot' });

    expect(sendMessage).toHaveBeenCalledWith(
      'https://other.example/jsonrpc',
      undefined,
      expect.anything(),
      120_000,
      A2aDialects.V1,
    );
  });

  it('refuses without sending when no interface speaks JSON-RPC at all', async () => {
    const { run, sendMessage } = makeHarness({
      connections: [
        withInterfaces([
          {
            url: 'https://other.example/rest',
            protocolBinding: 'HTTP+JSON',
            protocolVersion: '1.0',
          },
          {
            url: 'https://other.example/grpc',
            protocolBinding: 'GRPC',
            protocolVersion: '0.3',
          },
        ]),
      ],
    });

    const outcome = await run({ peer: 'Foreign Bot' });

    expect(sendMessage).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({
      status: 'failed',
      errorCode: DelegationErrorCodes.Unsupported,
    });
  });
});
