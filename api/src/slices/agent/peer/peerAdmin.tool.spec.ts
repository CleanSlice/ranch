import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { PeerAdminTool } from './peerAdmin.tool';
import { PeerErrorCodes, PeerOrigins } from './domain/peer.types';
import type { IAgentPeerView } from './domain/peer.types';
import type { IA2aAgentCard } from './domain';
import type { PeerService } from './domain/peer.service';
import type { AgentCardService } from './domain/agentCard.service';
import type { IDelegationGateway } from './domain/delegation.gateway';
import { UserRoleTypes } from '#/user/user/domain';

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
  ...overrides,
});

const request = (roles: UserRoleTypes[]): Request =>
  ({
    user: { sub: 'agent:agent-ops', email: '', roles },
  }) as unknown as Request;

const operator = () => request([UserRoleTypes.Owner]);
const plainAgent = () => request([UserRoleTypes.Agent]);

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
      | 'previewByUrl'
      | 'refresh'
      | 'remove'
    >
  >;
  cards: { build: jest.Mock };
  delegations: { listRecent: jest.Mock };
}

function harness(): Harness {
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
    previewByUrl: jest.fn().mockResolvedValue(card('Elderly Care Match')),
    refresh: jest.fn().mockResolvedValue(view()),
    remove: jest.fn().mockResolvedValue(undefined),
  } as unknown as Harness['peers'];

  const cards = { build: jest.fn().mockResolvedValue(card('Support Bot')) };
  const delegations = { listRecent: jest.fn().mockResolvedValue([]) };

  const tool = new PeerAdminTool(
    peers as unknown as PeerService,
    cards as unknown as AgentCardService,
    delegations as unknown as IDelegationGateway,
  );
  return { tool, peers, cards, delegations };
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

  it('refuses a call from a plain agent even by name', async () => {
    const { tool, peers } = harness();
    await expect(
      tool.connectAgentPeer(
        { agentId: 'agent-a', peerAgentId: 'agent-b' },
        null,
        plainAgent(),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(peers.connect).not.toHaveBeenCalled();
  });

  it('refuses a caller with no roles at all', async () => {
    const { tool } = harness();
    await expect(
      tool.listAgentPeers({ agentId: 'agent-a' }, null, {} as Request),
    ).rejects.toBeInstanceOf(ForbiddenException);
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

  it('previews a card of this Ranch without touching the peer service', async () => {
    const { tool, peers, cards } = harness();
    const text = textOf(
      await tool.previewAgentCard(
        { agentId: 'agent-a', peerAgentId: 'agent-b' },
        null,
        operator(),
      ),
    );
    expect(cards.build).toHaveBeenCalledWith('agent-b');
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
    const { tool, delegations } = harness();
    await tool.listAgentDelegations({ agentId: 'agent-a' }, null, operator());
    expect(delegations.listRecent).toHaveBeenCalledWith('agent-a', 20);

    await tool.listAgentDelegations(
      { agentId: 'agent-a', limit: 5 },
      null,
      operator(),
    );
    expect(delegations.listRecent).toHaveBeenLastCalledWith('agent-a', 5);
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
    expect(peers.connect).toHaveBeenCalledWith('agent-a', 'agent-b');
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
    expect(peers.refresh).toHaveBeenCalledWith('agent-a', 'peer-1');
    expect(text).toContain('Card re-read');
    expect(text).toContain('restart_agent with id=agent-a');
  });

  it('warns that a removed peer is still offered until the agent restarts', async () => {
    const { tool, peers } = harness();
    const text = textOf(
      await tool.removeAgentPeer(
        { agentId: 'agent-a', peerId: 'peer-1' },
        null,
        operator(),
      ),
    );
    expect(peers.remove).toHaveBeenCalledWith('agent-a', 'peer-1');
    expect(text).toContain('still believes it has that colleague');
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
