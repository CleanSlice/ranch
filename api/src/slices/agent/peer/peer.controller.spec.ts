/* eslint-disable @typescript-eslint/unbound-method --
 * Nest's Reflector reads metadata off the method reference itself, so
 * `Controller.prototype.handler` is the argument it wants; nothing is ever
 * called detached. Same pattern as shareLink.controller.spec.
 */
import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PeerController } from './peer.controller';
import { ConnectPeerDto, ListDelegationsQueryDto } from './dtos';
import { JwtAuthGuard, RolesGuard } from '#/user/auth/guards';
import { ROLES_METADATA_KEY } from '#/user/auth/guards/roles.decorator';
import { UserRoleTypes } from '#/user/user/domain';
import type { PeerService } from './domain/peer.service';
import type { AgentCardService } from './domain/agentCard.service';
import type { IDelegationGateway } from './domain/delegation.gateway';

/**
 * The operator-facing routes. Two things are worth a test here and the rest is
 * delegation: that the access rules are actually attached (a peers list is a
 * map of what an installation can do, and connecting one grants a credential),
 * and that the pair credential cannot escape through a response — the service
 * strips it, and this proves the controller does not put it back.
 */
function makeController(options: { peers?: Partial<PeerService> } = {}) {
  const poisoned = {
    id: 'peer-1',
    agentId: 'a',
    peerAgentId: 'b',
    origin: 'internal',
    peerName: 'Support Bot',
    peerStatus: 'running',
    peerExists: true,
    card: { name: 'Support Bot', skills: [] },
    cardUrl: 'https://api.test/a2a/agents/b/.well-known/agent-card.json',
    cardReadAt: '2026-09-14T10:00:00.000Z',
    createdAt: '2026-09-14T10:00:00.000Z',
    // Not part of the DTO. Present here on purpose: if a route ever spreads
    // the row instead of the view, this is what leaks.
    token: 'ap_' + 'x'.repeat(43),
    // Same trap for the external credential (CLEAN-95).
    outboundToken: 'EXT_SECRET_bearer',
  };

  // Raw mocks first, cast only where the constructor needs a type. Reading a
  // method off a casted interface is what @typescript-eslint/unbound-method
  // objects to, and the assertions below all read these.
  const peerMocks = {
    list: jest.fn(async () => [poisoned]),
    candidates: jest.fn(async () => [
      { id: 'b', name: 'Support Bot', status: 'running', connected: true },
    ]),
    connect: jest.fn(async () => poisoned),
    connectByUrl: jest.fn(async () => ({ ...poisoned, origin: 'external' })),
    connectByCard: jest.fn(async () => ({ ...poisoned, origin: 'external' })),
    previewByUrl: jest.fn(async () => ({ name: 'Foreign Bot', skills: [] })),
    previewCard: jest.fn(async () => ({ name: 'Pasted Bot', skills: [] })),
    peersState: jest.fn(async () => ({ armed: false, servedAt: null })),
    refresh: jest.fn(async () => poisoned),
    remove: jest.fn(async () => undefined),
    ...options.peers,
  };

  const cardMocks = {
    build: jest.fn(async () => ({ name: 'Support Bot', skills: [] })),
  };

  const delegationMocks = {
    listRecent: jest.fn(async () => []),
  };

  return {
    controller: new PeerController(
      peerMocks as unknown as PeerService,
      cardMocks as unknown as AgentCardService,
      delegationMocks as unknown as IDelegationGateway,
    ),
    peers: peerMocks,
    cards: cardMocks,
    delegations: delegationMocks,
  };
}

describe('PeerController — access', () => {
  const reflector = new Reflector();

  it('is behind the console guards', () => {
    expect(reflector.get(GUARDS_METADATA, PeerController)).toEqual([
      JwtAuthGuard,
      RolesGuard,
    ]);
  });

  it('admits owners and admins only — never an agent runtime', () => {
    const roles = reflector.get(ROLES_METADATA_KEY, PeerController);

    expect(roles).toEqual([UserRoleTypes.Owner, UserRoleTypes.Admin]);
    expect(roles).not.toContain(UserRoleTypes.Agent);
    expect(roles).not.toContain(UserRoleTypes.User);
  });

  it('answers a disconnect with no content', () => {
    expect(
      reflector.get(HTTP_CODE_METADATA, PeerController.prototype.remove),
    ).toBe(204);
  });
});

describe('PeerController — routes', () => {
  it('lists peers without ever exposing the pair credential', async () => {
    const { controller } = makeController();

    const listed = await controller.list('a');

    expect(JSON.stringify(listed)).not.toContain('ap_');
  });

  it('connects a peer and hands back the connection, credential stripped', async () => {
    const { controller, peers } = makeController();

    const created = await controller.connect('a', { peerAgentId: 'b' });

    expect(peers.connect).toHaveBeenCalledWith('a', 'b');
    expect(JSON.stringify(created)).not.toContain('ap_');
    expect(JSON.stringify(created)).not.toContain('EXT_SECRET');
  });

  it('routes an url body to the import path, with the optional credential', async () => {
    const { controller, peers } = makeController();

    const imported = await controller.connect('a', {
      url: 'https://other.example/a2a/agents/x',
      token: 'tk',
    });

    expect(peers.connectByUrl).toHaveBeenCalledWith(
      'a',
      'https://other.example/a2a/agents/x',
      'tk',
    );
    expect(peers.connect).not.toHaveBeenCalled();
    expect(JSON.stringify(imported)).not.toContain('EXT_SECRET');
    expect(JSON.stringify(imported)).not.toContain('ap_');
  });

  it('refuses a body with more or fewer than one of id, url and card, as PEER_BODY', async () => {
    const { controller, peers } = makeController();

    await expect(controller.connect('a', {})).rejects.toMatchObject({
      response: { code: 'PEER_BODY' },
    });
    await expect(
      controller.connect('a', {
        peerAgentId: 'b',
        url: 'https://other.example/a2a/agents/x',
      }),
    ).rejects.toMatchObject({ response: { code: 'PEER_BODY' } });
    await expect(
      controller.connect('a', {
        url: 'https://other.example/a2a/agents/x',
        card: '{"name":"x"}',
      }),
    ).rejects.toMatchObject({ response: { code: 'PEER_BODY' } });
    expect(peers.connect).not.toHaveBeenCalled();
    expect(peers.connectByUrl).not.toHaveBeenCalled();
    expect(peers.connectByCard).not.toHaveBeenCalled();
  });

  it('connects from a pasted card without going near the address paths (CLEAN-116)', async () => {
    const { controller, peers } = makeController();

    await controller.connect('a', {
      card: '{"name":"Pasted Bot"}',
      token: 'tk',
    });

    expect(peers.connectByCard).toHaveBeenCalledWith(
      'a',
      '{"name":"Pasted Bot"}',
      'tk',
    );
    expect(peers.connectByUrl).not.toHaveBeenCalled();
  });

  it('previews a pasted card, and refuses a preview naming both ways in', async () => {
    const { controller, peers } = makeController();

    await controller.previewPeerUrl('a', { card: '{"name":"Pasted Bot"}' });
    expect(peers.previewCard).toHaveBeenCalledWith(
      'a',
      '{"name":"Pasted Bot"}',
    );

    await expect(
      controller.previewPeerUrl('a', {
        url: 'https://other.example/a2a/agents/x',
        card: '{"name":"x"}',
      }),
    ).rejects.toMatchObject({ response: { code: 'PEER_BODY' } });
  });

  it('previews an external card without touching the connect paths', async () => {
    const { controller, peers } = makeController();

    await controller.previewPeerUrl('a', {
      url: 'https://other.example/a2a/agents/x',
      token: 'tk',
    });

    expect(peers.previewByUrl).toHaveBeenCalledWith(
      'a',
      'https://other.example/a2a/agents/x',
      'tk',
    );
    expect(peers.connect).not.toHaveBeenCalled();
    expect(peers.connectByUrl).not.toHaveBeenCalled();
  });

  it('reports the armed state the service computed', async () => {
    const { controller, peers } = makeController();

    const state = await controller.peersState('a');

    expect(peers.peersState).toHaveBeenCalledWith('a');
    expect(state).toEqual({ armed: false, servedAt: null });
  });

  it('refreshes and removes the connection the path names', async () => {
    const { controller, peers } = makeController();

    await controller.refresh('a', 'peer-1');
    await controller.remove('a', 'peer-1');

    expect(peers.refresh).toHaveBeenCalledWith('a', 'peer-1');
    expect(peers.remove).toHaveBeenCalledWith('a', 'peer-1');
  });

  it('builds the card fresh on every read', async () => {
    const { controller, cards } = makeController();

    await controller.card('a');

    expect(cards.build).toHaveBeenCalledWith('a');
  });

  it('lists the candidates for the agent asked about', async () => {
    const { controller, peers } = makeController();

    await controller.candidates('a');

    expect(peers.candidates).toHaveBeenCalledWith('a');
  });

  it('reads recent delegations with the default limit when none is given', async () => {
    const { controller, delegations } = makeController();

    await controller.recentDelegations('a', {});

    expect(delegations.listRecent).toHaveBeenCalledWith('a', 20);
  });

  it('honours a requested limit', async () => {
    const { controller, delegations } = makeController();

    await controller.recentDelegations('a', { limit: 5 });

    expect(delegations.listRecent).toHaveBeenCalledWith('a', 5);
  });
});

describe('PeerController — request validation', () => {
  it('requires a peer id in the agent-<uuid> shape', async () => {
    const bareUuid = plainToInstance(ConnectPeerDto, {
      peerAgentId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    });
    const garbage = plainToInstance(ConnectPeerDto, {
      peerAgentId: 'not-a-uuid',
    });
    const good = plainToInstance(ConnectPeerDto, {
      peerAgentId: 'agent-3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    });

    expect(await validate(bareUuid)).toHaveLength(1);
    expect(await validate(garbage)).toHaveLength(1);
    expect(await validate(good)).toHaveLength(0);
  });

  it('accepts an url body, with and without a credential', async () => {
    const plain = plainToInstance(ConnectPeerDto, {
      url: 'https://other.example/a2a/agents/x',
    });
    const withToken = plainToInstance(ConnectPeerDto, {
      url: 'https://other.example/a2a/agents/x',
      token: 'tk',
    });

    expect(await validate(plain)).toHaveLength(0);
    expect(await validate(withToken)).toHaveLength(0);
  });

  it('bounds the delegation limit', async () => {
    const tooMany = plainToInstance(ListDelegationsQueryDto, { limit: 1000 });
    const zero = plainToInstance(ListDelegationsQueryDto, { limit: 0 });
    const ok = plainToInstance(ListDelegationsQueryDto, { limit: '25' });

    expect(await validate(tooMany)).toHaveLength(1);
    expect(await validate(zero)).toHaveLength(1);
    expect(await validate(ok)).toHaveLength(0);
    expect(ok.limit).toBe(25);
  });
});
