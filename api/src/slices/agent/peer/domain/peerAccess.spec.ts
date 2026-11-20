import { UserRoleTypes } from '#/user/user/domain';
import { AgentReach } from '#/user/agentAccess/domain/agentAccess.types';
import {
  NOBODY,
  PeerAccessService,
  peerServes,
  peerVisibility,
  type IPeerAccessRow,
  type IPeerViewer,
} from './peerAccess';
import { PeerOrigins } from './peer.types';

/**
 * The table of `specs/033-identity-boundaries/contracts/colleagues.md` §1,
 * row by row. A is the agent that holds the connection, B the peer.
 */

const B = 'agent-b';

const internal = (openToVisitors = false): IPeerAccessRow => ({
  origin: PeerOrigins.Internal,
  peerAgentId: B,
  openToVisitors,
  ownerUserId: null,
});

const external = (ownerUserId: string | null = null): IPeerAccessRow => ({
  origin: PeerOrigins.External,
  peerAgentId: null,
  openToVisitors: false,
  ownerUserId,
});

const viewer = (
  over: Partial<IPeerViewer> & { reached?: string[] } = {},
): IPeerViewer => ({
  userId: over.userId === undefined ? 'user-1' : over.userId,
  reaches: over.reaches ?? ((id) => (over.reached ?? []).includes(id)),
  managesAgent: over.managesAgent ?? false,
  isOwner: over.isOwner ?? false,
});

describe('the peer access rule', () => {
  describe('a peer of this Ranch', () => {
    it('is shown and serves a person who reaches it, open to visitors or not', () => {
      for (const row of [internal(false), internal(true)]) {
        const who = viewer({ reached: [B] });
        expect(peerVisibility(row, who)).toBe('full');
        expect(peerServes(row, who)).toBe(true);
      }
    });

    it('does not exist for a person who does not reach it, even one who manages A', () => {
      for (const who of [
        viewer({ reached: [] }),
        viewer({ reached: ['agent-c'], managesAgent: true }),
      ]) {
        expect(peerVisibility(internal(), who)).toBe('hidden');
        expect(peerServes(internal(), who)).toBe(false);
      }
    });

    it('does not exist for nobody', () => {
      expect(peerVisibility(internal(), NOBODY)).toBe('hidden');
      expect(peerServes(internal(), NOBODY)).toBe(false);
    });

    it('open to visitors: serves a person who does not reach it, shown without a name', () => {
      const who = viewer({ reached: [], managesAgent: true });
      expect(peerVisibility(internal(true), who)).toBe('masked');
      expect(peerServes(internal(true), who)).toBe(true);
    });

    it('open to visitors: serves nobody in particular, shown without a name', () => {
      expect(peerVisibility(internal(true), NOBODY)).toBe('masked');
      expect(peerServes(internal(true), NOBODY)).toBe(true);
    });

    it('nobody reaches anything, whatever a careless viewer claims', () => {
      // `userId: null` is what decides; a `reaches` that says yes is not asked.
      const who = viewer({ userId: null, reaches: () => true });
      expect(peerVisibility(internal(), who)).toBe('hidden');
      expect(peerServes(internal(), who)).toBe(false);
    });
  });

  describe('a peer outside the Ranch', () => {
    it('shared: shown and serves anybody', () => {
      for (const who of [viewer(), NOBODY]) {
        expect(peerVisibility(external(null), who)).toBe('full');
        expect(peerServes(external(null), who)).toBe(true);
      }
    });

    it('personal: shown and serves its owner', () => {
      const who = viewer({ userId: 'user-1' });
      expect(peerVisibility(external('user-1'), who)).toBe('full');
      expect(peerServes(external('user-1'), who)).toBe(true);
    });

    it('personal: shown to a person who manages A, whose questions it does not take', () => {
      const who = viewer({ userId: 'user-2', managesAgent: true });
      expect(peerVisibility(external('user-1'), who)).toBe('full');
      expect(peerServes(external('user-1'), who)).toBe(false);
    });

    it('personal: does not exist for anybody else', () => {
      for (const who of [viewer({ userId: 'user-2' }), NOBODY]) {
        expect(peerVisibility(external('user-1'), who)).toBe('hidden');
        expect(peerServes(external('user-1'), who)).toBe(false);
      }
    });
  });
});

describe('PeerAccessService.viewerOf', () => {
  function make(opts: {
    reach?: AgentReach;
    manages?: boolean;
    user?: { id: string; role: UserRoleTypes; status: string } | null;
  }) {
    const access = {
      reachableIds: jest.fn(async () => opts.reach ?? AgentReach.ALL),
    };
    const permission = {
      manageable: jest.fn(async () =>
        opts.manages ? { id: 'agent-a' } : null,
      ),
    };
    const users = { findById: jest.fn(async () => opts.user ?? null) };
    const service = new PeerAccessService(
      access as never,
      permission as never,
      users as never,
    );
    return { service, access, permission, users };
  }

  const limitedTo = (...ids: string[]) =>
    new AgentReach({
      limited: true,
      entries: ids.map((agentId) => ({ agentId, list: 'allowed' as const })),
    } as never);

  it('a person: their own reach, and whether they manage the agent', async () => {
    const { service, permission } = make({
      reach: limitedTo('agent-a', B),
      manages: true,
    });
    const party = {
      kind: 'person' as const,
      userId: 'user-1',
      role: UserRoleTypes.Admin,
    };
    const who = await service.viewerOf(party, 'agent-a');
    expect(who.userId).toBe('user-1');
    expect(who.reaches(B)).toBe(true);
    expect(who.reaches('agent-c')).toBe(false);
    expect(who.managesAgent).toBe(true);
    expect(who.isOwner).toBe(false);
    expect(permission.manageable).toHaveBeenCalledWith(party, 'agent-a');
  });

  it('a colleague’s question: the person its chain was started for, as the account stands now, managing nothing', async () => {
    const { service, access, permission } = make({
      reach: limitedTo(B),
      manages: true,
      user: { id: 'user-9', role: UserRoleTypes.User, status: 'active' },
    });
    const who = await service.viewerOf(
      {
        kind: 'peer',
        chain: ['agent-x'],
        connectionId: 'c-1',
        forUserId: 'user-9',
      },
      'agent-a',
    );
    expect(who.userId).toBe('user-9');
    expect(who.reaches(B)).toBe(true);
    expect(who.managesAgent).toBe(false);
    expect(who.isOwner).toBe(false);
    expect(permission.manageable).not.toHaveBeenCalled();
    expect(access.reachableIds).toHaveBeenCalledWith({
      kind: 'person',
      userId: 'user-9',
      role: UserRoleTypes.User,
    });
  });

  it('a colleague’s question for an account that is gone or disabled: nobody', async () => {
    for (const user of [
      null,
      { id: 'user-9', role: UserRoleTypes.Admin, status: 'disabled' },
      { id: 'user-9', role: UserRoleTypes.Agent, status: 'active' },
    ]) {
      const { service } = make({ user });
      const who = await service.viewerOf(
        {
          kind: 'peer',
          chain: ['agent-x'],
          connectionId: 'c-1',
          forUserId: 'user-9',
        },
        'agent-a',
      );
      expect(who).toBe(NOBODY);
    }
  });

  it('everybody else is nobody: a guest, the agent for itself, a chain nobody started', async () => {
    const { service, access, users } = make({ manages: true });
    for (const party of [
      { kind: 'guest' as const },
      { kind: 'trusted' as const },
      { kind: 'peer' as const, chain: ['agent-x'], connectionId: 'c-1' },
    ]) {
      expect(await service.viewerOf(party, 'agent-a')).toBe(NOBODY);
    }
    expect(access.reachableIds).not.toHaveBeenCalled();
    expect(users.findById).not.toHaveBeenCalled();
  });
});
