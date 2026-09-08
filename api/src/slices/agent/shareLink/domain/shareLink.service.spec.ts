import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ShareLinkService } from './shareLink.service';
import { ICreateShareLinkInput, IShareLinkGateway } from './shareLink.gateway';
import { IShareLinkData, ShareLinkErrorCodes } from './shareLink.types';
import { IAgentData, IAgentGateway } from '#/agent/agent/domain';

const TOKEN_RE = /^sl_[A-Za-z0-9_-]{43}$/;

// In-memory gateway stub enforcing the one-row-per-agent invariant the
// database gets from `agentId @unique`.
function makeGatewayStub() {
  const rows = new Map<string, IShareLinkData>();
  let now = 1000;
  const stamp = () => new Date((now += 1000)).toISOString();

  const gateway = {
    findByAgent: jest.fn(async (agentId: string) => rows.get(agentId) ?? null),
    findByToken: jest.fn(
      async (token: string) =>
        [...rows.values()].find((r) => r.token === token) ?? null,
    ),
    create: jest.fn(
      async ({ agentId, token, userId }: ICreateShareLinkInput) => {
        if (rows.has(agentId)) {
          throw Object.assign(new Error('Unique constraint failed'), {
            code: 'P2002',
          });
        }
        const at = stamp();
        const row: IShareLinkData = {
          id: `link-${agentId}`,
          agentId,
          token,
          revokedAt: null,
          rotatedAt: null,
          rotationCount: 0,
          createdBy: userId,
          updatedBy: userId,
          createdAt: at,
          updatedAt: at,
        };
        rows.set(agentId, row);
        return row;
      },
    ),
    rotate: jest.fn(async (agentId: string, token: string, userId: string) => {
      const row = rows.get(agentId)!;
      const at = stamp();
      const next: IShareLinkData = {
        ...row,
        token,
        revokedAt: null,
        rotatedAt: at,
        rotationCount: row.rotationCount + 1,
        updatedBy: userId,
        updatedAt: at,
      };
      rows.set(agentId, next);
      return next;
    }),
    revoke: jest.fn(async (agentId: string, userId: string) => {
      const row = rows.get(agentId)!;
      const at = stamp();
      const next: IShareLinkData = {
        ...row,
        revokedAt: at,
        updatedBy: userId,
        updatedAt: at,
      };
      rows.set(agentId, next);
      return next;
    }),
  };

  return {
    gateway: gateway as unknown as IShareLinkGateway,
    rows,
    spies: gateway,
  };
}

function makeAgentStub(agents: Partial<IAgentData>[] = [{ id: 'agent-1' }]) {
  const byId = new Map<string, IAgentData>();
  for (const a of agents) {
    byId.set(a.id!, {
      id: a.id!,
      name: a.name ?? 'Support bot',
      status: a.status ?? 'running',
    } as IAgentData);
  }
  const gateway = {
    findById: jest.fn(async (id: string) => byId.get(id) ?? null),
  };
  return { agents: gateway as unknown as IAgentGateway, spies: gateway };
}

function newService(agentStub = makeAgentStub()) {
  const link = makeGatewayStub();
  const service = new ShareLinkService(link.gateway, agentStub.agents);
  return { service, ...link, agentSpies: agentStub.spies };
}

describe('ShareLinkService.mint (token format)', () => {
  it('mints `sl_` + 43 base64url chars', async () => {
    const { service } = newService();
    const state = await service.share('agent-1', 'user-1');
    expect(state.token).toMatch(TOKEN_RE);
  });

  it('never mints the same token twice', async () => {
    const { service } = newService();
    const first = await service.share('agent-1', 'user-1');
    await service.revoke('agent-1', 'user-1');
    const second = await service.share('agent-1', 'user-1');
    expect(second.token).not.toBe(first.token);
  });
});

describe('ShareLinkService.getState', () => {
  it('reports the empty state for an agent that was never shared', async () => {
    const { service } = newService();
    expect(await service.getState('agent-1')).toEqual({
      active: false,
      token: null,
      createdAt: null,
      revokedAt: null,
      rotatedAt: null,
      rotationCount: 0,
    });
  });

  it('404s for an unknown agent', async () => {
    const { service } = newService();
    await expect(service.getState('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('ShareLinkService.share', () => {
  it('creates the link on first share and marks it active', async () => {
    const { service, spies } = newService();
    const state = await service.share('agent-1', 'user-1');
    expect(state.active).toBe(true);
    expect(state.rotationCount).toBe(0);
    expect(state.revokedAt).toBeNull();
    expect(spies.create).toHaveBeenCalledWith({
      agentId: 'agent-1',
      token: state.token,
      userId: 'user-1',
    });
  });

  it('is idempotent while the link is active (same token, no rotation)', async () => {
    const { service, spies } = newService();
    const first = await service.share('agent-1', 'user-1');
    const second = await service.share('agent-1', 'user-2');
    expect(second.token).toBe(first.token);
    expect(second.rotationCount).toBe(0);
    expect(spies.create).toHaveBeenCalledTimes(1);
    expect(spies.rotate).not.toHaveBeenCalled();
  });

  it('rotates to a brand-new token when the link was revoked', async () => {
    const { service, spies } = newService();
    const first = await service.share('agent-1', 'user-1');
    await service.revoke('agent-1', 'user-1');
    const again = await service.share('agent-1', 'user-2');

    expect(again.active).toBe(true);
    expect(again.token).not.toBe(first.token);
    expect(again.token).toMatch(TOKEN_RE);
    expect(again.revokedAt).toBeNull();
    expect(again.rotatedAt).not.toBeNull();
    expect(again.rotationCount).toBe(1);
    expect(spies.rotate).toHaveBeenCalledTimes(1);
  });

  it('404s for an unknown agent', async () => {
    const { service } = newService();
    await expect(service.share('nope', 'user-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  // Two console users pressing Share at the same moment: the loser's INSERT
  // hits `agentId @unique`. An idempotent POST must answer with the winner's
  // link, not a 500.
  it('recovers from a lost create race and returns the winning link', async () => {
    const { service, spies, rows } = newService();
    const winner = await service.share('agent-1', 'user-1');

    // Second actor reads no row (stale read), then loses the INSERT.
    spies.findByAgent.mockImplementationOnce(async () => null);
    const loser = await service.share('agent-1', 'user-2');

    expect(spies.create).toHaveBeenCalledTimes(2);
    expect(loser.token).toBe(winner.token);
    expect(loser.active).toBe(true);
    expect(rows.get('agent-1')!.rotationCount).toBe(0);
  });
});

describe('ShareLinkService.regenerate', () => {
  it('creates the link when the agent was never shared', async () => {
    const { service, spies } = newService();
    const state = await service.regenerate('agent-1', 'user-1');
    expect(state.active).toBe(true);
    expect(state.token).toMatch(TOKEN_RE);
    expect(spies.create).toHaveBeenCalledTimes(1);
    expect(spies.rotate).not.toHaveBeenCalled();
  });

  it('always rotates an active link', async () => {
    const { service } = newService();
    const first = await service.regenerate('agent-1', 'user-1');
    const second = await service.regenerate('agent-1', 'user-1');
    const third = await service.regenerate('agent-1', 'user-1');

    expect(second.token).not.toBe(first.token);
    expect(third.token).not.toBe(second.token);
    expect(second.rotationCount).toBe(1);
    expect(third.rotationCount).toBe(2);
    expect(third.active).toBe(true);
  });

  it('revives a revoked link with a new token', async () => {
    const { service } = newService();
    const first = await service.regenerate('agent-1', 'user-1');
    await service.revoke('agent-1', 'user-1');
    const revived = await service.regenerate('agent-1', 'user-1');

    expect(revived.active).toBe(true);
    expect(revived.revokedAt).toBeNull();
    expect(revived.token).not.toBe(first.token);
  });

  it('404s for an unknown agent', async () => {
    const { service } = newService();
    await expect(service.regenerate('nope', 'user-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('ShareLinkService.revoke', () => {
  it('deactivates an active link and hides the dead token', async () => {
    const { service } = newService();
    await service.share('agent-1', 'user-1');
    const state = await service.revoke('agent-1', 'user-2');

    expect(state.active).toBe(false);
    expect(state.token).toBeNull();
    expect(state.revokedAt).not.toBeNull();
  });

  it('is a no-op on an already revoked link', async () => {
    const { service, spies } = newService();
    await service.share('agent-1', 'user-1');
    const first = await service.revoke('agent-1', 'user-1');
    const second = await service.revoke('agent-1', 'user-1');

    expect(spies.revoke).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it('is a no-op when the agent was never shared', async () => {
    const { service, spies } = newService();
    const state = await service.revoke('agent-1', 'user-1');
    expect(state.active).toBe(false);
    expect(state.rotationCount).toBe(0);
    expect(spies.revoke).not.toHaveBeenCalled();
  });

  it('404s for an unknown agent', async () => {
    const { service } = newService();
    await expect(service.revoke('nope', 'user-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('ShareLinkService.resolveForVisitor', () => {
  it('returns only the agent id, name and status', async () => {
    const { service } = newService(
      makeAgentStub([
        { id: 'agent-1', name: 'Support bot', status: 'running' },
      ]),
    );
    const { token } = await service.share('agent-1', 'user-1');
    const resolved = await service.resolveForVisitor(token!);

    expect(resolved).toEqual({
      agentId: 'agent-1',
      agentName: 'Support bot',
      agentStatus: 'running',
    });
  });

  it('404s with SHARE_LINK_NOT_FOUND for an unknown token, and a revoked token answers identically', async () => {
    const { service } = newService();
    const { token } = await service.share('agent-1', 'user-1');
    await service.revoke('agent-1', 'user-1');

    const revoked = await service
      .resolveForVisitor(token!)
      .catch((e: NotFoundException) => e);
    const unknown = await service
      .resolveForVisitor('sl_totally-unknown')
      .catch((e: NotFoundException) => e);

    expect(revoked).toBeInstanceOf(NotFoundException);
    expect(unknown).toBeInstanceOf(NotFoundException);
    expect((revoked as NotFoundException).getResponse()).toEqual({
      code: ShareLinkErrorCodes.NotFound,
    });
    // FR-013: a revoked link must be indistinguishable from a bogus one.
    expect((revoked as NotFoundException).getResponse()).toEqual(
      (unknown as NotFoundException).getResponse(),
    );
    expect((revoked as NotFoundException).getStatus()).toBe(
      (unknown as NotFoundException).getStatus(),
    );
  });

  it('404s with the same body when the agent behind the link is gone', async () => {
    const { service, rows } = newService();
    await service.share('agent-1', 'user-1');
    rows.get('agent-1')!.agentId = 'deleted-agent';

    const err = await service
      .resolveForVisitor(rows.get('agent-1')!.token)
      .catch((e: NotFoundException) => e);
    expect(err).toBeInstanceOf(NotFoundException);
    expect((err as NotFoundException).getResponse()).toEqual({
      code: ShareLinkErrorCodes.NotFound,
    });
  });

  it('404s on an empty token without hitting the gateway', async () => {
    const { service, spies } = newService();
    await expect(service.resolveForVisitor('')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(spies.findByToken).not.toHaveBeenCalled();
  });
});

describe('ShareLinkService.authorizeChat', () => {
  it('maps a valid token + visitor to the share client id', async () => {
    const { service } = newService();
    const { token } = await service.share('agent-1', 'user-1');
    await expect(service.authorizeChat(token!, 'agent-1', 'abc')).resolves.toBe(
      'share-abc',
    );
  });

  it('403s SHARE_LINK_INVALID for an unknown token', async () => {
    const { service } = newService();
    const err = await service
      .authorizeChat('sl_nope', 'agent-1', 'abc')
      .catch((e: ForbiddenException) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).getResponse()).toEqual({
      code: ShareLinkErrorCodes.LinkInvalid,
    });
  });

  it('403s SHARE_LINK_INVALID once the link is revoked', async () => {
    const { service } = newService();
    const { token } = await service.share('agent-1', 'user-1');
    await service.revoke('agent-1', 'user-1');

    const err = await service
      .authorizeChat(token!, 'agent-1', 'abc')
      .catch((e: ForbiddenException) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).getResponse()).toEqual({
      code: ShareLinkErrorCodes.LinkInvalid,
    });
  });

  it('403s SHARE_LINK_INVALID when the token belongs to another agent', async () => {
    const { service } = newService(
      makeAgentStub([{ id: 'agent-1' }, { id: 'agent-2' }]),
    );
    const { token } = await service.share('agent-1', 'user-1');

    const err = await service
      .authorizeChat(token!, 'agent-2', 'abc')
      .catch((e: ForbiddenException) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).getResponse()).toEqual({
      code: ShareLinkErrorCodes.LinkInvalid,
    });
  });

  it('403s SHARE_VISITOR_INVALID for a malformed visitor id', async () => {
    const { service } = newService();
    const { token } = await service.share('agent-1', 'user-1');

    for (const visitor of ['a b', '', 'x'.repeat(65), 'a/b']) {
      const err = await service
        .authorizeChat(token!, 'agent-1', visitor)
        .catch((e: ForbiddenException) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err as ForbiddenException).getResponse()).toEqual({
        code: ShareLinkErrorCodes.VisitorInvalid,
      });
    }
  });

  it('never throws Unauthorized (401 would bounce the visitor to /login)', async () => {
    const { service } = newService();
    const err = await service
      .authorizeChat('sl_nope', 'agent-1', 'abc')
      .catch((e: ForbiddenException) => e);
    expect((err as ForbiddenException).getStatus()).toBe(403);
  });
});
