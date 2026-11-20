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
import type { ICallerParty } from '#/user/auth/domain/auth.types';
import { UserRoleTypes } from '#/user/user/domain';
import type { IDelegationGateway } from './delegation.gateway';
import {
  ADMIN,
  GUEST,
  OWNER,
  TRUSTED,
  USER,
  peerAccessOver,
  type IPeerWorld,
} from './__fixtures__/peerAccess';

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
    agents?: Array<{
      id: string;
      name: string;
      status: string;
      isAdmin?: boolean;
    }>;
    fetchCardThrows?: Error;
    /** Card returned for external imports; defaults to a valid 1.0 card. */
    externalCard?: IA2aAgentCard;
    served?: { servedAt: string; hash: string } | null;
    /** Who is denied which agents, and the accounts names resolve to. */
    world?: IPeerWorld;
    /** Rows of the delegation history, newest first. */
    delegations?: Array<Record<string, any>>;
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
      async (agentId: string, cardUrl: string, ownerUserId: string | null) =>
        Object.values(rows).find(
          (r) =>
            r.agentId === agentId &&
            r.cardUrl === cardUrl &&
            r.origin === PeerOrigins.External &&
            r.ownerUserId === ownerUserId,
        ) ?? null,
    ),
    setVisitors: jest.fn(
      async (id: string, input: { open: boolean; byUserId: string | null }) => {
        Object.assign(rows[id], {
          openToVisitors: input.open,
          openedById: input.open ? input.byUserId : null,
          openedAt: input.open ? new Date(0).toISOString() : null,
          needsReview: false,
        });
        return rows[id];
      },
    ),
    recordPeersServed: jest.fn(async () => undefined),
    readPeersServed: jest.fn(async () => options.served ?? null),
    create: jest.fn(async (input: Record<string, any>) => {
      const id = `peer-${(seq += 1)}`;
      rows[id] = {
        id,
        // Column defaults of the CLEAN-236 migration.
        openToVisitors: false,
        openedById: null,
        openedAt: null,
        needsReview: false,
        ...input,
        createdById: input.createdById ?? null,
        ownerUserId: input.ownerUserId ?? null,
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

  const { access, permission, users } = peerAccessOver(
    agentGateway,
    options.world,
  );
  const delegations = {
    listRecent: jest.fn(async () => options.delegations ?? []),
  } as unknown as IDelegationGateway;

  const service = new PeerService(
    peers,
    agentGateway,
    cards,
    client,
    access,
    permission,
    delegations,
    users as never,
  );
  return { service, peers, rows, fetchCard, cards };
}

// Who the connection is made for. The specs that are not about access
// connect as the Owner, who reaches and manages every agent, so the party
// decides nothing there. A trusted party used to do for that; since
// CLEAN-236 nobody but a signed-in person changes a peer set.
const person = (role: UserRoleTypes): ICallerParty => ({
  kind: 'person',
  userId: 'user-1',
  role,
});

/**
 * The Ranch admin agent is the Owner's alone (CLEAN-232), and a connection
 * with it on either end is too. The rule is here, in the one function the
 * console route, the operator tool and the agent's own tool all call.
 */
describe('PeerService: a connection with the Ranch admin agent', () => {
  const agents = [
    { id: 'a', name: 'Caller', status: 'running' },
    { id: 'b', name: 'Support Bot', status: 'running' },
    { id: 'ranch', name: 'Ranch', status: 'running', isAdmin: true },
  ];
  const everybodyElse: Array<[string, ICallerParty]> = [
    ['a guest (an ordinary agent, whoever it speaks for)', GUEST],
    ['a User', person(UserRoleTypes.User)],
    ['an Admin', person(UserRoleTypes.Admin)],
    ['that agent acting for itself (a trusted party)', TRUSTED],
  ];
  const owners: Array<[string, ICallerParty]> = [
    ['the Owner', person(UserRoleTypes.Owner)],
  ];

  it.each(everybodyElse)(
    'is not found for %s, in either direction, and nothing is saved',
    async (_who, party) => {
      const { service, rows } = makeHarness({ agents });

      for (const [from, to] of [
        ['a', 'ranch'],
        ['ranch', 'a'],
      ]) {
        await expect(service.connect(from, to, party)).rejects.toMatchObject({
          status: 404,
          response: { code: 'PEER_NOT_FOUND', message: 'Agent not found' },
        });
      }
      expect(Object.keys(rows)).toHaveLength(0);
    },
  );

  it('answers exactly as it does for an agent that does not exist', async () => {
    const { service } = makeHarness({ agents });
    const answer = (to: string) =>
      service.connect('a', to, GUEST).then(
        () => null,
        (e: { status: number; response: unknown }) => ({
          status: e.status,
          response: e.response,
        }),
      );

    expect(await answer('ranch')).toEqual(await answer('ghost'));
  });

  it.each(owners)(
    'is made for %s, in either direction',
    async (_who, party) => {
      const { service, rows } = makeHarness({ agents });

      await service.connect('a', 'ranch', party);
      await service.connect('ranch', 'a', party);

      expect(Object.keys(rows)).toHaveLength(2);
    },
  );

  const people = everybodyElse.filter(([, party]) => party.kind === 'person');
  const nobody = everybodyElse.filter(([, party]) => party.kind !== 'person');

  it.each(people)(
    'leaves two ordinary agents to %s, as before',
    async (_who, party) => {
      const { service, rows } = makeHarness({ agents });

      await service.connect('a', 'b', party);

      expect(Object.keys(rows)).toHaveLength(1);
    },
  );

  // CLEAN-236: a turn with no signed-in person behind it changes no peers.
  it.each(nobody)('connects nothing at all for %s', async (_who, party) => {
    const { service, rows } = makeHarness({ agents });

    await expect(service.connect('a', 'b', party)).rejects.toMatchObject({
      status: 404,
      response: { code: 'PEER_NOT_FOUND', message: 'Agent not found' },
    });
    expect(Object.keys(rows)).toHaveLength(0);
  });

  it.each(people)(
    'does not offer the Ranch admin agent as a candidate to %s',
    async (_who, party) => {
      const { service } = makeHarness({ agents });

      const ids = (await service.candidates('a', party)).map((c) => c.id);

      expect(ids).toEqual(['b']);
    },
  );

  it.each(nobody)('names no agent at all to %s', async (_who, party) => {
    const { service } = makeHarness({ agents });

    expect(await service.candidates('a', party)).toEqual([]);
  });

  it.each(owners)('offers it to %s', async (_who, party) => {
    const { service } = makeHarness({ agents });

    const ids = (await service.candidates('a', party)).map((c) => c.id);

    expect(ids).toEqual(['b', 'ranch']);
  });
});

describe('PeerService.connect', () => {
  it('mints a credential of the documented shape', async () => {
    const { service, rows } = makeHarness();

    await service.connect('a', 'b', OWNER);

    const [row] = Object.values(rows);
    expect(row.token).toMatch(PEER_TOKEN_RE);
  });

  it('proves the credential works by reading the card with it', async () => {
    const { service, fetchCard, rows } = makeHarness();

    await service.connect('a', 'b', OWNER);

    const [row] = Object.values(rows);
    expect(fetchCard).toHaveBeenCalledWith(
      'https://api.test/a2a/agents/b/.well-known/agent-card.json',
      row.token,
    );
  });

  it('stores the card it read, with the time it read it', async () => {
    const { service } = makeHarness();

    const view = await service.connect('a', 'b', OWNER);

    expect(view.card.name).toBe('Support Bot');
    expect(view.cardReadAt).toEqual(expect.any(String));
    expect(view.peerName).toBe('Support Bot');
    expect(view.peerStatus).toBe('running');
  });

  it('leaves nothing behind when the card cannot be read', async () => {
    const { service, rows } = makeHarness({
      fetchCardThrows: new PeerCardUnreachableError('host is down'),
    });

    await expect(service.connect('a', 'b', OWNER)).rejects.toMatchObject({
      response: { code: 'PEER_CARD_UNREACHABLE' },
    });
    expect(Object.values(rows)).toHaveLength(0);
  });

  it('refuses to connect an agent to itself', async () => {
    const { service } = makeHarness();

    await expect(service.connect('a', 'a', OWNER)).rejects.toMatchObject({
      response: { code: 'PEER_SELF' },
    });
  });

  it('refuses a second connection to a peer it already holds', async () => {
    const { service } = makeHarness();
    await service.connect('a', 'b', OWNER);

    await expect(service.connect('a', 'b', OWNER)).rejects.toMatchObject({
      response: { code: 'PEER_EXISTS' },
    });
  });

  it('refuses a peer that does not exist', async () => {
    const { service } = makeHarness();

    await expect(service.connect('a', 'ghost', OWNER)).rejects.toMatchObject({
      response: { code: 'PEER_NOT_FOUND' },
    });
  });

  it('never lets the credential reach the caller', async () => {
    const { service } = makeHarness();

    const view = await service.connect('a', 'b', OWNER);

    expect(JSON.stringify(view)).not.toContain('ap_');
    expect(view).not.toHaveProperty('token');
  });

  it('leaves the opposite direction alone', async () => {
    const { service } = makeHarness();
    await service.connect('a', 'b', OWNER);

    await expect(service.list('b', OWNER)).resolves.toEqual([]);
  });
});

describe('PeerService.refresh', () => {
  it('replaces the snapshot with what the card says now', async () => {
    const { service, fetchCard } = makeHarness();
    const connected = await service.connect('a', 'b', OWNER);
    fetchCard.mockResolvedValue({
      ...card('Support Bot'),
      description: 'Now also handles refunds.',
    });

    const refreshed = await service.refresh('a', connected.id, OWNER);

    expect(refreshed.card.description).toBe('Now also handles refunds.');
  });

  it('keeps the old snapshot when the read fails, and says what failed', async () => {
    const { service, fetchCard } = makeHarness();
    const connected = await service.connect('a', 'b', OWNER);
    fetchCard.mockRejectedValue(
      new PeerCardUnreachableError('502 Bad Gateway'),
    );

    await expect(
      service.refresh('a', connected.id, OWNER),
    ).rejects.toMatchObject({
      response: { code: 'PEER_CARD_UNREACHABLE' },
    });
    const [still] = await service.list('a', OWNER);
    expect(still.card.description).toBe('Support Bot answers things');
  });

  it('refuses to refresh a connection that belongs to another agent', async () => {
    const { service } = makeHarness();
    const connected = await service.connect('a', 'b', OWNER);

    await expect(
      service.refresh('c', connected.id, OWNER),
    ).rejects.toMatchObject({
      response: { code: 'PEER_NOT_FOUND' },
    });
  });
});

describe('PeerService.remove', () => {
  it('kills the connection and with it the credential', async () => {
    const { service, peers, rows } = makeHarness();
    const connected = await service.connect('a', 'b', OWNER);
    const token = Object.values(rows)[0].token as string;

    await service.remove('a', connected.id, OWNER);

    await expect(peers.findByToken(token)).resolves.toBeNull();
    await expect(service.list('a', OWNER)).resolves.toEqual([]);
  });

  it('refuses to remove a connection that belongs to another agent', async () => {
    const { service } = makeHarness();
    const connected = await service.connect('a', 'b', OWNER);

    await expect(
      service.remove('c', connected.id, OWNER),
    ).rejects.toMatchObject({
      response: { code: 'PEER_NOT_FOUND' },
    });
  });
});

describe('PeerService.candidates', () => {
  it('offers every other agent and marks the ones already connected', async () => {
    const { service } = makeHarness();
    await service.connect('a', 'b', OWNER);

    const candidates = await service.candidates('a', OWNER);

    expect(candidates).toEqual([
      { id: 'b', name: 'Support Bot', status: 'running', connected: true },
      { id: 'c', name: 'Third', status: 'stopped', connected: false },
    ]);
  });

  it('never offers the agent itself', async () => {
    const { service } = makeHarness();

    const candidates = await service.candidates('a', OWNER);

    expect(candidates.map((c) => c.id)).not.toContain('a');
  });
});

describe('PeerService.list', () => {
  it('reports a peer whose agent has been deleted as gone', async () => {
    const { service, rows } = makeHarness();
    await service.connect('a', 'b', OWNER);
    // The FK cascade normally removes the row with the agent; this is the
    // remote-peer shape the view has to survive anyway.
    Object.values(rows)[0].peerAgentId = 'vanished';

    const [view] = await service.list('a', OWNER);

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

    await service.connectByUrl('a', EXT_BASE, undefined, OWNER);
    expect(fetchCard).toHaveBeenLastCalledWith(EXT_CARD, undefined);

    const { service: s2, fetchCard: f2 } = makeHarness();
    await s2.connectByUrl('a', EXT_CARD, undefined, OWNER);
    expect(f2).toHaveBeenLastCalledWith(EXT_CARD, undefined);

    expect(Object.values(rows)[0].cardUrl).toBe(EXT_CARD);
  });

  it('stores an external row: no pair token, no peer agent id', async () => {
    const { service, rows } = makeHarness();

    const view = await service.connectByUrl('a', EXT_BASE, 'tk-1', OWNER);

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

    const first = await service.connectByUrl('a', EXT_BASE, 'tk-1', OWNER);
    const second = await service.connectByUrl('a', EXT_CARD, 'tk-2', OWNER);

    expect(second.id).toBe(first.id);
    expect(Object.keys(rows)).toHaveLength(1);
    expect(Object.values(rows)[0].outboundToken).toBe('tk-2');
  });

  it('keeps the credential when omitted, clears it on empty string', async () => {
    const { service, rows } = makeHarness();

    await service.connectByUrl('a', EXT_BASE, 'tk-1', OWNER);
    await service.connectByUrl('a', EXT_BASE, undefined, OWNER);
    expect(Object.values(rows)[0].outboundToken).toBe('tk-1');

    await service.connectByUrl('a', EXT_BASE, '', OWNER);
    expect(Object.values(rows)[0].outboundToken).toBeNull();
  });

  it('refuses an address of this installation with PEER_SELF_URL', async () => {
    const { service, fetchCard } = makeHarness();

    await expect(
      service.connectByUrl(
        'a',
        'https://api.test/a2a/agents/b',
        undefined,
        OWNER,
      ),
    ).rejects.toMatchObject({ response: { code: 'PEER_SELF_URL' } });
    expect(fetchCard).not.toHaveBeenCalled();
  });

  it('rejects garbage and private addresses as PEER_URL_INVALID', async () => {
    const { service } = makeHarness();

    await expect(
      service.connectByUrl('a', 'not a url', undefined, OWNER),
    ).rejects.toMatchObject({
      response: { code: 'PEER_URL_INVALID' },
    });
    await expect(
      service.connectByUrl('a', 'ftp://other.example/x', undefined, OWNER),
    ).rejects.toMatchObject({ response: { code: 'PEER_URL_INVALID' } });
    // SSRF guard: loopback and RFC1918 hosts never get a request.
    await expect(
      service.connectByUrl(
        'a',
        'https://192.168.1.10/a2a/agents/x',
        undefined,
        OWNER,
      ),
    ).rejects.toMatchObject({ response: { code: 'PEER_URL_INVALID' } });
  });

  it('persists nothing when the card cannot be fetched', async () => {
    const { service, rows } = makeHarness({
      fetchCardThrows: new PeerCardUnreachableError('refused'),
    });

    await expect(
      service.connectByUrl('a', EXT_BASE, undefined, OWNER),
    ).rejects.toMatchObject({
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
      invalid.service.connectByUrl('a', EXT_BASE, undefined, OWNER),
    ).rejects.toMatchObject({ response: { code: 'PEER_URL_INVALID' } });
  });

  it('refuses a card speaking another protocol version', async () => {
    const externalCard = foreignCard();
    externalCard.supportedInterfaces[0].protocolVersion = '2.0';
    const { service, rows } = makeHarness({ externalCard });

    await expect(
      service.connectByUrl('a', EXT_BASE, undefined, OWNER),
    ).rejects.toMatchObject({
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

    const view = await service.connectByUrl('a', EXT_BASE, undefined, OWNER);

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
    const imported = await service.connectByUrl('a', EXT_BASE, 'tk-1', OWNER);

    await service.refresh('a', imported.id, OWNER);

    expect(fetchCard).toHaveBeenLastCalledWith(EXT_CARD, 'tk-1');
  });
});

describe('PeerService — armed state (CLEAN-95)', () => {
  it('is armed when the served hash matches the current peer set', async () => {
    const harness = makeHarness({ served: null });
    const view = await harness.service.connect('a', 'b', OWNER);
    const hash = hashPeerIds([view.id]);

    const cold = await harness.service.peersState('a');
    expect(cold).toEqual({ armed: false, servedAt: null });

    const warm = makeHarness({
      served: { servedAt: '2026-09-16T10:00:00.000Z', hash },
    });
    // Recreate the same single row so the hashes line up.
    const again = await warm.service.connect('a', 'b', OWNER);
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

    await harness.service.connect('a', 'b', OWNER);
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

    await expect(
      service.connectByUrl('a', url, undefined, OWNER),
    ).rejects.toMatchObject({
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
        undefined,
        OWNER,
      ),
    ).rejects.toMatchObject({ response: { code: 'PEER_SELF_URL' } });
    expect(Object.keys(rows)).toHaveLength(0);
  });

  it('still imports a genuinely external agent', async () => {
    const { service, rows } = makeHarness();

    await service.connectByUrl(
      'a',
      'https://other.example/a2a/agents/agent-x',
      undefined,
      OWNER,
    );

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

    await expect(
      service.connectByUrl('a', EXT_BASE, undefined, OWNER),
    ).rejects.toMatchObject({
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

    await service.connectByUrl('a', EXT_BASE, undefined, OWNER);

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

    await expect(
      service.connectByUrl('a', EXT_BASE, undefined, OWNER),
    ).rejects.toMatchObject({
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

    await expect(
      service.connectByUrl('a', EXT_BASE, undefined, OWNER),
    ).rejects.toMatchObject({
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
      undefined,
      OWNER,
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
      undefined,
      OWNER,
    );

    expect(fetchCard).toHaveBeenLastCalledWith(
      'https://other.example/a2a/agentverse/agent-card.json',
      undefined,
    );
  });

  it('still appends the well-known path to a bare base address', async () => {
    const { service, fetchCard } = makeHarness();

    await service.connectByUrl('a', 'https://other.example', undefined, OWNER);

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
    const imported = await service.connectByUrl(
      'a',
      EXT_BASE,
      undefined,
      OWNER,
    );
    fetchCard.mockResolvedValueOnce(
      foreignCard('Foreign Bot', [
        {
          url: 'http://10.0.0.5/jsonrpc',
          protocolBinding: 'JSONRPC',
          protocolVersion: '1.0',
        },
      ]),
    );

    await expect(
      service.refresh('a', imported.id, OWNER),
    ).rejects.toMatchObject({
      response: { code: 'PEER_URL_INVALID' },
    });
    expect(Object.values(rows)[0].cardSnapshot.supportedInterfaces[0].url).toBe(
      'https://other.example/a2a/agents/agent-x',
    );
  });

  it('leaves internal peers alone: their card interface IS this installation', async () => {
    const { service } = makeHarness();
    const connected = await service.connect('a', 'b', OWNER);

    await expect(
      service.refresh('a', connected.id, OWNER),
    ).resolves.toMatchObject({
      id: connected.id,
    });
  });
});

describe('PeerService — connecting from a card, not an address (CLEAN-116)', () => {
  const cardText = (extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      name: 'Pasted Bot',
      description: 'Answers care questions.',
      version: '1.0.0',
      supportedInterfaces: [
        {
          url: 'https://pasted.example/a2a',
          protocolBinding: 'JSONRPC',
          protocolVersion: '1.0',
        },
      ],
      capabilities: {},
      defaultInputModes: ['text/plain'],
      defaultOutputModes: ['text/plain'],
      skills: [
        { id: 's', name: 'Care search', description: 'Finds care', tags: [] },
      ],
      ...extra,
    });

  it('saves the peer and never fetches anything', async () => {
    const { service, rows, fetchCard } = makeHarness();

    const view = await service.connectByCard('a', cardText(), undefined, OWNER);

    expect(view.peerName).toBe('Pasted Bot');
    expect(fetchCard).not.toHaveBeenCalled();
    expect(Object.keys(rows)).toHaveLength(1);
  });

  it('identifies it by the address the card names, so a later URL import lands on the same row', async () => {
    const { service, rows } = makeHarness();

    const view = await service.connectByCard('a', cardText(), undefined, OWNER);

    expect(view.cardUrl).toBe(
      'https://pasted.example/a2a/.well-known/agent-card.json',
    );
    expect(Object.values(rows)[0].cardUrl).toBe(view.cardUrl);
  });

  it('updates in place when the same card is given twice', async () => {
    const { service, rows } = makeHarness();

    await service.connectByCard('a', cardText(), undefined, OWNER);
    await service.connectByCard(
      'a',
      cardText({ description: 'Now better.' }),
      undefined,
      OWNER,
    );

    expect(Object.keys(rows)).toHaveLength(1);
    expect(Object.values(rows)[0].cardSnapshot.description).toBe('Now better.');
  });

  it('reads YAML, which is how cards arrive from a repository', async () => {
    const { service } = makeHarness();
    const yaml = [
      'name: Yaml Bot',
      'description: From a config file.',
      'version: "1.0.0"',
      'supportedInterfaces:',
      '  - url: "https://yaml.example/a2a"',
      '    protocolBinding: JSONRPC',
      '    protocolVersion: "1.0"',
      'skills:',
      '  - id: s1',
      '    name: Ask',
      '    description: Answers',
      '    tags: []',
    ].join('\n');

    await expect(
      service.connectByCard('a', yaml, undefined, OWNER),
    ).resolves.toMatchObject({
      peerName: 'Yaml Bot',
    });
  });

  it('digs the card out of a config file that nests it under `card:`', async () => {
    const { service } = makeHarness();
    const yaml = [
      'card:',
      '  name: Nested Bot',
      '  description: The ALM shape.',
      '  url: "https://nested.example/a2a"',
      '  version: "1.0.0"',
      '  skills:',
      '    - id: s1',
      '      name: Ask',
      '      description: Answers',
      '      tags: []',
    ].join('\n');

    await expect(
      service.connectByCard('a', yaml, undefined, OWNER),
    ).resolves.toMatchObject({
      peerName: 'Nested Bot',
    });
  });

  it('accepts a card on the old dialect', async () => {
    const { service } = makeHarness();
    const legacy = JSON.stringify({
      protocolVersion: '0.3.0',
      name: 'Legacy Pasted',
      description: 'x',
      url: 'https://legacy.example/a2a',
      version: '1.0.0',
      skills: [],
    });

    await expect(
      service.connectByCard('a', legacy, undefined, OWNER),
    ).resolves.toMatchObject({
      peerName: 'Legacy Pasted',
    });
  });

  it('refuses a card whose address is private — the upload does not make an agent reachable', async () => {
    const { service, rows } = makeHarness();
    const local = cardText({
      supportedInterfaces: [
        {
          url: 'http://localhost:9999/',
          protocolBinding: 'JSONRPC',
          protocolVersion: '1.0',
        },
      ],
    });

    await expect(
      service.connectByCard('a', local, undefined, OWNER),
    ).rejects.toMatchObject({
      response: { code: 'PEER_URL_INVALID' },
    });
    expect(Object.keys(rows)).toHaveLength(0);
  });

  it('refuses a card that points back at this installation', async () => {
    const { service } = makeHarness();
    const own = cardText({
      supportedInterfaces: [
        {
          url: 'https://api.test/a2a/agents/b',
          protocolBinding: 'JSONRPC',
          protocolVersion: '1.0',
        },
      ],
    });

    await expect(
      service.connectByCard('a', own, undefined, OWNER),
    ).rejects.toMatchObject({
      response: { code: 'PEER_SELF_URL' },
    });
  });

  it.each([
    ['empty text', '   '],
    ['prose', 'here is the agent, please connect it'],
    ['JSON that is not a card', '{"hello":"world"}'],
  ])('says plainly that %s is not a card', async (_label, text) => {
    const { service } = makeHarness();

    await expect(
      service.connectByCard('a', text, undefined, OWNER),
    ).rejects.toMatchObject({
      response: { code: 'PEER_BODY' },
    });
  });

  it('previews without saving', async () => {
    const { service, rows } = makeHarness();

    const card = await service.previewCard('a', cardText());

    expect(card.name).toBe('Pasted Bot');
    expect(Object.keys(rows)).toHaveLength(0);
  });
});

/**
 * CLEAN-236. A connection A→B exists for a person only when they reach B.
 * `peerAccess.spec.ts` pins the rule; these cases pin that every way into
 * the service asks it, and that what does not exist for somebody answers
 * exactly as what does not exist at all.
 *
 * The cast: `a` asks, `b` and `c` are asked. The Admin manages `a` and is
 * denied `b`. The User reaches everything and manages nothing.
 */
describe('PeerService: a connection exists for a person only when they reach the peer', () => {
  const world: IPeerWorld = { denied: { 'user-admin': ['b'] } };

  const answerOf = (attempt: Promise<unknown>) =>
    attempt.then(
      () => 'done',
      (e: { status: number; response: unknown }) => ({
        status: e.status,
        response: e.response,
      }),
    );

  async function connected(options: Parameters<typeof makeHarness>[0] = {}) {
    const harness = makeHarness({ world, ...options });
    const toB = await harness.service.connect('a', 'b', OWNER);
    const toC = await harness.service.connect('a', 'c', OWNER);
    return { ...harness, toB, toC };
  }

  describe('seeing', () => {
    it('lists the peer for whoever reaches it, and leaves no trace of it for whoever does not', async () => {
      const { service } = await connected();

      expect(
        (await service.list('a', OWNER)).map((v) => v.peerAgentId),
      ).toEqual(['b', 'c']);
      const forAdmin = await service.list('a', ADMIN);
      expect(forAdmin.map((v) => v.peerAgentId)).toEqual(['c']);
      // The harness serves one card for every agent, so the name proves
      // nothing here; the id and the address of `b` do.
      expect(JSON.stringify(forAdmin)).not.toMatch(/agents\/b\/|"b"/);
    });

    it('lists nothing for nobody: a guest, the agent for itself', async () => {
      const { service } = await connected();

      expect(await service.list('a', GUEST)).toEqual([]);
      expect(await service.list('a', TRUSTED)).toEqual([]);
    });

    it('open to visitors: listed without name, id, address or status for whoever does not reach it', async () => {
      const { service, toB } = await connected();
      await service.setVisitors('a', toB.id, true, OWNER);

      const [masked] = (await service.list('a', ADMIN)).filter(
        (v) => v.id === toB.id,
      );
      expect(masked).toMatchObject({
        id: toB.id,
        visibility: 'masked',
        peerAgentId: null,
        peerName: 'A colleague',
        peerStatus: 'hidden',
        cardUrl: '',
        createdBy: null,
        openToVisitors: true,
        canRemove: false,
        canSetVisitors: false,
      });
      // What it can do stays: the asking model cannot choose without it.
      expect(masked.card.skills.map((skill) => skill.name)).toEqual(['Orders']);
      expect(masked.card.description).toBe('');
      expect(JSON.stringify(masked)).not.toMatch(/Support Bot|agents\/b|"b"/);

      // And for a caller nobody is signed in behind.
      expect((await service.list('a', GUEST)).map((v) => v.visibility)).toEqual(
        ['masked'],
      );
    });

    it('never hands the pair credential to anybody, masked or not', async () => {
      const { service, toB, rows } = await connected();
      await service.setVisitors('a', toB.id, true, OWNER);

      const token = rows[toB.id].token as string;
      for (const party of [OWNER, ADMIN, USER, GUEST]) {
        expect(JSON.stringify(await service.list('a', party))).not.toContain(
          token,
        );
      }
    });
  });

  describe('the hand-over history', () => {
    const history = (toB: { id: string }, toC: { id: string }) => [
      {
        id: 'd-3',
        agentId: 'a',
        peerId: null,
        peerAgentId: null,
        peerName: 'Outside Bot',
        task: 't3',
        excerpt: 'from outside',
      },
      {
        id: 'd-2',
        agentId: 'a',
        peerId: toC.id,
        peerAgentId: 'c',
        peerName: 'Third',
        task: 't2',
        excerpt: 'from c',
      },
      {
        id: 'd-1',
        agentId: 'a',
        peerId: toB.id,
        peerAgentId: 'b',
        peerName: 'Support Bot',
        task: 't1',
        excerpt: 'from b',
      },
    ];

    async function withHistory() {
      const delegations: Array<Record<string, any>> = [];
      const harness = await connected({ delegations });
      delegations.push(...history(harness.toB, harness.toC));
      return harness;
    }

    it('shows the Owner every row, the outside one whose connection is gone included', async () => {
      const { service } = await withHistory();

      const rows = await service.recentDelegations('a', OWNER, 20);
      expect(rows.map((r) => r.id)).toEqual(['d-3', 'd-2', 'd-1']);
    });

    it('leaves out what was handed to a peer the viewer does not reach', async () => {
      const { service } = await withHistory();

      const rows = await service.recentDelegations('a', ADMIN, 20);
      expect(rows.map((r) => r.id)).toEqual(['d-2']);
      expect(JSON.stringify(rows)).not.toMatch(/Support Bot|from b/);
    });

    it('through a connection open to visitors: the task, without the peer and without its answer', async () => {
      const { service, toB } = await withHistory();
      await service.setVisitors('a', toB.id, true, OWNER);

      const row = (await service.recentDelegations('a', ADMIN, 20)).find(
        (r) => r.id === 'd-1',
      );
      expect(row).toMatchObject({
        task: 't1',
        peerName: 'A colleague',
        peerAgentId: null,
        excerpt: null,
      });
    });

    it('once the connection is gone, a row is shown by reach on the agent it went to', async () => {
      const { service, toB, toC } = await withHistory();
      await service.remove('a', toB.id, OWNER);
      await service.remove('a', toC.id, OWNER);

      const ids = (r: Array<{ id: string }>) => r.map((row) => row.id);
      // The harness keeps `peerId` on the rows; the connections are gone.
      expect(ids(await service.recentDelegations('a', ADMIN, 20))).toEqual([
        'd-2',
      ]);
      expect(ids(await service.recentDelegations('a', USER, 20))).toEqual([
        'd-2',
        'd-1',
      ]);
    });
  });

  describe('changing', () => {
    it('removing or re-reading a connection that does not exist for the caller answers as a missing one', async () => {
      const { service, toB, rows } = await connected();

      for (const act of [
        (id: string) => service.remove('a', id, ADMIN),
        (id: string) => service.refresh('a', id, ADMIN),
        (id: string) => service.setVisitors('a', id, true, ADMIN),
      ]) {
        const hidden = await answerOf(act(toB.id));
        expect(hidden).toEqual(await answerOf(act('peer-does-not-exist')));
        expect(hidden).toMatchObject({
          status: 404,
          response: { code: 'PEER_NOT_FOUND' },
        });
      }
      expect(rows[toB.id]).toBeDefined();
    });

    it('whoever manages the agent and reaches the peer removes it', async () => {
      const { service, toC, rows } = await connected();

      await service.remove('a', toC.id, ADMIN);
      expect(rows[toC.id]).toBeUndefined();
    });

    it('whoever reaches the peer and does not manage the agent is shown it, and may not remove or re-read it', async () => {
      const { service, toB, rows } = await connected();

      const [view] = (await service.list('a', USER)).filter(
        (v) => v.id === toB.id,
      );
      expect(view).toMatchObject({ visibility: 'full', canRemove: false });

      for (const attempt of [
        service.remove('a', toB.id, USER),
        service.refresh('a', toB.id, USER),
      ]) {
        await expect(attempt).rejects.toMatchObject({
          status: 403,
          response: { code: 'PEER_FORBIDDEN' },
        });
      }
      expect(rows[toB.id]).toBeDefined();
    });

    it('whoever made a connection removes it, without managing the agent', async () => {
      const harness = makeHarness({ world });
      const mine = await harness.service.connect('a', 'b', USER);

      expect(mine).toMatchObject({
        createdBy: { id: 'user-user', name: 'Uma User' },
        canRemove: true,
      });
      await harness.service.remove('a', mine.id, USER);
      expect(harness.rows[mine.id]).toBeUndefined();
    });

    it('nobody removes anything: a guest, the agent for itself', async () => {
      const { service, toB, rows } = await connected();
      await service.setVisitors('a', toB.id, true, OWNER);

      for (const party of [GUEST, TRUSTED]) {
        await expect(service.remove('a', toB.id, party)).rejects.toMatchObject({
          status: 403,
        });
      }
      expect(rows[toB.id]).toBeDefined();
    });

    it('somebody who manages the agent and sees the peer masked may not remove it', async () => {
      const { service, toB, rows } = await connected();
      await service.setVisitors('a', toB.id, true, OWNER);

      await expect(service.remove('a', toB.id, ADMIN)).rejects.toMatchObject({
        status: 403,
        response: { code: 'PEER_FORBIDDEN' },
      });
      expect(rows[toB.id]).toBeDefined();
    });
  });

  describe('connecting', () => {
    it('offers a person the agents they reach, and no others', async () => {
      const { service } = makeHarness({ world });

      const ids = async (party: ICallerParty) =>
        (await service.candidates('a', party)).map((c) => c.id);
      expect(await ids(OWNER)).toEqual(['b', 'c']);
      expect(await ids(USER)).toEqual(['b', 'c']);
      expect(await ids(ADMIN)).toEqual(['c']);
    });

    it('refuses an agent the person does not reach exactly as one that does not exist', async () => {
      const { service, rows } = makeHarness({ world });

      const hidden = await answerOf(service.connect('a', 'b', ADMIN));
      expect(hidden).toEqual(
        await answerOf(service.connect('a', 'ghost', ADMIN)),
      );
      expect(hidden).toMatchObject({
        status: 404,
        response: { code: 'PEER_NOT_FOUND', message: 'Agent not found' },
      });
      expect(Object.keys(rows)).toHaveLength(0);

      // The same for the card of that agent, before connecting.
      expect(await answerOf(service.previewAgent('a', 'b', ADMIN))).toEqual(
        await answerOf(service.previewAgent('a', 'ghost', ADMIN)),
      );
    });

    it('needs reach, not management: a User connects an agent they reach', async () => {
      const { service } = makeHarness({ world });

      const view = await service.connect('a', 'b', USER);
      expect(view).toMatchObject({
        peerAgentId: 'b',
        openToVisitors: false,
        createdBy: { id: 'user-user', name: 'Uma User' },
      });
    });

    it('a connection one person made is there for another who reaches the peer, and not for one who does not', async () => {
      const { service } = makeHarness({ world });
      await service.connect('a', 'b', USER);

      expect(await service.list('a', OWNER)).toHaveLength(1);
      expect(await service.list('a', ADMIN)).toEqual([]);
    });
  });

  describe('opening to visitors', () => {
    it('takes a person who manages both agents', async () => {
      const { service, toC, rows } = await connected();

      const opened = await service.setVisitors('a', toC.id, true, ADMIN);
      expect(opened).toMatchObject({ openToVisitors: true });
      expect(rows[toC.id]).toMatchObject({
        openToVisitors: true,
        openedById: 'user-admin',
      });

      await service.setVisitors('a', toC.id, false, ADMIN);
      expect(rows[toC.id]).toMatchObject({
        openToVisitors: false,
        openedById: null,
      });
    });

    it('is not for somebody who only reaches the peer, nor for nobody', async () => {
      const { service, toC, rows } = await connected();

      for (const party of [USER, GUEST, TRUSTED]) {
        await expect(
          service.setVisitors('a', toC.id, true, party),
        ).rejects.toMatchObject({ status: 404 });
      }
      expect(rows[toC.id].openToVisitors).toBe(false);
    });

    it('says who may: the one who manages both, on the view', async () => {
      const { service, toC } = await connected();

      const viewFor = async (party: ICallerParty) =>
        (await service.list('a', party)).find((v) => v.id === toC.id);
      expect((await viewFor(OWNER))?.canSetVisitors).toBe(true);
      expect((await viewFor(ADMIN))?.canSetVisitors).toBe(true);
      expect((await viewFor(USER))?.canSetVisitors).toBe(false);
    });

    it('is not for a peer outside the Ranch', async () => {
      const { service, rows } = makeHarness({ world });
      const outside = await service.connectByUrl(
        'a',
        'https://other.example/a2a/agents/agent-x',
        undefined,
        OWNER,
      );

      await expect(
        service.setVisitors('a', outside.id, true, OWNER),
      ).rejects.toMatchObject({ status: 404 });
      expect(rows[outside.id].openToVisitors).toBe(false);
      expect(outside.canSetVisitors).toBe(false);
    });

    it('clears the review mark a migrated connection carries', async () => {
      const { service, toC, rows } = await connected();
      rows[toC.id].needsReview = true;
      rows[toC.id].openToVisitors = true;

      expect((await service.list('a', OWNER))[1].needsReview).toBe(true);
      await service.setVisitors('a', toC.id, true, OWNER);
      expect(rows[toC.id].needsReview).toBe(false);
    });
  });

  describe('a peer outside the Ranch', () => {
    const URL = 'https://other.example/a2a/agents/agent-x';

    it('added by somebody who manages the agent: one shared connection, for everybody', async () => {
      const { service, rows } = makeHarness({ world });

      const view = await service.connectByUrl('a', URL, undefined, ADMIN);
      expect(view).toMatchObject({
        owner: null,
        createdBy: { id: 'user-admin', name: 'Adam Admin' },
      });
      expect(rows[view.id].ownerUserId).toBeNull();
      for (const party of [OWNER, USER, GUEST]) {
        expect(await service.list('a', party)).toHaveLength(1);
      }
    });

    it('added by anybody else: their own, shown to them and to whoever manages the agent', async () => {
      const { service, rows } = makeHarness({ world });

      const mine = await service.connectByUrl('a', URL, undefined, USER);
      expect(mine).toMatchObject({
        owner: { id: 'user-user', name: 'Uma User' },
        canRemove: true,
      });
      expect(rows[mine.id].ownerUserId).toBe('user-user');

      expect(await service.list('a', USER)).toHaveLength(1);
      // Whoever manages the agent sees what is attached to it and can remove it.
      const [forAdmin] = await service.list('a', ADMIN);
      expect(forAdmin).toMatchObject({ canRemove: true });
      // Nobody else is told it exists.
      expect(await service.list('a', GUEST)).toEqual([]);
      expect(
        await service.list('a', {
          kind: 'person',
          userId: 'user-other',
          role: UserRoleTypes.User,
        }),
      ).toEqual([]);
    });

    it('the same address can be one person’s own, another’s, and shared: three connections', async () => {
      const { service, rows } = makeHarness({ world });
      const other: ICallerParty = {
        kind: 'person',
        userId: 'user-other',
        role: UserRoleTypes.User,
      };

      await service.connectByUrl('a', URL, undefined, USER);
      await service.connectByUrl('a', URL, undefined, other);
      await service.connectByUrl('a', URL, undefined, OWNER);
      // Giving the same address again updates one's own, never another's.
      await service.connectByUrl('a', URL, 'tk-2', USER);

      expect(Object.values(rows).map((r) => r.ownerUserId)).toEqual([
        'user-user',
        'user-other',
        null,
      ]);
      expect(Object.values(rows)[0].outboundToken).toBe('tk-2');
      expect(Object.values(rows)[2].outboundToken).toBeNull();
    });

    it('a pasted card follows the same two audiences', async () => {
      const { service, rows } = makeHarness({ world });
      const text = JSON.stringify(foreignCard());

      const shared = await service.connectByCard('a', text, undefined, OWNER);
      const mine = await service.connectByCard('a', text, undefined, USER);

      expect(rows[shared.id].ownerUserId).toBeNull();
      expect(rows[mine.id].ownerUserId).toBe('user-user');
    });

    it('nobody but a signed-in person adds one', async () => {
      const { service, rows, fetchCard } = makeHarness({ world });

      for (const party of [GUEST, TRUSTED]) {
        await expect(
          service.connectByUrl('a', URL, undefined, party),
        ).rejects.toMatchObject({
          status: 403,
          message: 'This needs a signed-in person.',
        });
        await expect(
          service.connectByCard(
            'a',
            JSON.stringify(foreignCard()),
            undefined,
            party,
          ),
        ).rejects.toMatchObject({ status: 403 });
      }
      expect(Object.keys(rows)).toHaveLength(0);
      // Refused before any address was fetched.
      expect(fetchCard).not.toHaveBeenCalled();
    });

    it('refuses an address of this Ranch the same way whether or not it names an agent', async () => {
      const { service } = makeHarness({ world });

      const existing = await answerOf(
        service.connectByUrl(
          'a',
          'https://api.test/a2a/agents/b',
          undefined,
          USER,
        ),
      );
      const missing = await answerOf(
        service.connectByUrl(
          'a',
          'https://api.test/a2a/agents/agent-that-is-not-there',
          undefined,
          USER,
        ),
      );
      expect(existing).toEqual(missing);
      expect(existing).toMatchObject({
        status: 400,
        response: { code: 'PEER_SELF_URL' },
      });
    });
  });

  describe('who made it', () => {
    it('says "predates the record" by saying nobody, for a row made before it was kept', async () => {
      const { service, toB, rows } = await connected();
      rows[toB.id].createdById = null;

      const [view] = await service.list('a', OWNER);
      expect(view.createdBy).toBeNull();
    });

    it('keeps the id and loses the name once the account is gone', async () => {
      const { service, toB, rows } = await connected();
      rows[toB.id].createdById = 'user-gone';

      const [view] = await service.list('a', OWNER);
      expect(view.createdBy).toEqual({ id: 'user-gone', name: null });
    });
  });
});
