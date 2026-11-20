import { AskAgentTool } from './askAgent.tool';
import {
  DelegationErrorCodes,
  DelegationStatuses,
  PeerOrigins,
  hashPeerIds,
} from './domain/peer.types';
import type { IAgentPeerData, IA2aAgentCard } from './domain';
import type { IPeerGateway } from './domain/peer.gateway';
import type { DelegationService } from './domain/delegation.service';
import type { A2aServerService } from './domain/a2a.server.service';
import type { Request } from 'express';
import { UserRoleTypes } from '#/user/user/domain';
import { asGuest, asPeer, asPerson, asTrustedAgent } from '#/mcp/testing';
import {
  peerAccessOver,
  type IPeerWorld,
} from './domain/__fixtures__/peerAccess';

/**
 * What the model sees and what it is told. These cases are mostly about
 * wording, and that is the point: the tool's only defence against an agent
 * inventing an answer on a peer's behalf is the sentence it gets back when a
 * delegation fails.
 */
const card = (name: string): IA2aAgentCard => ({
  name,
  description: `${name} answers order questions.`,
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
  skills: [
    {
      id: 'knowledge:9a',
      name: 'Returns policy',
      description: 'Answers questions about returns',
      tags: ['knowledge'],
    },
  ],
});

const connection = (name = 'Support Bot', id = 'peer-1'): IAgentPeerData => ({
  id,
  agentId: 'a',
  peerAgentId: `agent-${name}`,
  origin: PeerOrigins.Internal,
  token: 'ap_' + 'x'.repeat(43),
  outboundToken: null,
  cardSnapshot: card(name),
  cardUrl: 'https://api.test/card',
  cardReadAt: '2026-09-14T10:00:00.000Z',
  createdById: null,
  openToVisitors: false,
  openedById: null,
  openedAt: null,
  ownerUserId: null,
  needsReview: false,
  createdAt: '2026-09-14T10:00:00.000Z',
  updatedAt: '2026-09-14T10:00:00.000Z',
});

/** An imported foreign agent: no agent id here, named by its connection id. */
const externalConnection = (
  name = 'Foreign Bot',
  id = 'peer-ext-1',
): IAgentPeerData => ({
  ...connection(name, id),
  peerAgentId: null,
  origin: PeerOrigins.External,
  token: null,
  outboundToken: 'ext-secret',
});

const bareRequest = (sub = 'agent:a') =>
  ({ user: { sub, email: '', roles: [] } }) as unknown as Request;

/**
 * The agent's runtime, in a turn that is the Owner's. The Owner reaches
 * every agent, so in the cases that are not about access the caller decides
 * nothing (CLEAN-236); the ones that are say who the turn is for.
 */
const agentRequest = (sub = 'agent:a') =>
  asPerson(bareRequest(sub), UserRoleTypes.Owner, 'user-owner');

function makeHarness(
  options: {
    connections?: IAgentPeerData[];
    outcome?: unknown;
    chain?: string[];
    world?: IPeerWorld;
  } = {},
) {
  const peerMocks = {
    listByAgent: jest.fn(async () => options.connections ?? [connection()]),
    recordPeersServed: jest.fn(async () => undefined),
  };

  const run = jest.fn(
    async () =>
      options.outcome ?? {
        kind: 'done',
        status: DelegationStatuses.Answered,
        peerName: 'Support Bot',
        contextId: 'ctx-1',
        durationMs: 3120,
        text: 'Shoes can be returned within 30 days.',
      },
  );

  const a2aServer = {
    currentChain: jest.fn(() => options.chain ?? []),
    timeoutMs: 120_000,
  } as unknown as A2aServerService;

  const agents = {
    findById: (id: string) =>
      Promise.resolve({ id, name: id, isAdmin: false, createdById: null }),
  };
  const { access } = peerAccessOver(agents, options.world);

  const tool = new AskAgentTool(
    peerMocks as unknown as IPeerGateway,
    { run } as unknown as DelegationService,
    a2aServer,
    access,
  );

  const args = {
    peer: 'Support Bot',
    task: 'What is the return window for shoes?',
    reason: 'Support Bot holds the returns policy base',
  };

  return { tool, peers: peerMocks, run, args };
}

const textOf = (result: { content: { text: string }[] }) =>
  result.content.map((c) => c.text).join('\n');

describe('AskAgentTool — being offered at all', () => {
  it('is not listed for an agent with no peers', async () => {
    const { tool } = makeHarness({ connections: [] });

    await expect(tool.isListedForRequest(agentRequest())).resolves.toBe(false);
  });

  it('is listed for an agent that has one', async () => {
    const { tool } = makeHarness();

    await expect(tool.isListedForRequest(agentRequest())).resolves.toBe(true);
  });

  it('is not listed for a caller that is not an agent at all', async () => {
    const { tool, peers } = makeHarness();

    await expect(tool.isListedForRequest(agentRequest('user-1'))).resolves.toBe(
      false,
    );
    expect(peers.listByAgent).not.toHaveBeenCalled();
  });
});

describe('AskAgentTool — the description the model reads', () => {
  it('lists each peer with its name, id and what its card claims', async () => {
    const { tool } = makeHarness();

    const description = await tool.describeForRequest(agentRequest());

    expect(description).toContain('"Support Bot"');
    expect(description).toContain('peer: agent-Support Bot');
    expect(description).toContain('Support Bot answers order questions.');
    expect(description).toContain(
      'Returns policy (Answers questions about returns)',
    );
  });

  it('says when NOT to call it, not only when to', async () => {
    const { tool } = makeHarness();

    const description = (await tool.describeForRequest(agentRequest())) ?? '';

    expect(description).toMatch(
      /not call it for anything you can do yourself/i,
    );
  });

  it('carries the give-up rule, placed before the not-a-first-resort caveat', async () => {
    const { tool } = makeHarness();

    const description = (await tool.describeForRequest(agentRequest())) ?? '';

    // FR-011: the model must try a plausible peer before saying I don't know.
    const giveUp = description.search(
      /before you answer that you do not know/i,
    );
    const caveat = description.search(/not a first resort/i);
    expect(giveUp).toBeGreaterThanOrEqual(0);
    expect(caveat).toBeGreaterThan(giveUp);
    expect(description).toMatch(/without having asked a matching peer/i);
  });

  it('tells the model to always ask a peer the user named', async () => {
    const { tool } = makeHarness();

    const description = (await tool.describeForRequest(agentRequest())) ?? '';

    expect(description).toMatch(/names a peer.*always ask that peer/is);
  });

  it('lists an external peer exactly like an internal one, by connection id', async () => {
    const { tool } = makeHarness({
      connections: [externalConnection('Foreign Bot', 'peer-ext-1')],
    });

    const description = (await tool.describeForRequest(agentRequest())) ?? '';

    expect(description).toContain('"Foreign Bot"');
    expect(description).toContain('peer: peer-ext-1');
    expect(description).toContain('Foreign Bot answers order questions.');
  });

  it('warns that the peer cannot see the conversation', async () => {
    const { tool } = makeHarness();

    const description = (await tool.describeForRequest(agentRequest())) ?? '';

    expect(description).toMatch(/does not see this conversation/i);
  });

  it('falls back to the static text for an agent with no peers', async () => {
    const { tool } = makeHarness({ connections: [] });

    await expect(tool.describeForRequest(agentRequest())).resolves.toBeNull();
  });

  it('lists several peers, each on its own line', async () => {
    const { tool } = makeHarness({
      connections: [
        connection('Support Bot'),
        connection('Billing Bot', 'peer-2'),
      ],
    });

    const description = (await tool.describeForRequest(agentRequest())) ?? '';

    expect(description).toContain('"Support Bot"');
    expect(description).toContain('"Billing Bot"');
  });
});

describe('AskAgentTool — recording what the pod was served (CLEAN-95)', () => {
  it('records the membership hash when the description is served', async () => {
    const { tool, peers } = makeHarness({
      connections: [connection('A', 'p1'), connection('B', 'p2')],
    });

    await tool.describeForRequest(agentRequest());

    expect(peers.recordPeersServed).toHaveBeenCalledWith(
      'a',
      hashPeerIds(['p1', 'p2']),
    );
  });

  it('records on the listing check too, even with zero peers', async () => {
    const { tool, peers } = makeHarness({ connections: [] });

    await tool.isListedForRequest(agentRequest());

    expect(peers.recordPeersServed).toHaveBeenCalledWith('a', hashPeerIds([]));
  });

  it('hash covers membership only: same set, same hash, any order', () => {
    expect(hashPeerIds(['p2', 'p1'])).toBe(hashPeerIds(['p1', 'p2']));
    expect(hashPeerIds(['p1'])).not.toBe(hashPeerIds(['p1', 'p2']));
  });

  it('a failed write never breaks the tool list', async () => {
    const { tool, peers } = makeHarness();
    peers.recordPeersServed.mockRejectedValueOnce(new Error('db down'));

    await expect(tool.isListedForRequest(agentRequest())).resolves.toBe(true);
  });
});

describe('AskAgentTool — calling it', () => {
  it('refuses a caller that is not an agent runtime', async () => {
    const { tool, args } = makeHarness();

    const result = await tool.ask(args, null, agentRequest('user-1'));

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('agent runtime');
  });

  it('refuses arguments it cannot act on, naming what is wrong', async () => {
    const { tool, run } = makeHarness();

    const result = await tool.ask(
      { peer: 'Support Bot', task: 'do it' },
      null,
      agentRequest(),
    );

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('reason');
    expect(run).not.toHaveBeenCalled();
  });

  it('returns the reply with the peer, the wait and a context to continue from', async () => {
    const { tool, args } = makeHarness();

    const result = await tool.ask(args, null, agentRequest());

    expect(result.isError).toBeUndefined();
    const text = textOf(result);
    expect(text).toContain('Support Bot');
    expect(text).toContain('ctx-1');
    expect(text).toContain('3.1s');
    expect(text).toContain('Shoes can be returned within 30 days.');
  });

  it('says outright that a peer answered with nothing, so the model does not fill the gap (CLEAN-97)', async () => {
    const { tool, args } = makeHarness({
      outcome: {
        kind: 'done',
        status: DelegationStatuses.Answered,
        peerName: 'Support Bot',
        contextId: 'ctx-1',
        durationMs: 800,
        text: '',
      },
    });

    const result = await tool.ask(args, null, agentRequest());

    expect(result.isError).toBeUndefined();
    const text = textOf(result);
    expect(text).toContain('«Support Bot» answered');
    expect(text).toContain('the reply was empty');
    expect(text).toMatch(/do not invent/i);
    expect(text).not.toContain('Reply from');
  });

  it('tells the model not to answer for a peer it could not reach', async () => {
    const { tool, args } = makeHarness({
      outcome: {
        kind: 'done',
        status: DelegationStatuses.Failed,
        peerName: 'Support Bot',
        contextId: 'ctx-1',
        durationMs: 120,
        errorCode: DelegationErrorCodes.NotRunning,
      },
    });

    const result = await tool.ask(args, null, agentRequest());

    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toContain('Could not reach «Support Bot»');
    expect(text).toContain('it is not running');
    expect(text).toMatch(/do not answer on its behalf/i);
  });

  it('says the same about a timeout', async () => {
    const { tool, args } = makeHarness({
      outcome: {
        kind: 'done',
        status: DelegationStatuses.Failed,
        peerName: 'Support Bot',
        contextId: 'ctx-1',
        durationMs: 120_000,
        errorCode: DelegationErrorCodes.Timeout,
      },
    });

    const result = await tool.ask(args, null, agentRequest());

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('did not answer in time');
  });

  it('reports a refusal as a refusal, with the peer own words', async () => {
    const { tool, args } = makeHarness({
      outcome: {
        kind: 'done',
        status: DelegationStatuses.Rejected,
        peerName: 'Support Bot',
        contextId: 'ctx-1',
        durationMs: 40,
        errorCode: DelegationErrorCodes.RejectedLoop,
        cause: 'would loop: «Caller» is already in this chain',
      },
    });

    const result = await tool.ask(args, null, agentRequest());

    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toContain('refused the task');
    expect(text).toContain('would loop');
  });

  it('lists the peers it does have when the name matches none', async () => {
    const { tool, args } = makeHarness({
      outcome: { kind: 'no_match', peers: ['Support Bot', 'Billing Bot'] },
    });

    const result = await tool.ask(
      { ...args, peer: 'Nobody' },
      null,
      agentRequest(),
    );

    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toContain('No peer matches "Nobody"');
    expect(text).toContain('"Support Bot"');
    expect(text).toContain('"Billing Bot"');
  });

  it('carries the chain this agent is itself part of', async () => {
    const { tool, args, run } = makeHarness({ chain: ['origin', 'a'] });

    await tool.ask(args, null, agentRequest());

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        callerAgentId: 'a',
        inboundChain: ['origin', 'a'],
      }),
      120_000,
    );
  });

  it('passes a context id through so a follow-up continues the same exchange', async () => {
    const { tool, args, run } = makeHarness();

    await tool.ask({ ...args, context_id: 'ctx-42' }, null, agentRequest());

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ contextId: 'ctx-42' }),
      120_000,
    );
  });
});

/**
 * CLEAN-236. What the agent knows of its peers in a turn is what serves the
 * caller of that turn. `connection()` is a peer of this Ranch, agent `b`;
 * the Admin is denied it.
 */
describe('AskAgentTool — a roster per caller', () => {
  const world: IPeerWorld = {
    denied: { 'user-admin': ['agent-Support Bot'] },
  };
  const asAdmin = () =>
    asPerson(bareRequest(), UserRoleTypes.Admin, 'user-admin');
  const asUser = () => asPerson(bareRequest(), UserRoleTypes.User, 'user-user');
  const nobody: Array<[string, () => Request]> = [
    ['a visitor', () => asGuest(bareRequest())],
    ['a runtime that names nobody', () => bareRequest()],
    ['the agent on its own schedule', () => asTrustedAgent(bareRequest())],
    ['another agent’s question', () => asPeer(bareRequest())],
  ];
  const open = (name = 'Support Bot', id = 'peer-1'): IAgentPeerData => ({
    ...connection(name, id),
    openToVisitors: true,
  });

  it('lists a peer for a person who reaches it', async () => {
    const { tool } = makeHarness({ world });

    expect(await tool.isListedForRequest(asUser())).toBe(true);
    expect(await tool.describeForRequest(asUser())).toContain(
      '"Support Bot" (peer: agent-Support Bot)',
    );
  });

  it('has no tool at all for a person who reaches none of the peers', async () => {
    const { tool } = makeHarness({ world });

    expect(await tool.isListedForRequest(asAdmin())).toBe(false);
    expect(await tool.describeForRequest(asAdmin())).toBeNull();
  });

  it.each(nobody)('has no tool at all for %s', async (_who, request) => {
    const { tool } = makeHarness({ world });

    expect(await tool.isListedForRequest(request())).toBe(false);
    expect(await tool.describeForRequest(request())).toBeNull();
  });

  it('leaves out the peer a person does not reach and keeps the rest, with no gap', async () => {
    const other = connection('Billing Bot', 'peer-2');
    const { tool } = makeHarness({
      world,
      connections: [connection(), other],
    });

    const description = (await tool.describeForRequest(asAdmin())) ?? '';
    expect(description).toContain('"Billing Bot" (peer: agent-Billing Bot)');
    expect(description).not.toMatch(/Support Bot|peer-1/);
    expect(description.match(/^- /gm)).toHaveLength(1);
  });

  it.each([['a person who does not reach it', asAdmin] as const, ...nobody])(
    'open to visitors: lists it for %s as a colleague, by its skills and its connection id',
    async (_who, request) => {
      const { tool } = makeHarness({ world, connections: [open()] });

      expect(await tool.isListedForRequest(request())).toBe(true);
      const description = (await tool.describeForRequest(request())) ?? '';
      expect(description).toContain('- "Colleague 1" (peer: peer-1)');
      expect(description).toContain('Skills: Returns policy');
      // Not its name, not its agent id, and not its description: the
      // default description of a card is the agent's name.
      expect(description).not.toMatch(/Support Bot|agent-|answers order/);
    },
  );

  it('numbers the colleagues it cannot name, and names the ones it can beside them', async () => {
    const reached = connection('Billing Bot', 'peer-3');
    const { tool } = makeHarness({
      world: {
        denied: { 'user-admin': ['agent-Support Bot', 'agent-Legal Bot'] },
      },
      connections: [
        open('Support Bot', 'peer-1'),
        open('Legal Bot', 'peer-2'),
        reached,
      ],
    });

    const description = (await tool.describeForRequest(asAdmin())) ?? '';
    expect(description).toContain('"Colleague 1" (peer: peer-1)');
    expect(description).toContain('"Colleague 2" (peer: peer-2)');
    expect(description).toContain('"Billing Bot" (peer: agent-Billing Bot)');
    expect(description).not.toMatch(/Support Bot|Legal Bot/);
  });

  it('still records what the pod was served from the whole set, whoever asked', async () => {
    const { tool, peers } = makeHarness({ world });

    await tool.describeForRequest(asAdmin());

    expect(peers.recordPeersServed).toHaveBeenCalledWith(
      'a',
      hashPeerIds(['peer-1']),
    );
  });

  it('hands the delegation the caller of the turn', async () => {
    const { tool, args, run } = makeHarness({ world });

    await tool.ask(args, null, asAdmin());

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        party: {
          kind: 'person',
          userId: 'user-admin',
          role: UserRoleTypes.Admin,
        },
      }),
      120_000,
    );
  });

  it('answers for a masked peer as "a colleague", in every outcome', async () => {
    const masked = (over: Record<string, unknown>) => ({
      kind: 'done',
      peerName: 'a colleague',
      masked: true,
      contextId: 'ctx-1',
      durationMs: 3120,
      ...over,
    });
    const say = async (over: Record<string, unknown>) => {
      const { tool, args } = makeHarness({ outcome: masked(over) });
      return textOf(await tool.ask(args, null, asGuest(bareRequest())));
    };

    expect(
      await say({ status: DelegationStatuses.Answered, text: '30 days.' }),
    ).toMatch(/^Reply from a colleague \(context_id: ctx-1, 3\.1s\):/);
    expect(
      await say({ status: DelegationStatuses.Answered, text: '' }),
    ).toMatch(/^A colleague answered .* but the reply was empty/);
    expect(
      await say({
        status: DelegationStatuses.Rejected,
        errorCode: DelegationErrorCodes.RejectedLoop,
      }),
    ).toMatch(/^A colleague refused the task:/);
    expect(
      await say({
        status: DelegationStatuses.Failed,
        errorCode: DelegationErrorCodes.Timeout,
      }),
    ).toMatch(/^Could not reach a colleague:/);
  });

  it('names in a refusal only the peers the delegation said it has for this caller', async () => {
    const { tool, args } = makeHarness({
      outcome: { kind: 'no_match', peers: ['Colleague 1'] },
    });

    const text = textOf(
      await tool.ask({ ...args, peer: 'b' }, null, asGuest(bareRequest())),
    );

    expect(text).toBe('No peer matches "b". Your peers are: "Colleague 1".');
  });
});
