import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import { A2aCardGuard, A2aPeerGuard } from './a2a.guards';
import type { IA2aRequest } from './a2a.guards';
import type { IPeerGateway } from '../domain/peer.gateway';
import { UserRoleTypes } from '#/user/user/domain';

/**
 * Who may read a card and who may send a task (CLEAN-74, FR-002 / FR-007).
 * The load-bearing case is the last one: a credential is issued for exactly
 * one (caller, peer) pair, so presenting agent B's credential at agent C's
 * endpoint must fail even though the credential itself is perfectly valid.
 */
const VALID = 'ap_' + 'x'.repeat(43);

function contextFor(request: Partial<IA2aRequest>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request as IA2aRequest }),
  } as unknown as ExecutionContext;
}

function makeHarness(
  options: {
    rows?: Array<{
      id: string;
      token: string;
      agentId: string;
      peerAgentId: string;
    }>;
    verify?: () => unknown;
  } = {},
) {
  const rows = options.rows ?? [];
  const peerMocks = {
    findByToken: jest.fn(
      async (token: string) => rows.find((r) => r.token === token) ?? null,
    ),
  };
  const peers = peerMocks as unknown as IPeerGateway;

  const jwt = {
    verify: jest.fn(
      options.verify ??
        (() => ({ sub: 'u1', email: 'u@x', roles: [UserRoleTypes.Owner] })),
    ),
  } as unknown as JwtService;

  return {
    cardGuard: new A2aCardGuard(jwt, peers),
    peerGuard: new A2aPeerGuard(peers),
    peers: peerMocks,
    jwt,
  };
}

const request = (
  authorization: string | undefined,
  agentId = 'agent-b',
): Partial<IA2aRequest> => ({
  headers: authorization ? { authorization } : {},
  params: { agentId },
});

const connection = {
  id: 'peer-1',
  token: VALID,
  agentId: 'agent-a',
  peerAgentId: 'agent-b',
};

describe('A2aCardGuard', () => {
  it('refuses a request with no credential at all', async () => {
    const { cardGuard } = makeHarness();

    await expect(
      cardGuard.canActivate(contextFor(request(undefined))),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('reports one code for every refusal, so nothing is learned from the difference', async () => {
    const { cardGuard } = makeHarness();

    await expect(
      cardGuard.canActivate(contextFor(request(undefined))),
    ).rejects.toMatchObject({
      response: { code: 'A2A_UNAUTHORIZED' },
    });
  });

  it('lets a peer read the card of the agent it is connected to', async () => {
    const { cardGuard } = makeHarness({ rows: [connection] });
    const req = request(`Bearer ${VALID}`, 'agent-b');

    await expect(cardGuard.canActivate(contextFor(req))).resolves.toBe(true);
    expect((req as IA2aRequest).peer).toEqual({
      peerId: 'peer-1',
      callerAgentId: 'agent-a',
    });
  });

  it('refuses a peer credential presented at a different agent', async () => {
    const { cardGuard } = makeHarness({ rows: [connection] });

    await expect(
      cardGuard.canActivate(contextFor(request(`Bearer ${VALID}`, 'agent-c'))),
    ).rejects.toMatchObject({ response: { code: 'A2A_UNAUTHORIZED' } });
  });

  it('refuses a peer-shaped credential that matches no connection', async () => {
    const { cardGuard } = makeHarness({ rows: [] });

    await expect(
      cardGuard.canActivate(contextFor(request(`Bearer ${VALID}`))),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('lets an owner preview a card in the console', async () => {
    const { cardGuard } = makeHarness();
    const req = request('Bearer console.jwt.token');

    await expect(cardGuard.canActivate(contextFor(req))).resolves.toBe(true);
    expect((req as IA2aRequest).user?.sub).toBe('u1');
  });

  it('lets an admin preview a card too', async () => {
    const { cardGuard } = makeHarness({
      verify: () => ({ sub: 'u2', email: 'a@x', roles: [UserRoleTypes.Admin] }),
    });

    await expect(
      cardGuard.canActivate(contextFor(request('Bearer console.jwt.token'))),
    ).resolves.toBe(true);
  });

  it('refuses an ordinary user, who has no business reading cards', async () => {
    const { cardGuard } = makeHarness({
      verify: () => ({ sub: 'u3', email: 'u@x', roles: [UserRoleTypes.User] }),
    });

    await expect(
      cardGuard.canActivate(contextFor(request('Bearer console.jwt.token'))),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses an agent service token: an agent reads a card with its pair credential', async () => {
    const { cardGuard } = makeHarness({
      verify: () => ({
        sub: 'agent:agent-a',
        email: 'agent@ranch.local',
        roles: [UserRoleTypes.Agent],
      }),
    });

    await expect(
      cardGuard.canActivate(contextFor(request('Bearer agent.jwt.token'))),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses a token that does not verify', async () => {
    const { cardGuard } = makeHarness({
      verify: () => {
        throw new Error('jwt expired');
      },
    });

    await expect(
      cardGuard.canActivate(contextFor(request('Bearer stale.jwt'))),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('ignores an authorization header that is not a bearer token', async () => {
    const { cardGuard } = makeHarness();

    await expect(
      cardGuard.canActivate(contextFor(request('Basic dXNlcjpwYXNz'))),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('A2aPeerGuard', () => {
  it('accepts the credential issued for this agent and names the caller', async () => {
    const { peerGuard } = makeHarness({ rows: [connection] });
    const req = request(`Bearer ${VALID}`, 'agent-b');

    await expect(peerGuard.canActivate(contextFor(req))).resolves.toBe(true);
    expect((req as IA2aRequest).peer?.callerAgentId).toBe('agent-a');
  });

  it('refuses a console JWT, even an owner one', async () => {
    const { peerGuard } = makeHarness();

    await expect(
      peerGuard.canActivate(contextFor(request('Bearer console.jwt.token'))),
    ).rejects.toMatchObject({ response: { code: 'A2A_UNAUTHORIZED' } });
  });

  it('refuses a credential issued to reach a different agent', async () => {
    const { peerGuard } = makeHarness({ rows: [connection] });

    await expect(
      peerGuard.canActivate(contextFor(request(`Bearer ${VALID}`, 'agent-c'))),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses a request with no credential', async () => {
    const { peerGuard } = makeHarness();

    await expect(
      peerGuard.canActivate(contextFor(request(undefined))),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('does not look up a credential that cannot be one', async () => {
    const { peerGuard, peers } = makeHarness();

    await expect(
      peerGuard.canActivate(contextFor(request('Bearer ap_tooshort'))),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(peers.findByToken).not.toHaveBeenCalled();
  });
});
