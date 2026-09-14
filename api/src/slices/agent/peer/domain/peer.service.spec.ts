import { PeerService } from './peer.service';
import { PeerCardUnreachableError, PEER_TOKEN_RE } from './peer.types';
import type { IPeerGateway } from './peer.gateway';
import type { AgentCardService } from './agentCard.service';
import type { A2aClient } from './a2a.client';
import type { IAgentGateway } from '#/agent/agent/domain';
import type { IA2aAgentCard } from './a2a.types';

/**
 * Connecting a peer. The rule these cases defend: "connected" must mean the
 * credential was proved against the real card route, so an operator can never
 * hold a connection that quietly does not work. The corollary is the failure
 * path — a failed read must leave nothing behind.
 */
const card = (name: string): IA2aAgentCard => ({
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
  skills: [{ id: 'skill:1', name: 'Orders', description: 'Finds', tags: ['skill'] }],
});

function makeHarness(options: {
  agents?: Array<{ id: string; name: string; status: string }>;
  fetchCardThrows?: unknown;
} = {}) {
  const agents = options.agents ?? [
    { id: 'a', name: 'Caller', status: 'running' },
    { id: 'b', name: 'Support Bot', status: 'running' },
    { id: 'c', name: 'Third', status: 'stopped' },
  ];

  const rows: Record<string, Record<string, any>> = {};
  let seq = 0;

  const peers = {
    listByAgent: jest.fn(async (agentId: string) =>
      Object.values(rows).filter((r) => r.agentId === agentId),
    ),
    findById: jest.fn(async (id: string) => rows[id] ?? null),
    findByPair: jest.fn(
      async (agentId: string, peerAgentId: string) =>
        Object.values(rows).find(
          (r) => r.agentId === agentId && r.peerAgentId === peerAgentId,
        ) ?? null,
    ),
    findByToken: jest.fn(
      async (token: string) =>
        Object.values(rows).find((r) => r.token === token) ?? null,
    ),
    create: jest.fn(async (input: Record<string, any>) => {
      const id = `peer-${(seq += 1)}`;
      rows[id] = {
        id,
        ...input,
        cardReadAt: input.cardReadAt.toISOString(),
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      };
      return rows[id];
    }),
    updateSnapshot: jest.fn(
      async (id: string, input: Record<string, any>) => {
        Object.assign(rows[id], {
          cardSnapshot: input.cardSnapshot,
          cardUrl: input.cardUrl,
          cardReadAt: input.cardReadAt.toISOString(),
        });
        return rows[id];
      },
    ),
    delete: jest.fn(async (id: string) => {
      delete rows[id];
    }),
  } as unknown as IPeerGateway;

  const agentGateway = {
    findAll: jest.fn(async () => agents),
    findById: jest.fn(async (id: string) => agents.find((a) => a.id === id) ?? null),
  } as unknown as IAgentGateway;

  const cards = {
    build: jest.fn(async (id: string) => card(id)),
    cardUrlFor: jest.fn(
      async (id: string) =>
        `https://api.test/a2a/agents/${id}/.well-known/agent-card.json`,
    ),
  } as unknown as AgentCardService;

  const fetchCard = jest.fn(async (_url: string, _token: string) => {
    if (options.fetchCardThrows) throw options.fetchCardThrows;
    return card('Support Bot');
  });
  const client = { fetchCard } as unknown as A2aClient;

  const service = new PeerService(peers, agentGateway, cards, client);
  return { service, peers, rows, fetchCard, cards };
}

describe('PeerService.connect', () => {
  it('mints a credential of the documented shape', async () => {
    const { service, rows } = makeHarness();

    await service.connect('a', 'b');

    const [row] = Object.values(rows);
    expect(row.token).toMatch(PEER_TOKEN_RE);
  });

  it('proves the credential works by reading the card with it', async () => {
    const { service, fetchCard, rows } = makeHarness();

    await service.connect('a', 'b');

    const [row] = Object.values(rows);
    expect(fetchCard).toHaveBeenCalledWith(
      'https://api.test/a2a/agents/b/.well-known/agent-card.json',
      row.token,
    );
  });

  it('stores the card it read, with the time it read it', async () => {
    const { service } = makeHarness();

    const view = await service.connect('a', 'b');

    expect(view.card.name).toBe('Support Bot');
    expect(view.cardReadAt).toEqual(expect.any(String));
    expect(view.peerName).toBe('Support Bot');
    expect(view.peerStatus).toBe('running');
  });

  it('leaves nothing behind when the card cannot be read', async () => {
    const { service, rows } = makeHarness({
      fetchCardThrows: new PeerCardUnreachableError('host is down'),
    });

    await expect(service.connect('a', 'b')).rejects.toMatchObject({
      response: { code: 'PEER_CARD_UNREACHABLE' },
    });
    expect(Object.values(rows)).toHaveLength(0);
  });

  it('refuses to connect an agent to itself', async () => {
    const { service } = makeHarness();

    await expect(service.connect('a', 'a')).rejects.toMatchObject({
      response: { code: 'PEER_SELF' },
    });
  });

  it('refuses a second connection to a peer it already holds', async () => {
    const { service } = makeHarness();
    await service.connect('a', 'b');

    await expect(service.connect('a', 'b')).rejects.toMatchObject({
      response: { code: 'PEER_EXISTS' },
    });
  });

  it('refuses a peer that does not exist', async () => {
    const { service } = makeHarness();

    await expect(service.connect('a', 'ghost')).rejects.toMatchObject({
      response: { code: 'PEER_NOT_FOUND' },
    });
  });

  it('never lets the credential reach the caller', async () => {
    const { service } = makeHarness();

    const view = await service.connect('a', 'b');

    expect(JSON.stringify(view)).not.toContain('ap_');
    expect(view).not.toHaveProperty('token');
  });

  it('leaves the opposite direction alone', async () => {
    const { service } = makeHarness();
    await service.connect('a', 'b');

    await expect(service.list('b')).resolves.toEqual([]);
  });
});

describe('PeerService.refresh', () => {
  it('replaces the snapshot with what the card says now', async () => {
    const { service, fetchCard } = makeHarness();
    const connected = await service.connect('a', 'b');
    fetchCard.mockResolvedValue({
      ...card('Support Bot'),
      description: 'Now also handles refunds.',
    });

    const refreshed = await service.refresh('a', connected.id);

    expect(refreshed.card.description).toBe('Now also handles refunds.');
  });

  it('keeps the old snapshot when the read fails, and says what failed', async () => {
    const { service, fetchCard } = makeHarness();
    const connected = await service.connect('a', 'b');
    fetchCard.mockRejectedValue(new PeerCardUnreachableError('502 Bad Gateway'));

    await expect(service.refresh('a', connected.id)).rejects.toMatchObject({
      response: { code: 'PEER_CARD_UNREACHABLE' },
    });
    const [still] = await service.list('a');
    expect(still.card.description).toBe('Support Bot answers things');
  });

  it('refuses to refresh a connection that belongs to another agent', async () => {
    const { service } = makeHarness();
    const connected = await service.connect('a', 'b');

    await expect(service.refresh('c', connected.id)).rejects.toMatchObject({
      response: { code: 'PEER_NOT_FOUND' },
    });
  });
});

describe('PeerService.remove', () => {
  it('kills the connection and with it the credential', async () => {
    const { service, peers, rows } = makeHarness();
    const connected = await service.connect('a', 'b');
    const token = Object.values(rows)[0].token as string;

    await service.remove('a', connected.id);

    await expect(peers.findByToken(token)).resolves.toBeNull();
    await expect(service.list('a')).resolves.toEqual([]);
  });

  it('refuses to remove a connection that belongs to another agent', async () => {
    const { service } = makeHarness();
    const connected = await service.connect('a', 'b');

    await expect(service.remove('c', connected.id)).rejects.toMatchObject({
      response: { code: 'PEER_NOT_FOUND' },
    });
  });
});

describe('PeerService.candidates', () => {
  it('offers every other agent and marks the ones already connected', async () => {
    const { service } = makeHarness();
    await service.connect('a', 'b');

    const candidates = await service.candidates('a');

    expect(candidates).toEqual([
      { id: 'b', name: 'Support Bot', status: 'running', connected: true },
      { id: 'c', name: 'Third', status: 'stopped', connected: false },
    ]);
  });

  it('never offers the agent itself', async () => {
    const { service } = makeHarness();

    const candidates = await service.candidates('a');

    expect(candidates.map((c) => c.id)).not.toContain('a');
  });
});

describe('PeerService.list', () => {
  it('reports a peer whose agent has been deleted as gone', async () => {
    const { service, rows } = makeHarness();
    await service.connect('a', 'b');
    // The FK cascade normally removes the row with the agent; this is the
    // remote-peer shape the view has to survive anyway.
    Object.values(rows)[0].peerAgentId = 'vanished';

    const [view] = await service.list('a');

    expect(view.peerExists).toBe(false);
    expect(view.peerStatus).toBe('unknown');
    expect(view.peerName).toBe('Support Bot');
  });
});
