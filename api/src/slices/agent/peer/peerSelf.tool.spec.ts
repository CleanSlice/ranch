import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { PeerSelfTool, SELF_SERVICE_SETTING } from './peerSelf.tool';
import { PeerErrorCodes, PeerOrigins } from './domain/peer.types';
import type { IAgentPeerView } from './domain/peer.types';
import type { IA2aAgentCard } from './domain';
import type { PeerService } from './domain/peer.service';
import type { ISettingGateway } from '#/setting/domain';
import { UserRoleTypes } from '#/user/user/domain';

/**
 * The point of this tool set is that an agent can only ever change its OWN
 * colleagues: no tool takes an agent id, and the id comes from the token. The
 * tests that matter most are therefore the ones about identity, about the kill
 * switch, and about telling the truth on whether the new colleague can be
 * asked yet — a "connected!" that silently does nothing is the failure this
 * feature was built to end.
 */
const card = (name: string, skills: string[] = ['Find care facilities']) =>
  ({
    name,
    description: `${name} answers care questions.`,
    version: '1',
    supportedInterfaces: [
      {
        url: `https://elderly.example/a2a`,
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
  agentId: 'agent-me',
  peerAgentId: null,
  origin: PeerOrigins.External,
  peerName: 'Elderly Care Match',
  peerStatus: 'external',
  peerExists: true,
  card: card('Elderly Care Match'),
  cardUrl: 'https://www.elderlycarematch.com/.well-known/agent-card.json',
  cardReadAt: '2026-09-21T10:00:00.000Z',
  createdAt: '2026-09-21T10:00:00.000Z',
  ...overrides,
});

const agentRequest = () =>
  ({
    user: {
      sub: 'agent:agent-me',
      email: '',
      roles: [UserRoleTypes.Agent],
    },
  }) as unknown as Request;

/** A console user, not an agent: `sub` carries no `agent:` prefix. */
const personRequest = () =>
  ({
    user: {
      sub: 'user-1',
      email: 'me@example.com',
      roles: [UserRoleTypes.Owner],
    },
  }) as unknown as Request;

interface Harness {
  tool: PeerSelfTool;
  peers: {
    list: jest.Mock;
    candidates: jest.Mock;
    connect: jest.Mock;
    connectByUrl: jest.Mock;
    connectByCard: jest.Mock;
    previewByUrl: jest.Mock;
    remove: jest.Mock;
  };
  settings: { findByKey: jest.Mock };
}

function harness(): Harness {
  const peers = {
    list: jest.fn().mockResolvedValue([]),
    candidates: jest.fn().mockResolvedValue([
      {
        id: 'agent-b',
        name: 'Skyhunter',
        status: 'running',
        connected: false,
      },
    ]),
    connect: jest.fn().mockResolvedValue(
      view({
        peerName: 'Skyhunter',
        peerAgentId: 'agent-b',
        origin: PeerOrigins.Internal,
        card: card('Skyhunter', ['Flight search']),
      }),
    ),
    connectByUrl: jest.fn().mockResolvedValue(view()),
    connectByCard: jest.fn().mockResolvedValue(view()),
    previewByUrl: jest.fn().mockResolvedValue(card('Elderly Care Match')),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const settings = { findByKey: jest.fn().mockResolvedValue(null) };

  const tool = new PeerSelfTool(
    peers as unknown as PeerService,
    settings as unknown as ISettingGateway,
  );
  return { tool, peers, settings };
}

const textOf = (result: { content: { text: string }[] }) =>
  result.content[0].text;

describe('PeerSelfTool — who gets these tools', () => {
  it('offers them to any agent, admin or not', async () => {
    const { tool } = harness();
    await expect(tool.isListedForRequest(agentRequest())).resolves.toBe(true);
  });

  it('hides them from a console user, however privileged', async () => {
    const { tool } = harness();
    await expect(tool.isListedForRequest(personRequest())).resolves.toBe(false);
  });

  it('hides them when the Ranch has switched self-service off', async () => {
    const { tool, settings } = harness();
    settings.findByKey.mockResolvedValue({ value: false });
    await expect(tool.isListedForRequest(agentRequest())).resolves.toBe(false);
    expect(settings.findByKey).toHaveBeenCalledWith(
      SELF_SERVICE_SETTING.group,
      SELF_SERVICE_SETTING.name,
    );
  });

  it('reads "off" written as a string too', async () => {
    const { tool, settings } = harness();
    settings.findByKey.mockResolvedValue({ value: 'off' });
    await expect(tool.isListedForRequest(agentRequest())).resolves.toBe(false);
  });

  it('stays on when the setting cannot be read at all', async () => {
    const { tool, settings } = harness();
    settings.findByKey.mockRejectedValue(new Error('database is down'));
    await expect(tool.isListedForRequest(agentRequest())).resolves.toBe(true);
  });

  it('refuses a call once self-service is off, not just hides the tool', async () => {
    const { tool, settings, peers } = harness();
    settings.findByKey.mockResolvedValue({ value: false });
    await expect(
      tool.importMyPeerByAddress(
        { url: 'https://elderly.example' },
        null,
        agentRequest(),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(peers.connectByUrl).not.toHaveBeenCalled();
  });

  it('refuses a caller that is not an agent runtime', async () => {
    const { tool } = harness();
    await expect(
      tool.listMyPeers({}, null, personRequest()),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('PeerSelfTool — it can only touch its own peers', () => {
  it('connects using the id from the token, which no argument can override', async () => {
    const { tool, peers } = harness();
    await tool.connectMyPeer({ peerAgentId: 'agent-b' }, null, agentRequest());
    expect(peers.connect).toHaveBeenCalledWith('agent-me', 'agent-b');
  });

  it('imports an outside agent for itself, credential and all', async () => {
    const { tool, peers } = harness();
    const text = textOf(
      await tool.importMyPeerByAddress(
        {
          url: 'https://www.elderlycarematch.com/.well-known/agent-card.json',
          credential: 'secret',
        },
        null,
        agentRequest(),
      ),
    );
    expect(peers.connectByUrl).toHaveBeenCalledWith(
      'agent-me',
      'https://www.elderlycarematch.com/.well-known/agent-card.json',
      'secret',
    );
    expect(text).toContain('«Elderly Care Match» ');
    expect(text).toContain('is now your colleague');
    expect(text).toContain('Find care facilities');
  });

  it('previews an address without saving anything', async () => {
    const { tool, peers } = harness();
    await tool.previewAgentCardByAddress(
      { url: 'https://elderly.example' },
      null,
      agentRequest(),
    );
    expect(peers.previewByUrl).toHaveBeenCalledWith(
      'agent-me',
      'https://elderly.example',
      undefined,
    );
    expect(peers.connectByUrl).not.toHaveBeenCalled();
  });

  it('lists the Ranch agents it could take as colleagues', async () => {
    const { tool, peers } = harness();
    const text = textOf(await tool.listRanchAgents({}, null, agentRequest()));
    expect(peers.candidates).toHaveBeenCalledWith('agent-me');
    expect(text).toContain('Skyhunter');
  });
});

describe('PeerSelfTool — whether the new colleague can be asked yet', () => {
  it('says a first colleague is unusable until the agent restarts', async () => {
    const { tool, peers } = harness();
    peers.list.mockResolvedValue([]);
    const text = textOf(
      await tool.connectMyPeer(
        { peerAgentId: 'agent-b' },
        null,
        agentRequest(),
      ),
    );
    expect(text).toContain('cannot ask');
    expect(text).toContain('restarted');
    expect(text).not.toContain('right now');
  });

  it('says a later colleague can be asked right away, by name', async () => {
    const { tool, peers } = harness();
    peers.list.mockResolvedValue([view()]);
    const text = textOf(
      await tool.connectMyPeer(
        { peerAgentId: 'agent-b' },
        null,
        agentRequest(),
      ),
    );
    expect(text).toContain('right now');
    expect(text).toContain('ask_agent, peer: "Skyhunter"');
  });

  it('warns when the colleague it just took advertises nothing', async () => {
    const { tool, peers } = harness();
    peers.connectByUrl.mockResolvedValue(
      view({
        peerName: 'Blank Bot',
        card: { ...card('Blank Bot', []), description: '' } as IA2aAgentCard,
      }),
    );
    const text = textOf(
      await tool.importMyPeerByAddress(
        { url: 'https://blank.example' },
        null,
        agentRequest(),
      ),
    );
    expect(text).toContain('advertises nothing');
  });
});

describe('PeerSelfTool — reading and dropping', () => {
  it('points an agent with no colleagues at the two ways to get one', async () => {
    const { tool } = harness();
    const text = textOf(await tool.listMyPeers({}, null, agentRequest()));
    expect(text).toContain('no colleagues yet');
    expect(text).toContain('connect_my_peer');
    expect(text).toContain('import_my_peer_by_address');
  });

  it('lists the colleagues it has with what they advertise', async () => {
    const { tool, peers } = harness();
    peers.list.mockResolvedValue([view()]);
    const text = textOf(await tool.listMyPeers({}, null, agentRequest()));
    expect(text).toContain('Elderly Care Match');
    expect(text).toContain('Find care facilities');
    expect(text).toContain('ask_agent');
  });

  it('names what is left after dropping one', async () => {
    const { tool, peers } = harness();
    peers.list.mockResolvedValue([view({ peerName: 'Skyhunter' })]);
    const text = textOf(
      await tool.removeMyPeer(
        { peerId: 'peer-1', confirm: true },
        null,
        agentRequest(),
      ),
    );
    expect(peers.remove).toHaveBeenCalledWith('agent-me', 'peer-1');
    expect(text).toContain('«Skyhunter»');
  });

  it('refuses to drop a peer without the confirmation argument (CLEAN-109)', async () => {
    const { tool, peers } = harness();
    const result = await tool.removeMyPeer(
      { peerId: 'peer-1' },
      null,
      agentRequest(),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('confirm: true');
    expect(peers.remove).not.toHaveBeenCalled();
  });

  it('says the ask_agent tool itself goes away with the last colleague', async () => {
    const { tool, peers } = harness();
    peers.list.mockResolvedValue([]);
    const text = textOf(
      await tool.removeMyPeer(
        { peerId: 'peer-1', confirm: true },
        null,
        agentRequest(),
      ),
    );
    expect(text).toContain('last colleague');
    expect(text).toContain('ask_agent');
  });
});

describe('PeerSelfTool — refusals in its own vocabulary', () => {
  it('sends an address of this Ranch to connect_my_peer', async () => {
    const { tool, peers } = harness();
    peers.connectByUrl.mockRejectedValue(
      new BadRequestException({
        code: PeerErrorCodes.SelfUrl,
        message: 'This address belongs to an agent of this installation.',
      }),
    );
    const result = await tool.importMyPeerByAddress(
      { url: 'https://api.test/a2a/agents/agent-b' },
      null,
      agentRequest(),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('list_ranch_agents');
    expect(textOf(result)).toContain('connect_my_peer');
  });

  it('tells the person plainly when the colleague is already connected', async () => {
    const { tool, peers } = harness();
    peers.connectByUrl.mockRejectedValue(
      new BadRequestException({
        code: PeerErrorCodes.Exists,
        message: 'Already a peer of this agent.',
      }),
    );
    const text = textOf(
      await tool.importMyPeerByAddress(
        { url: 'https://elderly.example' },
        null,
        agentRequest(),
      ),
    );
    expect(text).toContain('already connected');
  });

  it('does not dress a failing database up as advice', async () => {
    const { tool, peers } = harness();
    peers.list.mockRejectedValue(new Error('database is down'));
    await expect(tool.listMyPeers({}, null, agentRequest())).rejects.toThrow(
      'database is down',
    );
  });
});

describe('PeerSelfTool — connecting from a card it was handed (CLEAN-116)', () => {
  const CARD = '{"name":"Elderly Care Match","skills":[]}';

  it('passes the card text through under its own id', async () => {
    const { tool, peers } = harness();

    await tool.connectMyPeerFromCard(
      { card: CARD, credential: 'secret' },
      null,
      agentRequest(),
    );

    expect(peers.connectByCard).toHaveBeenCalledWith(
      'agent-me',
      CARD,
      'secret',
    );
  });

  it('says where delegations will actually go, since nobody typed an address', async () => {
    const { tool, peers } = harness();
    peers.list.mockResolvedValue([view()]);

    const text = textOf(
      await tool.connectMyPeerFromCard({ card: CARD }, null, agentRequest()),
    );

    expect(text).toContain('«Elderly Care Match»');
    expect(text).toContain(
      'https://www.elderlycarematch.com/.well-known/agent-card.json',
    );
    expect(text).toContain('right now');
  });

  it('is refused like every other self-service tool when the Ranch says no', async () => {
    const { tool, settings, peers } = harness();
    settings.findByKey.mockResolvedValue({ value: false });

    await expect(
      tool.connectMyPeerFromCard({ card: CARD }, null, agentRequest()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(peers.connectByCard).not.toHaveBeenCalled();
  });

  it('hands back the reason a card was refused', async () => {
    const { tool, peers } = harness();
    peers.connectByCard.mockRejectedValue(
      new BadRequestException({
        code: PeerErrorCodes.Body,
        message: 'This is not an agent card: it is empty.',
      }),
    );

    const result = await tool.connectMyPeerFromCard(
      { card: '   ' },
      null,
      agentRequest(),
    );

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('not an agent card');
  });
});
