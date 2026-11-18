/* eslint-disable @typescript-eslint/unbound-method --
 * Reflector reads metadata off the method reference; nothing is called
 * detached. Same pattern as peer.controller.spec.
 */
import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { PeerLinkController } from './peerLink.controller';
import { JwtAuthGuard, RolesGuard } from '#/user/auth/guards';
import { ROLES_METADATA_KEY } from '#/user/auth/guards/roles.decorator';
import { UserRoleTypes } from '#/user/user/domain';
import type { IPeerGateway } from './domain/peer.gateway';
import type { Request } from 'express';
import {
  ADMIN,
  accessHarness,
  openAccess,
} from '#/user/agentAccess/domain/__fixtures__/agentAccess';

/**
 * The fleet map of who can ask whom. Two things matter: the route is behind
 * the operator roles, and a row that carries the pair credential cannot leak
 * it, because the response is rebuilt from two fields.
 */
describe('PeerLinkController', () => {
  it('is behind the JWT and the Owner / Admin roles', () => {
    const reflector = new Reflector();
    const guards = reflector.get<unknown[]>(
      GUARDS_METADATA,
      PeerLinkController,
    );
    expect(guards).toEqual([JwtAuthGuard, RolesGuard]);
    expect(reflector.get(ROLES_METADATA_KEY, PeerLinkController)).toEqual([
      UserRoleTypes.Owner,
      UserRoleTypes.Admin,
    ]);
  });

  it('returns the pairs and nothing else from the row', async () => {
    const listInternalLinks = jest.fn().mockResolvedValue([
      {
        agentId: 'a',
        peerAgentId: 'b',
        // Not part of the contract: present to prove it is not passed on.
        token: 'ap_' + 'x'.repeat(43),
        cardUrl: 'https://api.test/a2a/agents/b/.well-known/agent-card.json',
      },
      { agentId: 'b', peerAgentId: 'c' },
    ]);
    const controller = new PeerLinkController(
      {
        listInternalLinks,
      } as unknown as IPeerGateway,
      openAccess(),
    );

    const out = await controller.list();

    expect(out).toEqual([
      { agentId: 'a', peerAgentId: 'b' },
      { agentId: 'b', peerAgentId: 'c' },
    ]);
    expect(JSON.stringify(out)).not.toContain('ap_');
    expect(JSON.stringify(out)).not.toContain('agent-card');
  });

  it('an installation without connections answers with an empty list', async () => {
    const controller = new PeerLinkController(
      {
        listInternalLinks: jest.fn().mockResolvedValue([]),
      } as unknown as IPeerGateway,
      openAccess(),
    );
    expect(await controller.list()).toEqual([]);
  });

  it('leaves out a pair with an end the caller does not reach', async () => {
    // Both ends are checked: a pair with one hidden end would name the
    // hidden agent (CLEAN-231).
    const { gateway, service } = accessHarness(['a', 'b', 'c']);
    gateway.seed(ADMIN.id, false, [{ agentId: 'c', list: 'denied' }]);
    const controller = new PeerLinkController(
      {
        listInternalLinks: jest.fn().mockResolvedValue([
          { agentId: 'a', peerAgentId: 'b' },
          { agentId: 'b', peerAgentId: 'c' },
          { agentId: 'c', peerAgentId: 'a' },
        ]),
      } as unknown as IPeerGateway,
      service,
    );

    const out = await controller.list({
      user: { sub: ADMIN.id, roles: [ADMIN.role] },
    } as unknown as Request);

    expect(out).toEqual([{ agentId: 'a', peerAgentId: 'b' }]);
  });
});
