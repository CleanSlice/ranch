import type { ModuleRef } from '@nestjs/core';
import { UserRoleTypes } from '#/user/user/domain';
import { ChatParticipantService } from './chatParticipant.service';

/**
 * CLEAN-236. Who a conversation in an agent's list is with. The claims worth
 * a test: an administrator's conversation is under their name now that it
 * is under their own id, the Owner's is the one still called `admin`, and
 * an agent that handed a conversation over is named only to somebody who
 * reaches it.
 */
function make(
  opts: { peers?: Record<string, { agentId: string }> | null } = {},
) {
  const users = {
    findAll: jest.fn(async () => [
      { id: 'user-a', name: 'Adam Admin', role: UserRoleTypes.Admin },
      { id: 'user-o', name: 'Olga Owner', role: UserRoleTypes.Owner },
    ]),
    findById: jest.fn(async (id: string) =>
      id === 'user-a'
        ? { id, name: 'Adam Admin', role: UserRoleTypes.Admin }
        : null,
    ),
  };
  const agents = {
    findById: jest.fn(async (id: string) =>
      id === 'agent-front' ? { id, name: 'Front Desk' } : null,
    ),
  };
  const peerGateway = {
    findById: jest.fn(async (id: string) => opts.peers?.[id] ?? null),
  };
  const moduleRef = {
    get: jest.fn(() => {
      if (opts.peers === null) throw new Error('no such provider');
      return peerGateway;
    }),
  } as unknown as ModuleRef;
  const service = new ChatParticipantService(
    users as never,
    agents as never,
    moduleRef,
  );
  return { service, users, agents, peerGateway };
}

const bridle = (externalUserId: string) => ({
  channel: 'bridle',
  externalUserId,
});
const everything = () => true;
const nothing = () => false;

describe('ChatParticipantService', () => {
  it('names the Owner for the conversation the administrators used to share', async () => {
    const { service } = make();

    expect(await service.forViewer(everything)(bridle('admin'))).toEqual({
      person: { name: 'Olga Owner', role: UserRoleTypes.Owner },
      peer: null,
    });
  });

  it('names an account for a conversation under its id, an Admin’s included', async () => {
    const { service } = make();

    expect(await service.forViewer(everything)(bridle('user-a'))).toEqual({
      person: { name: 'Adam Admin', role: UserRoleTypes.Admin },
      peer: null,
    });
  });

  it('names nobody for a visitor: an embed subject, a share link, an anonymous id', async () => {
    const { service } = make();
    const who = service.forViewer(everything);

    for (const id of ['wslid-A1', 'share-xyz', 'anon-123']) {
      expect(await who(bridle(id))).toEqual({ person: null, peer: null });
    }
  });

  it('reads no identity off another channel: a Telegram chat id is not an account', async () => {
    const { service, users } = make();

    expect(
      await service.forViewer(everything)({
        channel: 'telegram',
        externalUserId: 'admin',
      }),
    ).toEqual({ person: null, peer: null });
    expect(users.findAll).not.toHaveBeenCalled();
  });

  describe('a conversation another agent handed over', () => {
    const peers = { 'connection-1': { agentId: 'agent-front' } };
    const handedOver = bridle('peer:connection-1:ctx-9');

    it('names the asking agent for a viewer who reaches it', async () => {
      const { service } = make({ peers });

      expect(await service.forViewer(everything)(handedOver)).toEqual({
        person: null,
        peer: { name: 'Front Desk' },
      });
    });

    it('is a colleague with no name for a viewer who does not', async () => {
      const { service } = make({ peers });
      const asked: string[] = [];

      expect(
        await service.forViewer((id) => {
          asked.push(id);
          return false;
        })(handedOver),
      ).toEqual({ person: null, peer: { name: null } });
      expect(asked).toEqual(['agent-front']);
    });

    it('is a colleague with no name when the connection is gone, or was named the old way', async () => {
      const { service } = make({ peers });
      const who = service.forViewer(everything);

      expect(await who(bridle('peer:connection-gone:ctx-1'))).toEqual({
        person: null,
        peer: { name: null },
      });
      // Before CLEAN-236 the id held the asking agent's own id. It names no
      // connection, so it names no agent either.
      expect(await who(bridle('peer:agent-front:ctx-1'))).toEqual({
        person: null,
        peer: { name: null },
      });
    });

    it('is a colleague with no name when the peer slice cannot be asked', async () => {
      const { service } = make({ peers: null });

      expect(await service.forViewer(everything)(handedOver)).toEqual({
        person: null,
        peer: { name: null },
      });
    });

    it('is never looked up as an account', async () => {
      const { service, users } = make({ peers });

      await service.forViewer(nothing)(handedOver);

      expect(users.findById).not.toHaveBeenCalled();
    });
  });

  it('reads each person and each connection once for a whole page', async () => {
    const { service, users, peerGateway } = make({
      peers: { 'connection-1': { agentId: 'agent-front' } },
    });
    const who = service.forViewer(everything);

    await Promise.all([
      who(bridle('admin')),
      who(bridle('admin')),
      who(bridle('user-a')),
      who(bridle('user-a')),
      who(bridle('peer:connection-1:ctx-1')),
      who(bridle('peer:connection-1:ctx-2')),
    ]);

    expect(users.findAll).toHaveBeenCalledTimes(1);
    expect(users.findById).toHaveBeenCalledTimes(1);
    expect(peerGateway.findById).toHaveBeenCalledTimes(1);
  });
});
