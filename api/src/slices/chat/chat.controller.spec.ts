import type { Request } from 'express';
import { UserRoleTypes } from '#/user/user/domain';
import { permissionOver } from '#/agent/agent/domain/__fixtures__/agentPermission';
import { AgentReach } from '#/user/agentAccess/domain/agentAccess.types';
import { DECORATORS } from '@nestjs/swagger/dist/constants';
import { ChatController } from './chat.controller';
import { ChatSessionDto } from './dtos';

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

const chat = (
  agentId: string,
  externalUserId = 'admin',
  topicIds: string[] = [],
) => ({
  id: 'chat-1',
  agentId,
  channel: 'bridle',
  externalUserId,
  sessionKey: `bridle:${externalUserId}`,
  topicIds,
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
  const insight = { summarize: jest.fn(async () => found) };
  // One topic, with a label in each language of the app console.
  const topics = {
    findByIds: jest.fn(
      async (ids: readonly string[]) =>
        new Map(
          ids
            .filter((id) => id === 'topic-billing')
            .map((id) => [
              id,
              {
                id,
                key: 'billing',
                labels: { en: 'Billing', ru: 'Оплата' },
                mergedIntoId: null,
                createdAt: new Date(0),
              },
            ]),
        ),
    ),
  };
  const controller = new ChatController(
    chats as never,
    reader as never,
    sync as never,
    insight as never,
    { attach: async (m: unknown) => m } as never,
    access as never,
    permissionOver(agents),
    participants as never,
    topics as never,
  );
  return { controller, chats, reader, sync, insight };
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

/**
 * CLEAN-270. The topics of a conversation's summary go out by label. The
 * admin console is English whatever the browser says, so these routes do
 * not read the request's language.
 */
describe('ChatController — the topics of a summary', () => {
  const russianBrowser = {
    ...OWNER,
    headers: { 'accept-language': 'ru-RU,ru;q=0.9' },
  } as unknown as Request;
  const summarised = () =>
    chat('agent-a', 'user-9', ['topic-billing', 'topic-gone']);

  it('names them in English on the list, on the chat and after a new summary', async () => {
    const { controller, insight } = make(summarised());

    const listed = await controller.list({} as never, russianBrowser as never);
    expect(listed.items[0].topics).toEqual(['Billing']);

    const one = await controller.detail('chat-1', russianBrowser as never);
    expect(one.topics).toEqual(['Billing']);

    const again = await controller.summarize('chat-1', russianBrowser as never);
    expect(insight.summarize).toHaveBeenCalledWith('chat-1');
    expect(again.topics).toEqual(['Billing']);
  });

  it('gives a conversation with no topic an empty list', async () => {
    const { controller } = make(chat('agent-a', 'user-9'));
    expect((await controller.detail('chat-1', OWNER as never)).topics).toEqual(
      [],
    );
  });
});

/**
 * The routes spread the whole index row into their answers (CLEAN-270,
 * review), so every column the row has left the API, declared or not:
 * `topicIds` and `insightVersion`, which this feature added and no DTO
 * names, and the reconcile's own bookkeeping with them. An answer is what
 * `ChatSessionDto` declares; a column added to the row tomorrow stays in
 * until somebody declares it.
 */
describe('ChatController — what a conversation is answered with', () => {
  const declared = (
    Reflect.getMetadata(
      DECORATORS.API_MODEL_PROPERTIES_ARRAY,
      ChatSessionDto.prototype,
    ) as string[]
  ).map((property) => property.replace(/^:/, ''));
  /** A whole index row, bookkeeping included. */
  const row = () => ({
    ...chat('agent-a', 'user-9', ['topic-billing']),
    title: 'A title',
    preview: 'hi',
    lastRole: 'assistant',
    lastMessageAt: new Date(2000),
    messageCount: 6,
    userMessageCount: 3,
    lastIndexedEventId: 'event-9',
    lastIndexedSize: 4096,
    summary: 'A summary.',
    summaryAt: new Date(3000),
    insights: { topics: ['Billing'] },
    outcome: 'open',
    question: 'Where is my invoice?',
    insightVersion: 2,
    archived: false,
    createdAt: new Date(0),
    updatedAt: new Date(1000),
    // A column nobody has declared yet.
    somethingNew: 'not for the wire',
  });

  it('is what the DTO declares, on the list, on the chat and after a new summary', async () => {
    const { controller } = make(row() as never);

    const answers = [
      (await controller.list({} as never, OWNER as never)).items[0],
      await controller.detail('chat-1', OWNER as never),
      await controller.summarize('chat-1', OWNER as never),
    ];

    for (const answer of answers) {
      expect(
        Object.keys(answer).filter((key) => !declared.includes(key)),
      ).toEqual([]);
      for (const kept of [
        'topicIds',
        'insightVersion',
        'lastIndexedEventId',
        'lastIndexedSize',
        'somethingNew',
      ]) {
        expect(answer).not.toHaveProperty(kept);
      }
      // What is declared is all there.
      expect(answer).toEqual({
        id: 'chat-1',
        agentId: 'agent-a',
        channel: 'bridle',
        externalUserId: 'user-9',
        sessionKey: 'bridle:user-9',
        title: 'A title',
        preview: 'hi',
        lastRole: 'assistant',
        lastMessageAt: new Date(2000),
        messageCount: 6,
        userMessageCount: 3,
        summary: 'A summary.',
        summaryAt: new Date(3000),
        insights: { topics: ['Billing'] },
        outcome: 'open',
        question: 'Where is my invoice?',
        topics: ['Billing'],
        archived: false,
        createdAt: new Date(0),
        updatedAt: new Date(1000),
        person: null,
        peer: null,
      });
    }
  });
});
