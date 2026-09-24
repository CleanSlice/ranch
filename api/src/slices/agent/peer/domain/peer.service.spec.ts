import { PeerService } from './peer.service';
import {
  PeerCardUnreachableError,
  PEER_TOKEN_RE,
  PeerOrigins,
  hashPeerIds,
} from './peer.types';
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
  skills: [
    { id: 'skill:1', name: 'Orders', description: 'Finds', tags: ['skill'] },
  ],
});

/**
 * A card served from outside this installation. Its interface must point
 * somewhere other than `api.test`: since CLEAN-97 an import whose card sends
 * delegations back into this installation is refused as a self-import.
 */
const foreignCard = (
  name = 'Foreign Bot',
  supportedInterfaces: IA2aAgentCard['supportedInterfaces'] = [
    {
      url: 'https://other.example/a2a/agents/agent-x',
      protocolBinding: 'JSONRPC',
      protocolVersion: '1.0',
    },
  ],
): IA2aAgentCard => ({ ...card(name), supportedInterfaces });

function makeHarness(
  options: {
    agents?: Array<{ id: string; name: string; status: string }>;
    fetchCardThrows?: Error;
    /** Card returned for external imports; defaults to a valid 1.0 card. */
    externalCard?: IA2aAgentCard;
    served?: { servedAt: string; hash: string } | null;
  } = {},
) {
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
    findByCardUrl: jest.fn(
      async (agentId: string, cardUrl: string) =>
        Object.values(rows).find(
          (r) =>
            r.agentId === agentId &&
            r.cardUrl === cardUrl &&
            r.origin === PeerOrigins.External,
        ) ?? null,
    ),
    recordPeersServed: jest.fn(async () => undefined),
    readPeersServed: jest.fn(async () => options.served ?? null),
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
    updateSnapshot: jest.fn(async (id: string, input: Record<string, any>) => {
      Object.assign(rows[id], {
        cardSnapshot: input.cardSnapshot,
        cardUrl: input.cardUrl,
        cardReadAt: input.cardReadAt.toISOString(),
        ...(input.outboundToken !== undefined
          ? { outboundToken: input.outboundToken }
          : {}),
      });
      return rows[id];
    }),
    delete: jest.fn(async (id: string) => {
      delete rows[id];
    }),
  } as unknown as IPeerGateway;

  const agentGateway = {
    findAll: jest.fn(async () => agents),
    findById: jest.fn(
      async (id: string) => agents.find((a) => a.id === id) ?? null,
    ),
  } as unknown as IAgentGateway;

  const cards = {
    build: jest.fn(async (id: string) => card(id)),
    cardUrlFor: jest.fn(
      async (id: string) =>
        `https://api.test/a2a/agents/${id}/.well-known/agent-card.json`,
    ),
    ownA2aBase: jest.fn(async () => 'https://api.test/a2a/agents/'),
  } as unknown as AgentCardService;

  const fetchCard = jest.fn(async (url: string, _token?: string) => {
    if (options.fetchCardThrows) throw options.fetchCardThrows;
    if (!url.startsWith('https://api.test/')) {
      return options.externalCard ?? foreignCard();
    }
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
    fetchCard.mockRejectedValue(
      new PeerCardUnreachableError('502 Bad Gateway'),
    );

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

describe('PeerService — importing an external agent by URL (CLEAN-95)', () => {
  const EXT_BASE = 'https://other.example/a2a/agents/agent-x';
  const EXT_CARD = `${EXT_BASE}/.well-known/agent-card.json`;

  it('canonicalizes both address forms to the well-known card URL', async () => {
    const { service, fetchCard, rows } = makeHarness();

    await service.connectByUrl('a', EXT_BASE);
    expect(fetchCard).toHaveBeenLastCalledWith(EXT_CARD, undefined);

    const { service: s2, fetchCard: f2 } = makeHarness();
    await s2.connectByUrl('a', EXT_CARD);
    expect(f2).toHaveBeenLastCalledWith(EXT_CARD, undefined);

    expect(Object.values(rows)[0].cardUrl).toBe(EXT_CARD);
  });

  it('stores an external row: no pair token, no peer agent id', async () => {
    const { service, rows } = makeHarness();

    const view = await service.connectByUrl('a', EXT_BASE, 'tk-1');

    const row = Object.values(rows)[0];
    expect(row.origin).toBe(PeerOrigins.External);
    expect(row.peerAgentId).toBeNull();
    expect(row.token).toBeNull();
    expect(row.outboundToken).toBe('tk-1');
    expect(view.origin).toBe(PeerOrigins.External);
    expect(view.peerStatus).toBe('external');
    expect(view.peerExists).toBe(true);
  });

  it('re-imports the same canonical URL in place — one row, updated', async () => {
    const { service, rows } = makeHarness();

    const first = await service.connectByUrl('a', EXT_BASE, 'tk-1');
    const second = await service.connectByUrl('a', EXT_CARD, 'tk-2');

    expect(second.id).toBe(first.id);
    expect(Object.keys(rows)).toHaveLength(1);
    expect(Object.values(rows)[0].outboundToken).toBe('tk-2');
  });

  it('keeps the credential when omitted, clears it on empty string', async () => {
    const { service, rows } = makeHarness();

    await service.connectByUrl('a', EXT_BASE, 'tk-1');
    await service.connectByUrl('a', EXT_BASE);
    expect(Object.values(rows)[0].outboundToken).toBe('tk-1');

    await service.connectByUrl('a', EXT_BASE, '');
    expect(Object.values(rows)[0].outboundToken).toBeNull();
  });

  it('refuses an address of this installation with PEER_SELF_URL', async () => {
    const { service, fetchCard } = makeHarness();

    await expect(
      service.connectByUrl('a', 'https://api.test/a2a/agents/b'),
    ).rejects.toMatchObject({ response: { code: 'PEER_SELF_URL' } });
    expect(fetchCard).not.toHaveBeenCalled();
  });

  it('rejects garbage and private addresses as PEER_URL_INVALID', async () => {
    const { service } = makeHarness();

    await expect(service.connectByUrl('a', 'not a url')).rejects.toMatchObject({
      response: { code: 'PEER_URL_INVALID' },
    });
    await expect(
      service.connectByUrl('a', 'ftp://other.example/x'),
    ).rejects.toMatchObject({ response: { code: 'PEER_URL_INVALID' } });
    // SSRF guard: loopback and RFC1918 hosts never get a request.
    await expect(
      service.connectByUrl('a', 'https://192.168.1.10/a2a/agents/x'),
    ).rejects.toMatchObject({ response: { code: 'PEER_URL_INVALID' } });
  });

  it('persists nothing when the card cannot be fetched', async () => {
    const { service, rows } = makeHarness({
      fetchCardThrows: new PeerCardUnreachableError('refused'),
    });

    await expect(service.connectByUrl('a', EXT_BASE)).rejects.toMatchObject({
      response: { code: 'PEER_URL_UNREACHABLE' },
    });
    expect(Object.keys(rows)).toHaveLength(0);
  });

  it('tells "not a card" (400) apart from "unreachable" (502)', async () => {
    const invalid = makeHarness({
      fetchCardThrows: new PeerCardUnreachableError(
        'not a card',
        200,
        'invalid',
      ),
    });

    await expect(
      invalid.service.connectByUrl('a', EXT_BASE),
    ).rejects.toMatchObject({ response: { code: 'PEER_URL_INVALID' } });
  });

  it('refuses a card speaking another protocol version', async () => {
    const externalCard = foreignCard();
    externalCard.supportedInterfaces[0].protocolVersion = '2.0';
    const { service, rows } = makeHarness({ externalCard });

    await expect(service.connectByUrl('a', EXT_BASE)).rejects.toMatchObject({
      response: { code: 'PEER_VERSION' },
    });
    expect(Object.keys(rows)).toHaveLength(0);
  });

  it('imports an agent on the old dialect, which is most of the public ones', async () => {
    // The client hands over a 0.3 card already rewritten into the 1.0 shape,
    // with the version it declared on the interface (CLEAN-114).
    const externalCard = foreignCard('Legacy Bot', [
      {
        url: 'https://other.example/a2a/agents/agent-x',
        protocolBinding: 'JSONRPC',
        protocolVersion: '0.3.0',
      },
    ]);
    const { service, rows } = makeHarness({ externalCard });

    const view = await service.connectByUrl('a', EXT_BASE);

    expect(view.peerName).toBe('Legacy Bot');
    expect(Object.keys(rows)).toHaveLength(1);
  });
});

describe('PeerService — previewing an external URL (CLEAN-95)', () => {
  const EXT_BASE = 'https://other.example/a2a/agents/agent-x';

  it('returns the card and persists nothing', async () => {
    const { service, rows, peers } = makeHarness();

    const card = await service.previewByUrl('a', EXT_BASE, 'tk-1');

    expect(card.name).toBe('Foreign Bot');
    expect(Object.keys(rows)).toHaveLength(0);
    expect(
      (peers as unknown as { create: jest.Mock }).create,
    ).not.toHaveBeenCalled();
  });

  it('runs the same refusals as the import', async () => {
    const { service } = makeHarness();

    await expect(
      service.previewByUrl('a', 'https://api.test/a2a/agents/b'),
    ).rejects.toMatchObject({ response: { code: 'PEER_SELF_URL' } });
  });
});

describe('PeerService — refreshing an external row (CLEAN-95)', () => {
  const EXT_BASE = 'https://other.example/a2a/agents/agent-x';
  const EXT_CARD = `${EXT_BASE}/.well-known/agent-card.json`;

  it('re-reads the stored card URL with the outbound credential', async () => {
    const { service, fetchCard } = makeHarness();
    const imported = await service.connectByUrl('a', EXT_BASE, 'tk-1');

    await service.refresh('a', imported.id);

    expect(fetchCard).toHaveBeenLastCalledWith(EXT_CARD, 'tk-1');
  });
});

describe('PeerService — armed state (CLEAN-95)', () => {
  it('is armed when the served hash matches the current peer set', async () => {
    const harness = makeHarness({ served: null });
    const view = await harness.service.connect('a', 'b');
    const hash = hashPeerIds([view.id]);

    const cold = await harness.service.peersState('a');
    expect(cold).toEqual({ armed: false, servedAt: null });

    const warm = makeHarness({
      served: { servedAt: '2026-09-16T10:00:00.000Z', hash },
    });
    // Recreate the same single row so the hashes line up.
    const again = await warm.service.connect('a', 'b');
    expect(hashPeerIds([again.id])).toBe(hash);

    const state = await warm.service.peersState('a');
    expect(state.armed).toBe(true);
    expect(state.servedAt).toBe('2026-09-16T10:00:00.000Z');
  });

  it('falls out of armed when membership changes after the serve', async () => {
    const harness = makeHarness({
      served: { servedAt: '2026-09-16T10:00:00.000Z', hash: hashPeerIds([]) },
    });

    expect((await harness.service.peersState('a')).armed).toBe(true);

    await harness.service.connect('a', 'b');
    expect((await harness.service.peersState('a')).armed).toBe(false);
  });
});

describe('PeerService — telling our own agents apart from external ones (CLEAN-97)', () => {
  // Every one of these reaches this installation's card route; a string
  // prefix check let the last five through.
  it.each([
    ['the plain form', 'https://api.test/a2a/agents/b'],
    ['an upper-case host', 'https://API.Test/a2a/agents/b'],
    ['a doubled slash', 'https://api.test//a2a/agents/b'],
    ['a percent-encoded path', 'https://api.test/a2a/%61gents/b'],
    ['a trailing dot on the host', 'https://api.test./a2a/agents/b'],
    ['http instead of https', 'http://api.test/a2a/agents/b'],
    ['an upper-case path', 'https://api.test/A2A/Agents/b'],
  ])('refuses %s before any request goes out', async (_label, url) => {
    const { service, fetchCard, rows } = makeHarness();

    await expect(service.connectByUrl('a', url)).rejects.toMatchObject({
      response: { code: 'PEER_SELF_URL' },
    });
    expect(fetchCard).not.toHaveBeenCalled();
    expect(Object.keys(rows)).toHaveLength(0);
  });

  it('refuses a card read from another host that sends delegations back to us', async () => {
    // An alias of our host the address check cannot know about: the card it
    // serves is ours, and our card names our real base.
    const { service, rows } = makeHarness({
      externalCard: foreignCard('Rancher', [
        {
          url: 'https://api.test/a2a/agents/agent-rancher',
          protocolBinding: 'JSONRPC',
          protocolVersion: '1.0',
        },
      ]),
    });

    await expect(
      service.connectByUrl(
        'a',
        'https://alias.example/a2a/agents/agent-rancher',
      ),
    ).rejects.toMatchObject({ response: { code: 'PEER_SELF_URL' } });
    expect(Object.keys(rows)).toHaveLength(0);
  });

  it('still imports a genuinely external agent', async () => {
    const { service, rows } = makeHarness();

    await service.connectByUrl('a', 'https://other.example/a2a/agents/agent-x');

    expect(Object.keys(rows)).toHaveLength(1);
  });
});

describe('PeerService — the address inside the card (CLEAN-97)', () => {
  const EXT_BASE = 'https://other.example/a2a/agents/agent-x';

  it('refuses a card whose interface points at a private address, saving nothing', async () => {
    const { service, rows } = makeHarness({
      externalCard: foreignCard('Sneaky', [
        {
          url: 'http://127.0.0.1:9999',
          protocolBinding: 'JSONRPC',
          protocolVersion: '1.0',
        },
      ]),
    });

    await expect(service.connectByUrl('a', EXT_BASE)).rejects.toMatchObject({
      response: {
        code: 'PEER_URL_INVALID',
        message: expect.stringContaining('http://127.0.0.1:9999'),
      },
    });
    expect(Object.keys(rows)).toHaveLength(0);
  });

  it('applies the same refusal to a preview, so nothing looks importable that is not', async () => {
    const { service } = makeHarness({
      externalCard: foreignCard('Sneaky', [
        {
          url: 'http://169.254.169.254/latest',
          protocolBinding: 'JSONRPC',
          protocolVersion: '1.0',
        },
      ]),
    });

    await expect(service.previewByUrl('a', EXT_BASE)).rejects.toMatchObject({
      response: { code: 'PEER_URL_INVALID' },
    });
  });

  it('imports a card that prefers HTTP+JSON but also offers JSON-RPC', async () => {
    const { service, rows } = makeHarness({
      externalCard: foreignCard('Two Doors', [
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
    });

    await service.connectByUrl('a', EXT_BASE);

    expect(Object.keys(rows)).toHaveLength(1);
  });

  it('says plainly when a 1.0 agent offers no JSON-RPC at all', async () => {
    const { service, rows } = makeHarness({
      externalCard: foreignCard('REST Only', [
        {
          url: 'https://other.example/rest',
          protocolBinding: 'HTTP+JSON',
          protocolVersion: '1.0',
        },
      ]),
    });

    await expect(service.connectByUrl('a', EXT_BASE)).rejects.toMatchObject({
      response: {
        code: 'PEER_BINDING',
        message:
          'This agent offers A2A 1.0 only over HTTP+JSON; Ranch calls agents over JSON-RPC',
      },
    });
    expect(Object.keys(rows)).toHaveLength(0);
  });

  it('turns a pre-1.0 card into a version message, not "not a card"', async () => {
    const { service } = makeHarness({
      fetchCardThrows: new PeerCardUnreachableError(
        'This agent speaks A2A 0.3.0; only 1.0 is supported',
        200,
        'version',
      ),
    });

    await expect(service.connectByUrl('a', EXT_BASE)).rejects.toMatchObject({
      response: {
        code: 'PEER_VERSION',
        message: 'This agent speaks A2A 0.3.0; only 1.0 is supported',
      },
    });
  });
});

describe('PeerService — card URLs that are already JSON documents (CLEAN-97)', () => {
  it('keeps a pre-1.0 agent.json address as it is', async () => {
    const { service, fetchCard } = makeHarness();

    await service.connectByUrl(
      'a',
      'https://other.example/.well-known/agent.json',
    );

    expect(fetchCard).toHaveBeenLastCalledWith(
      'https://other.example/.well-known/agent.json',
      undefined,
    );
  });

  it('keeps a custom card path as it is', async () => {
    const { service, fetchCard } = makeHarness();

    await service.connectByUrl(
      'a',
      'https://other.example/a2a/agentverse/agent-card.json',
    );

    expect(fetchCard).toHaveBeenLastCalledWith(
      'https://other.example/a2a/agentverse/agent-card.json',
      undefined,
    );
  });

  it('still appends the well-known path to a bare base address', async () => {
    const { service, fetchCard } = makeHarness();

    await service.connectByUrl('a', 'https://other.example');

    expect(fetchCard).toHaveBeenLastCalledWith(
      'https://other.example/.well-known/agent-card.json',
      undefined,
    );
  });
});

describe('PeerService — refreshing holds a card to the import bar (CLEAN-97)', () => {
  const EXT_BASE = 'https://other.example/a2a/agents/agent-x';

  it('refuses a refreshed card that moved its interface somewhere private, keeping the old one', async () => {
    const { service, fetchCard, rows } = makeHarness();
    const imported = await service.connectByUrl('a', EXT_BASE);
    fetchCard.mockResolvedValueOnce(
      foreignCard('Foreign Bot', [
        {
          url: 'http://10.0.0.5/jsonrpc',
          protocolBinding: 'JSONRPC',
          protocolVersion: '1.0',
        },
      ]),
    );

    await expect(service.refresh('a', imported.id)).rejects.toMatchObject({
      response: { code: 'PEER_URL_INVALID' },
    });
    expect(Object.values(rows)[0].cardSnapshot.supportedInterfaces[0].url).toBe(
      'https://other.example/a2a/agents/agent-x',
    );
  });

  it('leaves internal peers alone: their card interface IS this installation', async () => {
    const { service } = makeHarness();
    const connected = await service.connect('a', 'b');

    await expect(service.refresh('a', connected.id)).resolves.toMatchObject({
      id: connected.id,
    });
  });
});
