import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import { PeerAdminTool } from './peerAdmin.tool';
import { PeerErrorCodes, PeerOrigins } from './domain/peer.types';
import type { IAgentPeerView } from './domain/peer.types';
import type { IA2aAgentCard } from './domain';
import type { PeerService } from './domain/peer.service';
import { UserRoleTypes } from '#/user/user/domain';
import { asGuest, asPerson, asTrustedAgent } from '#/mcp/testing';
import { permissionOver } from '#/agent/agent/domain/__fixtures__/agentPermission';

/**
 * These tools hand an agent the power to decide which other agents exist for
 * it. Two things are therefore worth more than coverage of the happy path:
 * that a plain agent cannot see or call them at all, and that every refusal
 * comes back as a sentence naming the next move — a model that reads "not
 * found" and stops has failed the person as surely as a crash.
 */
const card = (name: string, skills: string[] = ['Returns policy']) =>
  ({
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
    skills: skills.map((s, i) => ({
      id: `skill:${i}`,
      name: s,
      description: `Answers about ${s}`,
      tags: ['skill'],
    })),
  }) as IA2aAgentCard;

const view = (overrides: Partial<IAgentPeerView> = {}): IAgentPeerView => ({
  id: 'peer-1',
  agentId: 'agent-a',
  peerAgentId: 'agent-b',
  origin: PeerOrigins.Internal,
  peerName: 'Support Bot',
  peerStatus: 'running',
  peerExists: true,
  card: card('Support Bot'),
  cardUrl: 'https://api.test/a2a/agents/agent-b',
  cardReadAt: '2026-09-17T10:00:00.000Z',
  createdAt: '2026-09-17T10:00:00.000Z',
  visibility: 'full',
  createdBy: { id: 'user-owner', name: 'Olga Owner' },
  openToVisitors: false,
  owner: null,
  needsReview: false,
  canRemove: true,
  canSetVisitors: true,
  ...overrides,
});

const request = (roles: UserRoleTypes[]): Request =>
  ({
    user: { sub: 'agent:agent-ops', email: '', roles },
  }) as unknown as Request;

/**
 * The Ranch admin agent in a turn that is the Owner's. A person is required
 * since CLEAN-236: `ranchForItself` is the same agent on its own schedule,
 * which used to be the caller of this whole spec and is refused now.
 */
const OWNER_PARTY = {
  kind: 'person',
  userId: 'user-owner',
  role: UserRoleTypes.Owner,
};
const operator = () =>
  asPerson(request([UserRoleTypes.Owner]), UserRoleTypes.Owner, 'user-owner');
const ranchForItself = () => asTrustedAgent(request([UserRoleTypes.Owner]));
const plainAgent = () => asTrustedAgent(request([UserRoleTypes.Agent]));

interface Harness {
  tool: PeerAdminTool;
  peers: jest.Mocked<
    Pick<
      PeerService,
      | 'list'
      | 'peersState'
      | 'candidates'
      | 'connect'
      | 'connectByUrl'
      | 'connectByCard'
      | 'previewByUrl'
      | 'previewAgent'
      | 'recentDelegations'
      | 'setVisitors'
      | 'refresh'
      | 'remove'
    >
  >;
  agents: { findById: jest.Mock };
}

/**
 * What an unknown agent and one out of the caller's reach both answer, to a
 * caller who has `list_agents` (an Owner, an Admin, the Ranch admin agent
 * for itself).
 */
const NOT_FOUND =
  'Agent not found Check the ids with list_agents and list_agent_peers.';

/** What a call nobody is signed in behind gets (CLEAN-236). */
const PERSON_NEEDED = 'This needs a signed-in person.';

/** The same, to a caller who does not: no tool they lack is named (CLEAN-232). */
const NOT_FOUND_BELOW =
  'Agent not found There is no such agent or connection among the ones this person manages.';

function harness(): Harness {
  const agents = {
    findById: jest.fn((id: string) =>
      Promise.resolve(
        id === 'agent-ranch'
          ? { id, name: 'Ranch', isAdmin: true, createdById: null }
          : { id, name: 'Sales Bot', isAdmin: false, createdById: null },
      ),
    ),
  };
  const peers = {
    list: jest.fn().mockResolvedValue([view()]),
    peersState: jest
      .fn()
      .mockResolvedValue({ armed: true, servedAt: '2026-09-17T10:05:00.000Z' }),
    candidates: jest.fn().mockResolvedValue([
      {
        id: 'agent-b',
        name: 'Support Bot',
        status: 'running',
        connected: false,
      },
    ]),
    connect: jest.fn().mockResolvedValue(view()),
    connectByUrl: jest.fn().mockResolvedValue(
      view({
        id: 'peer-2',
        peerAgentId: null,
        origin: PeerOrigins.External,
        peerName: 'Elderly Care Match',
        cardUrl: 'https://elderly.example/.well-known/agent-card.json',
        card: card('Elderly Care Match', ['Assisted living search']),
      }),
    ),
    connectByCard: jest.fn().mockResolvedValue(
      view({
        id: 'peer-3',
        peerAgentId: null,
        origin: PeerOrigins.External,
        peerName: 'Pasted Bot',
        cardUrl: 'https://pasted.example/a2a/.well-known/agent-card.json',
        card: card('Pasted Bot', ['Care search']),
      }),
    ),
    previewByUrl: jest.fn().mockResolvedValue(card('Elderly Care Match')),
    previewAgent: jest.fn().mockResolvedValue(card('Support Bot')),
    recentDelegations: jest.fn().mockResolvedValue([]),
    setVisitors: jest.fn().mockResolvedValue(view({ openToVisitors: true })),
    refresh: jest.fn().mockResolvedValue(view()),
    remove: jest.fn().mockResolvedValue(undefined),
  } as unknown as Harness['peers'];

  const tool = new PeerAdminTool(
    peers as unknown as PeerService,
    // Every agent exists and is an ordinary one, so the callers of this spec
    // (an Owner, an Admin) may manage it; who may not is covered at the end
    // of the file.
    permissionOver(agents),
  );
  return { tool, peers, agents };
}

const textOf = (result: { content: { text: string }[] }) =>
  result.content[0].text;

describe('PeerAdminTool — who may use it', () => {
  it('hides the tools from an agent that is not a Ranch operator', async () => {
    const { tool } = harness();
    await expect(tool.isListedForRequest(plainAgent())).resolves.toBe(false);
  });

  it('lists them for an operator agent', async () => {
    const { tool } = harness();
    await expect(tool.isListedForRequest(operator())).resolves.toBe(true);
  });

  // Since CLEAN-232 a person who may not manage the agent is answered like
  // one who named an agent that does not exist: no 403 that would confirm
  // the agent is there. And since CLEAN-236 a call nobody is signed in
  // behind is told just that, before any agent is looked up.
  it('refuses a call from a plain agent even by name', async () => {
    const { tool, peers, agents } = harness();
    const result = await tool.connectAgentPeer(
      { agentId: 'agent-a', peerAgentId: 'agent-b' },
      null,
      plainAgent(),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(PERSON_NEEDED);
    expect(peers.connect).not.toHaveBeenCalled();
    // Nobody is signed in behind it: the agent is not even looked up.
    expect(agents.findById).not.toHaveBeenCalled();
  });

  it('refuses a caller with no roles at all', async () => {
    const { tool, peers } = harness();
    const result = await tool.listAgentPeers(
      { agentId: 'agent-a' },
      null,
      {} as Request,
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(PERSON_NEEDED);
    expect(peers.list).not.toHaveBeenCalled();
  });

  it('an Admin manages an ordinary agent’s peers, not the Ranch admin agent’s', async () => {
    const { tool, peers } = harness();
    const admin = () =>
      asPerson(request([UserRoleTypes.Owner]), UserRoleTypes.Admin);

    const own = await tool.listAgentPeers(
      { agentId: 'agent-a' },
      null,
      admin(),
    );
    expect(own.isError).toBeUndefined();

    const ranch = await tool.connectAgentPeer(
      { agentId: 'agent-ranch', peerAgentId: 'agent-b' },
      null,
      admin(),
    );
    expect(ranch.isError).toBe(true);
    expect(textOf(ranch)).toBe(NOT_FOUND);
    expect(peers.connect).not.toHaveBeenCalled();

    // The Owner may.
    const asOwner = await tool.connectAgentPeer(
      { agentId: 'agent-ranch', peerAgentId: 'agent-b' },
      null,
      asPerson(request([UserRoleTypes.Owner]), UserRoleTypes.Owner),
    );
    expect(asOwner.isError).toBeUndefined();
    expect(peers.connect).toHaveBeenCalledWith('agent-ranch', 'agent-b', {
      kind: 'person',
      userId: 'user-1',
      role: 'Owner',
    });
  });

  it('answers an agent that does not exist in the very same words', async () => {
    const { tool, agents } = harness();
    agents.findById.mockResolvedValue(null);
    const result = await tool.listAgentPeers(
      { agentId: 'agent-nope' },
      null,
      operator(),
    );
    expect(textOf(result)).toBe(NOT_FOUND);
  });

  it('a User, and a guest, reach nothing through the Ranch admin agent', async () => {
    const { tool, peers } = harness();
    for (const [caller, answer] of [
      [
        asPerson(request([UserRoleTypes.Owner]), UserRoleTypes.User),
        NOT_FOUND_BELOW,
      ],
      [asGuest(request([UserRoleTypes.Owner])), PERSON_NEEDED],
    ] as const) {
      const result = await tool.removeAgentPeer(
        { agentId: 'agent-a', peerId: 'peer-1', confirm: true },
        null,
        caller,
      );
      // Neither has `list_agents`, so the refusal does not send them there.
      expect(textOf(result)).toBe(answer);
      expect(textOf(result)).not.toContain('list_');
    }
    expect(peers.remove).not.toHaveBeenCalled();
  });
});

describe('PeerAdminTool — reading', () => {
  it('reports a loaded peer set as live', async () => {
    const { tool } = harness();
    const text = textOf(
      await tool.listAgentPeers({ agentId: 'agent-a' }, null, operator()),
    );
    expect(text).toContain('"live": true');
    expect(text).toContain('Support Bot');
    expect(text).toContain('holds exactly this peer set');
  });

  it('says delegation is broken until restart when the pod has not loaded the set', async () => {
    const { tool, peers } = harness();
    peers.peersState.mockResolvedValue({ armed: false, servedAt: null });
    const text = textOf(
      await tool.listAgentPeers({ agentId: 'agent-a' }, null, operator()),
    );
    expect(text).toContain('"live": false');
    expect(text).toContain('restart_agent with id=agent-a');
  });

  it('previews a card of this Ranch through the service, which asks whether the person reaches that agent', async () => {
    const { tool, peers } = harness();
    const text = textOf(
      await tool.previewAgentCard(
        { agentId: 'agent-a', peerAgentId: 'agent-b' },
        null,
        operator(),
      ),
    );
    expect(peers.previewAgent).toHaveBeenCalledWith(
      'agent-a',
      'agent-b',
      OWNER_PARTY,
    );
    expect(peers.previewByUrl).not.toHaveBeenCalled();
    expect(text).toContain('Support Bot');
  });

  it('previews an outside card by address, credential and all', async () => {
    const { tool, peers } = harness();
    await tool.previewAgentCard(
      {
        agentId: 'agent-a',
        url: 'https://elderly.example',
        credential: 'secret',
      },
      null,
      operator(),
    );
    expect(peers.previewByUrl).toHaveBeenCalledWith(
      'agent-a',
      'https://elderly.example',
      'secret',
    );
  });

  it('refuses a preview that names both an agent and an address', async () => {
    const { tool } = harness();
    const result = await tool.previewAgentCard(
      { agentId: 'agent-a', peerAgentId: 'agent-b', url: 'https://x.example' },
      null,
      operator(),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('exactly one');
  });

  it('refuses a preview that names neither', async () => {
    const { tool } = harness();
    const result = await tool.previewAgentCard(
      { agentId: 'agent-a' },
      null,
      operator(),
    );
    expect(result.isError).toBe(true);
  });

  it('reads recent delegations, newest first, with a default limit', async () => {
    const { tool, peers } = harness();
    await tool.listAgentDelegations({ agentId: 'agent-a' }, null, operator());
    expect(peers.recentDelegations).toHaveBeenCalledWith(
      'agent-a',
      OWNER_PARTY,
      20,
    );

    await tool.listAgentDelegations(
      { agentId: 'agent-a', limit: 5 },
      null,
      operator(),
    );
    expect(peers.recentDelegations).toHaveBeenLastCalledWith(
      'agent-a',
      OWNER_PARTY,
      5,
    );
  });
});

describe('PeerAdminTool — changing the peer set', () => {
  it('names the connection and the restart that makes it real', async () => {
    const { tool, peers } = harness();
    const text = textOf(
      await tool.connectAgentPeer(
        { agentId: 'agent-a', peerAgentId: 'agent-b' },
        null,
        operator(),
      ),
    );
    expect(peers.connect).toHaveBeenCalledWith(
      'agent-a',
      'agent-b',
      OWNER_PARTY,
    );
    expect(text).toContain('«Support Bot» is now a peer of agent-a');
    expect(text).toContain('connection peer-1');
    expect(text).toContain('restart_agent with id=agent-a');
    expect(text).toContain('It advertises: Returns policy.');
  });

  it('warns when the peer just connected advertises nothing', async () => {
    const { tool, peers } = harness();
    peers.connect.mockResolvedValue(
      view({
        card: {
          ...card('Blank Bot', []),
          description: '',
        } as IA2aAgentCard,
        peerName: 'Blank Bot',
      }),
    );
    const text = textOf(
      await tool.connectAgentPeer(
        { agentId: 'agent-a', peerAgentId: 'agent-b' },
        null,
        operator(),
      ),
    );
    expect(text).toContain('advertises nothing');
    expect(text).toContain('names it outright');
  });

  it('imports an outside agent by address and reports the address back', async () => {
    const { tool, peers } = harness();
    const text = textOf(
      await tool.importExternalAgent(
        {
          agentId: 'agent-a',
          url: 'https://elderly.example',
          credential: 'secret',
        },
        null,
        operator(),
      ),
    );
    expect(peers.connectByUrl).toHaveBeenCalledWith(
      'agent-a',
      'https://elderly.example',
      'secret',
      OWNER_PARTY,
    );
    expect(text).toContain('«Elderly Care Match»');
    expect(text).toContain(
      'https://elderly.example/.well-known/agent-card.json',
    );
    expect(text).toContain('restart_agent');
  });

  it('says a re-read card only reaches the model after a restart', async () => {
    const { tool, peers } = harness();
    const text = textOf(
      await tool.refreshAgentPeer(
        { agentId: 'agent-a', peerId: 'peer-1' },
        null,
        operator(),
      ),
    );
    expect(peers.refresh).toHaveBeenCalledWith(
      'agent-a',
      'peer-1',
      OWNER_PARTY,
    );
    expect(text).toContain('Card re-read');
    expect(text).toContain('restart_agent with id=agent-a');
  });

  it('warns that a removed peer is still offered until the agent restarts', async () => {
    const { tool, peers } = harness();
    const text = textOf(
      await tool.removeAgentPeer(
        { agentId: 'agent-a', peerId: 'peer-1', confirm: true },
        null,
        operator(),
      ),
    );
    expect(peers.remove).toHaveBeenCalledWith('agent-a', 'peer-1', OWNER_PARTY);
    expect(text).toContain('still believes it has that colleague');
  });

  it('refuses to remove a peer without the confirmation argument (CLEAN-109)', async () => {
    const { tool, peers } = harness();
    const result = await tool.removeAgentPeer(
      { agentId: 'agent-a', peerId: 'peer-1' },
      null,
      operator(),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('confirm: true');
    expect(peers.remove).not.toHaveBeenCalled();
  });
});

describe('PeerAdminTool — refusals carry the next move', () => {
  it('sends our own address back to connect_agent_peer', async () => {
    const { tool, peers } = harness();
    peers.connectByUrl.mockRejectedValue(
      new BadRequestException({
        code: PeerErrorCodes.SelfUrl,
        message: 'This address belongs to an agent of this installation.',
      }),
    );
    const result = await tool.importExternalAgent(
      { agentId: 'agent-a', url: 'https://api.test/a2a/agents/agent-b' },
      null,
      operator(),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(
      'belongs to an agent of this installation',
    );
    expect(textOf(result)).toContain('connect_agent_peer');
  });

  it('tells the model nothing was saved when the card is not A2A 1.0', async () => {
    const { tool, peers } = harness();
    peers.connectByUrl.mockRejectedValue(
      new BadRequestException({
        code: PeerErrorCodes.Version,
        message: 'This agent speaks A2A 0.3.0; only 1.0 is supported.',
      }),
    );
    const text = textOf(
      await tool.importExternalAgent(
        { agentId: 'agent-a', url: 'https://old.example' },
        null,
        operator(),
      ),
    );
    expect(text).toContain('0.3.0');
    expect(text).toContain('Nothing was saved');
  });

  it('passes a refusal it has no advice for through unchanged', async () => {
    const { tool, peers } = harness();
    peers.connect.mockRejectedValue(
      new BadRequestException({ code: 'PEER_SOMETHING_NEW', message: 'Nope.' }),
    );
    const text = textOf(
      await tool.connectAgentPeer(
        { agentId: 'agent-a', peerAgentId: 'agent-b' },
        null,
        operator(),
      ),
    );
    expect(text).toBe('Nope.');
  });

  it('lets a non-HTTP failure escape, so the MCP layer reports it as an error', async () => {
    const { tool, peers } = harness();
    peers.list.mockRejectedValue(new Error('database is down'));
    await expect(
      tool.listAgentPeers({ agentId: 'agent-a' }, null, operator()),
    ).rejects.toThrow('database is down');
  });
});

describe('PeerAdminTool — importing from a card (CLEAN-116)', () => {
  const CARD = '{"name":"Pasted Bot","skills":[]}';

  it('connects the card to the agent it was told, and names the address it found', async () => {
    const { tool, peers } = harness();

    const text = textOf(
      await tool.importAgentFromCard(
        { agentId: 'agent-a', card: CARD, credential: 'secret' },
        null,
        operator(),
      ),
    );

    expect(peers.connectByCard).toHaveBeenCalledWith(
      'agent-a',
      CARD,
      'secret',
      OWNER_PARTY,
    );
    expect(text).toContain('«Pasted Bot»');
    expect(text).toContain(
      'https://pasted.example/a2a/.well-known/agent-card.json',
    );
    expect(text).toContain('restart_agent with id=agent-a');
  });

  it('stays shut to an agent that is not a Ranch operator', async () => {
    const { tool, peers } = harness();

    const result = await tool.importAgentFromCard(
      { agentId: 'agent-a', card: CARD },
      null,
      plainAgent(),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(PERSON_NEEDED);
    expect(peers.connectByCard).not.toHaveBeenCalled();
  });
});

/**
 * The other end of a connection (CLEAN-236). The tool asks whether the
 * person manages the agent that does the asking; whether they may see,
 * connect or change the peer is `PeerService`'s, by the one rule every entry
 * point shares (`peer.service.spec.ts`). So the cases here are that the tool
 * hands over the person the call is made for, decides nothing about the peer
 * itself, and passes the service's refusals on in the words of an agent that
 * does not exist.
 */
describe('PeerAdminTool — the other end of a connection', () => {
  const admin = () =>
    asPerson(request([UserRoleTypes.Owner]), UserRoleTypes.Admin);
  const ADMIN_PARTY = { kind: 'person', userId: 'user-1', role: 'Admin' };
  const notFound = () =>
    new NotFoundException({
      code: PeerErrorCodes.NotFound,
      message: 'Agent not found',
    });

  it('hands every call to the service for the person it is made for', async () => {
    const { tool, peers } = harness();
    const args = { agentId: 'agent-a', peerId: 'peer-1' };

    await tool.listAgentPeers({ agentId: 'agent-a' }, null, admin());
    await tool.listPeerCandidates({ agentId: 'agent-a' }, null, admin());
    await tool.connectAgentPeer(
      { agentId: 'agent-a', peerAgentId: 'agent-b' },
      null,
      admin(),
    );
    await tool.importExternalAgent(
      { agentId: 'agent-a', url: 'https://elderly.example', credential: 'tk' },
      null,
      admin(),
    );
    await tool.importAgentFromCard(
      { agentId: 'agent-a', card: '{"name":"x"}' },
      null,
      admin(),
    );
    await tool.refreshAgentPeer(args, null, admin());
    await tool.removeAgentPeer({ ...args, confirm: true }, null, admin());

    expect(peers.list).toHaveBeenCalledWith('agent-a', ADMIN_PARTY);
    expect(peers.candidates).toHaveBeenCalledWith('agent-a', ADMIN_PARTY);
    expect(peers.connect).toHaveBeenCalledWith(
      'agent-a',
      'agent-b',
      ADMIN_PARTY,
    );
    expect(peers.connectByUrl).toHaveBeenCalledWith(
      'agent-a',
      'https://elderly.example',
      'tk',
      ADMIN_PARTY,
    );
    expect(peers.connectByCard).toHaveBeenCalledWith(
      'agent-a',
      '{"name":"x"}',
      undefined,
      ADMIN_PARTY,
    );
    expect(peers.refresh).toHaveBeenCalledWith(
      'agent-a',
      'peer-1',
      ADMIN_PARTY,
    );
    expect(peers.remove).toHaveBeenCalledWith('agent-a', 'peer-1', ADMIN_PARTY);
  });

  it('offers the candidates the service names, and filters none itself', async () => {
    const { tool, peers } = harness();
    (peers.candidates as jest.Mock).mockResolvedValue([
      {
        id: 'agent-b',
        name: 'Support Bot',
        status: 'running',
        connected: false,
      },
    ]);

    const offered = JSON.parse(
      textOf(
        await tool.listPeerCandidates({ agentId: 'agent-a' }, null, admin()),
      ),
    ) as { id: string }[];

    expect(offered.map((c) => c.id)).toEqual(['agent-b']);
  });

  it('answers a peer the person does not reach as an agent that does not exist', async () => {
    const { tool, peers } = harness();
    (peers.connect as jest.Mock).mockRejectedValue(notFound());
    (peers.previewAgent as jest.Mock).mockRejectedValue(notFound());

    for (const result of [
      await tool.connectAgentPeer(
        { agentId: 'agent-a', peerAgentId: 'agent-hidden' },
        null,
        admin(),
      ),
      await tool.previewAgentCard(
        { agentId: 'agent-a', peerAgentId: 'agent-hidden' },
        null,
        admin(),
      ),
    ]) {
      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe(NOT_FOUND);
    }
  });

  it('says so when a connection is the person’s to see and not to change', async () => {
    const { tool, peers } = harness();
    (peers.remove as jest.Mock).mockRejectedValue(
      new ForbiddenException({
        code: PeerErrorCodes.Forbidden,
        message: 'This connection can be changed by the person who made it.',
      }),
    );

    const result = await tool.removeAgentPeer(
      { agentId: 'agent-a', peerId: 'peer-1', confirm: true },
      null,
      admin(),
    );

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/not theirs to change/);
  });

  it('lists a masked peer by its skills, with no name, address or status of the agent behind it', async () => {
    const { tool, peers } = harness();
    (peers.list as jest.Mock).mockResolvedValue([
      view({
        visibility: 'masked',
        peerAgentId: null,
        peerName: 'A colleague',
        peerStatus: 'hidden',
        cardUrl: '',
        createdBy: null,
        openToVisitors: true,
        canRemove: false,
        canSetVisitors: false,
        card: { ...card('A colleague', ['Returns']), description: '' },
      }),
    ]);

    const text = textOf(
      await tool.listAgentPeers({ agentId: 'agent-a' }, null, admin()),
    );
    const [peer] = (JSON.parse(text) as { peers: Record<string, unknown>[] })
      .peers;

    expect(peer).toEqual({
      peerId: 'peer-1',
      name: 'A colleague',
      note: expect.stringMatching(/Open to visitors/),
      openToVisitors: true,
      skills: [{ name: 'Returns', description: 'Answers about Returns' }],
    });
  });

  it('says who connected a peer, whom it serves and whether the person may remove it', async () => {
    const { tool, peers } = harness();
    (peers.list as jest.Mock).mockResolvedValue([
      view(),
      view({
        id: 'peer-2',
        peerAgentId: null,
        origin: PeerOrigins.External,
        createdBy: null,
        owner: { id: 'user-9', name: 'Uma User' },
        canRemove: false,
        needsReview: true,
      }),
    ]);

    const { peers: listed } = JSON.parse(
      textOf(await tool.listAgentPeers({ agentId: 'agent-a' }, null, admin())),
    ) as { peers: Record<string, unknown>[] };

    expect(listed[0]).toMatchObject({
      connectedBy: 'Olga Owner',
      openToVisitors: false,
      canRemove: true,
    });
    expect(listed[1]).toMatchObject({
      connectedBy: expect.stringMatching(/not recorded/),
      serves: 'only Uma User',
      needsReview: true,
      canRemove: false,
    });
  });
});

/**
 * CLEAN-236, FR-012. A turn nobody asked for has no person whose reach could
 * be asked, so it inspects and changes nobody's peers: not the Ranch admin
 * agent on its own schedule, which holds operator power and ran these tools
 * for itself until now.
 */
describe('PeerAdminTool — a person is required', () => {
  it('is not listed for the Ranch admin agent acting for itself', async () => {
    const { tool } = harness();
    await expect(tool.isListedForRequest(ranchForItself())).resolves.toBe(
      false,
    );
    await expect(tool.isListedForRequest(operator())).resolves.toBe(true);
  });

  it('refuses every tool by name for it, before any agent is looked at', async () => {
    const { tool, peers, agents } = harness();

    for (const result of [
      await tool.listAgentPeers({ agentId: 'agent-a' }, null, ranchForItself()),
      await tool.connectAgentPeer(
        { agentId: 'agent-a', peerAgentId: 'agent-b' },
        null,
        ranchForItself(),
      ),
      await tool.removeAgentPeer(
        { agentId: 'agent-a', peerId: 'peer-1', confirm: true },
        null,
        ranchForItself(),
      ),
    ]) {
      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe('This needs a signed-in person.');
    }
    expect(agents.findById).not.toHaveBeenCalled();
    expect(peers.list).not.toHaveBeenCalled();
    expect(peers.connect).not.toHaveBeenCalled();
    expect(peers.remove).not.toHaveBeenCalled();
  });
});

/** CLEAN-236. Opening a connection to visitors, from the chat. */
describe('PeerAdminTool — set_agent_peer_visitors', () => {
  const args = { agentId: 'agent-a', peerId: 'peer-1' };

  it('opens only after the person confirmed, and says what opening means', async () => {
    const { tool, peers } = harness();

    const asked = await tool.setAgentPeerVisitors(
      { ...args, open: true },
      null,
      operator(),
    );
    expect(asked.isError).toBe(true);
    expect(textOf(asked)).toMatch(/everybody who talks to agent agent-a/);
    expect(peers.setVisitors).not.toHaveBeenCalled();

    const done = await tool.setAgentPeerVisitors(
      { ...args, open: true, confirm: true },
      null,
      operator(),
    );
    expect(done.isError).toBeUndefined();
    expect(peers.setVisitors).toHaveBeenCalledWith(
      'agent-a',
      'peer-1',
      true,
      OWNER_PARTY,
    );
    expect(textOf(done)).toMatch(/now serves everybody who talks to agent-a/);
  });

  it('closes on confirm too, and says whom it serves then', async () => {
    const { tool, peers } = harness();

    const done = await tool.setAgentPeerVisitors(
      { ...args, open: false, confirm: true },
      null,
      operator(),
    );

    expect(peers.setVisitors).toHaveBeenCalledWith(
      'agent-a',
      'peer-1',
      false,
      OWNER_PARTY,
    );
    expect(textOf(done)).toMatch(/only the people who have access to it/);
  });

  it('answers a connection the person may not open as one that does not exist', async () => {
    const { tool, peers } = harness();
    (peers.setVisitors as jest.Mock).mockRejectedValue(
      new NotFoundException({
        code: PeerErrorCodes.NotFound,
        message: 'Peer connection not found',
      }),
    );

    const result = await tool.setAgentPeerVisitors(
      { ...args, open: true, confirm: true },
      null,
      operator(),
    );

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/^Peer connection not found/);
  });
});
