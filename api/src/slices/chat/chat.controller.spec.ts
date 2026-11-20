import type { Request } from 'express';
import { UserRoleTypes } from '#/user/user/domain';
import { permissionOver } from '#/agent/agent/domain/__fixtures__/agentPermission';
import { AgentReach } from '#/user/agentAccess/domain/agentAccess.types';
import { ChatController } from './chat.controller';

/**
 * CLEAN-236. These routes read what other people said to an agent. While
 * every Owner and Admin was one chat participant, an Admin saw the Owner's
 * conversation with the Ranch admin agent in their own chat window anyway.
 * The Owner's conversation is the Owner's now, so reading it here is the
 * supervision of an agent only the Owner manages.
 */
const RANCH = 'agent-ranch';

const as = (sub: string, role: UserRoleTypes) =>
  ({ user: { sub, email: '', roles: [role] } }) as unknown as Request;
const OWNER = as('user-o', UserRoleTypes.Owner);
const ADMIN = as('user-a', UserRoleTypes.Admin);

const chat = (agentId: string, externalUserId = 'admin') => ({
  id: 'chat-1',
  agentId,
  channel: 'bridle',
  externalUserId,
  sessionKey: `bridle:${externalUserId}`,
});

function make(found = chat(RANCH)) {
  const chats = {
    findById: jest.fn(async () => found),
    list: jest.fn(async () => ({ items: [found], total: 1 })),
  };
  const reader = { read: jest.fn(async () => []) };
  const sync = { syncAll: jest.fn(async () => ({ scannedAgents: 0 })) };
  const agents = {
    findAdmin: () => Promise.resolve({ id: RANCH, isAdmin: true }),
    findById: (id: string) =>
      Promise.resolve({ id, isAdmin: id === RANCH, createdById: null }),
  };
  const access = { reachableIds: jest.fn(async () => AgentReach.ALL) };
  const participants = {
    forViewer: () => async () => ({ person: null, peer: null }),
  };
  const controller = new ChatController(
    chats as never,
    reader as never,
    sync as never,
    {} as never,
    { attach: async (m: unknown) => m } as never,
    access as never,
    permissionOver(agents),
    participants as never,
  );
  return { controller, chats, reader, sync };
}

describe('ChatController — the conversations of the Ranch admin agent', () => {
  it('an Admin is answered as for a chat that does not exist, on the chat and on its turns', async () => {
    const { controller, reader } = make();

    for (const attempt of [
      controller.detail('chat-1', ADMIN as never),
      controller.messages('chat-1', {} as never, ADMIN as never),
    ]) {
      await expect(attempt).rejects.toMatchObject({
        status: 404,
        message: 'Chat chat-1 not found',
      });
    }
    expect(reader.read).not.toHaveBeenCalled();
  });

  it('an Admin’s list leaves that agent out, and naming it lists nothing', async () => {
    const { controller, chats } = make();

    await controller.list({} as never, ADMIN as never);
    expect(chats.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ agentScope: { notIn: [RANCH] } }),
    );

    chats.list.mockClear();
    expect(
      await controller.list({ agentId: RANCH } as never, ADMIN as never),
    ).toEqual({ items: [], total: 0, page: 1, perPage: 50 });
    expect(chats.list).not.toHaveBeenCalled();
  });

  it('an Admin’s sync walks the agents whose conversations are theirs to read', async () => {
    const { controller, sync } = make();

    await controller.syncChats({} as never, ADMIN as never);

    const [, reach] = sync.syncAll.mock.calls[0] as unknown as [
      unknown,
      AgentReach,
    ];
    expect(reach.has(RANCH)).toBe(false);
    expect(reach.has('agent-a')).toBe(true);
  });

  it('the Owner reads them as any other', async () => {
    const { controller, chats } = make();

    await expect(
      controller.detail('chat-1', OWNER as never),
    ).resolves.toMatchObject({ id: 'chat-1' });
    await controller.list({} as never, OWNER as never);
    expect(chats.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ agentScope: undefined }),
    );
  });

  it('an Admin still reads the conversations of an agent they manage, the Owner’s with it included', async () => {
    const { controller } = make(chat('agent-a', 'admin'));

    await expect(
      controller.detail('chat-1', ADMIN as never),
    ).resolves.toMatchObject({ externalUserId: 'admin' });
  });
});

describe('ChatController — who a conversation is with', () => {
  it('adds the participant to every listed conversation and to the one opened', async () => {
    const { controller } = make(chat('agent-a', 'user-9'));
    (
      controller as unknown as {
        participants: { forViewer: () => () => Promise<unknown> };
      }
    ).participants = {
      forViewer: () => async () => ({
        person: { name: 'Ada', role: 'Admin' },
        peer: null,
      }),
    };

    const listed = await controller.list({} as never, OWNER as never);
    expect(listed.items[0]).toMatchObject({
      externalUserId: 'user-9',
      person: { name: 'Ada', role: 'Admin' },
      peer: null,
    });
    expect(await controller.detail('chat-1', OWNER as never)).toMatchObject({
      person: { name: 'Ada', role: 'Admin' },
    });
  });
});
