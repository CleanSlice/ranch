import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Request } from 'express';
import { DECORATORS } from '@nestjs/swagger/dist/constants';
import { MyChatController } from './myChat.controller';
import { ChatSessionDto, MyChatsQueryDto } from './dtos';
import {
  IChatGateway,
  IChatSessionData,
  IChatTopicData,
  IChatTopicGateway,
  ChatSyncService,
} from './domain';
import { TranscriptReaderService } from '#/agent/file/domain';
import { IAuthTokenPayload } from '#/user/auth/domain/auth.types';
import { UserRoleTypes } from '#/user/user/domain';
import { openAccess } from '#/user/agentAccess/domain/__fixtures__/agentAccess';

const SUB = 'user-1';

const OWNED: IChatSessionData = {
  id: 'c1',
  agentId: 'a1',
  channel: 'bridle',
  externalUserId: SUB, // owned by SUB
  sessionKey: `bridle:${SUB}`,
  title: 'My chat',
  preview: 'hi',
  lastRole: 'assistant',
  lastMessageAt: new Date(2000),
  messageCount: 4,
  userMessageCount: 2,
  lastIndexedEventId: null,
  lastIndexedSize: 100,
  summary: null,
  summaryAt: null,
  insights: null,
  outcome: null,
  question: null,
  topicIds: [],
  insightVersion: 0,
  archived: false,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

/**
 * A conversation as these routes answer it (CLEAN-270, review): what
 * `ChatSessionDto` declares, with its topics by label. The row's own
 * bookkeeping stays in: the ids of its topics, the version of the prompt
 * that summarised it, and what the reconcile last indexed.
 */
const BOOKKEEPING = [
  'topicIds',
  'insightVersion',
  'lastIndexedEventId',
  'lastIndexedSize',
];
const shown = (session: IChatSessionData, topics: string[] = []) => ({
  ...Object.fromEntries(
    Object.entries(session).filter(([key]) => !BOOKKEEPING.includes(key)),
  ),
  topics,
});

/** The one topic there is, as the gateway answers it for any id asked. */
const BILLING: IChatTopicData = {
  id: 'topic-billing',
  key: 'billing',
  labels: { en: 'Billing', ru: 'Оплата' },
  mergedIntoId: null,
  createdAt: new Date(0),
};
const topicsStub = () =>
  ({
    findByIds: jest.fn(
      async (ids: readonly string[]) =>
        new Map(
          ids.filter((id) => id === BILLING.id).map((id) => [id, BILLING]),
        ),
    ),
  }) as unknown as IChatTopicGateway;

function makeChats(findById: jest.Mock) {
  const list = jest.fn(async () => ({ items: [OWNED], total: 1 }));
  const upsertFeedback = jest.fn(async (i: Record<string, unknown>) => ({
    id: 'f1',
    createdAt: new Date(0),
    comment: null,
    ...i,
  }));
  const deleteFeedback = jest.fn(async () => {});
  const listFeedbackByAuthor = jest.fn(async () => []);
  const chats = {
    findById,
    list,
    upsertFeedback,
    deleteFeedback,
    listFeedbackByAuthor,
  } as unknown as IChatGateway;
  return { chats, findById, list, upsertFeedback, deleteFeedback };
}

function readerStub(read?: jest.Mock) {
  return {
    read:
      read ??
      jest.fn(async () => [
        { id: 'm1', role: 'user', text: 'hi', ts: 1 },
        { id: 'm2', role: 'assistant', text: 'hello', ts: 2 },
      ]),
  } as unknown as TranscriptReaderService;
}

function syncStub(fn?: jest.Mock) {
  const syncForExternalUser =
    fn ??
    jest.fn(async () => ({
      scannedAgents: 1,
      scannedFiles: 1,
      upserted: 1,
      skipped: 0,
    }));
  const sync = { syncForExternalUser } as unknown as ChatSyncService;
  return { sync, syncForExternalUser };
}

const req = (
  sub?: string,
  roles: UserRoleTypes[] = [],
  acceptLanguage?: string,
) =>
  ({
    user: sub ? ({ sub, roles, email: '' } as IAuthTokenPayload) : undefined,
    headers: acceptLanguage ? { 'accept-language': acceptLanguage } : {},
  }) as Request & { user?: IAuthTokenPayload };

function makeController(findById: jest.Mock, read?: jest.Mock) {
  const { chats, list, upsertFeedback, deleteFeedback } = makeChats(findById);
  const { sync, syncForExternalUser } = syncStub();
  const sources = { attach: async (m: unknown) => m } as never;
  const ctrl = new MyChatController(
    chats,
    readerStub(read),
    sync,
    sources,
    openAccess(),
    topicsStub(),
  );
  return { ctrl, list, syncForExternalUser, upsertFeedback, deleteFeedback };
}

/**
 * CLEAN-270. A conversation carries what its summary says: the outcome and
 * the question as they are stored, the topics by label. This console has two
 * languages, so the label is the one the request asks for.
 */
describe('MyChatController, what a summary says', () => {
  const SUMMARISED: IChatSessionData = {
    ...OWNED,
    summary: 'Asked about an invoice.',
    summaryAt: new Date(3000),
    outcome: 'open',
    question: 'Где мой счёт за октябрь?',
    topicIds: [BILLING.id, 'topic-gone'],
    insightVersion: 2,
  };

  it('names the topics in the language the request asks for', async () => {
    const { ctrl } = makeController(jest.fn(async () => SUMMARISED));

    const one = await ctrl.detail(
      'c1',
      req(SUB, [], 'ru-RU,ru;q=0.9,en;q=0.8'),
    );

    expect(one).toMatchObject({
      outcome: 'open',
      question: 'Где мой счёт за октябрь?',
      topics: ['Оплата'],
    });
  });

  it('names them in English for a language the console does not have, and for no header', async () => {
    const { ctrl } = makeController(jest.fn(async () => SUMMARISED));

    expect((await ctrl.detail('c1', req(SUB, [], 'de-DE'))).topics).toEqual([
      'Billing',
    ]);
    expect((await ctrl.detail('c1', req(SUB))).topics).toEqual(['Billing']);
  });

  it('gives every listed conversation its topics, none for one with no summary', async () => {
    const { ctrl, list } = makeController(jest.fn());
    list.mockResolvedValue({ items: [SUMMARISED, OWNED], total: 2 });

    const res = await ctrl.list({}, req(SUB, [], 'ru'));

    expect(res.items.map((item) => item.topics)).toEqual([['Оплата'], []]);
    expect(res.items[1]).toMatchObject({ outcome: null, question: null });
  });
});

describe('MyChatController.list', () => {
  it('scopes the query to a regular caller (bridle + their sub)', async () => {
    const { ctrl, list } = makeController(jest.fn());
    const res = await ctrl.list({ page: 2, perPage: 10 }, req(SUB));
    expect(list).toHaveBeenCalledWith({
      // No access list on this account: no agent is filtered out.
      agentScope: undefined,
      channel: 'bridle',
      externalUserId: SUB,
      archived: false,
      page: 2,
      perPage: 10,
    });
    // Each row as it is stored, with its topics by label (CLEAN-270): none
    // here, the conversation has no summary.
    expect(res).toEqual({
      items: [shown(OWNED)],
      total: 1,
      page: 2,
      perPage: 10,
    });
  });

  it("scopes an owner/admin to the shared 'admin' channel", async () => {
    const { ctrl, list } = makeController(jest.fn());
    await ctrl.list({}, req(SUB, [UserRoleTypes.Owner]));
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'bridle', externalUserId: 'admin' }),
    );
  });

  it('rejects an unauthenticated request', async () => {
    const { ctrl } = makeController(jest.fn());
    await expect(ctrl.list({}, req(undefined))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  // CLEAN-248. History lives inside one agent, so the own list can be
  // narrowed to it. That the caller reaches the agent is the guard's check
  // (`@AgentScoped('query.agentId')`, pinned in agentScopedRoutes.spec.ts).
  it('narrows to one agent, still inside the caller’s own rows', async () => {
    const { ctrl, list } = makeController(jest.fn());
    await ctrl.list({ agentId: 'a1', archived: true }, req(SUB));
    expect(list).toHaveBeenCalledWith({
      agentId: 'a1',
      agentScope: undefined,
      channel: 'bridle',
      externalUserId: SUB,
      archived: true,
      page: 1,
      perPage: 50,
    });
  });

  it('passes a search on, beside the caller’s own scope', async () => {
    const { ctrl, list } = makeController(jest.fn());
    await ctrl.list({ agentId: 'a1', search: 'pods' }, req(SUB));
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'a1',
        search: 'pods',
        channel: 'bridle',
        externalUserId: SUB,
      }),
    );
  });

  it('asks the gateway exactly as before when neither is given', async () => {
    const { ctrl, list } = makeController(jest.fn());
    await ctrl.list({}, req(SUB));
    const [filter] = list.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(Object.keys(filter).sort()).toEqual([
      'agentScope',
      'archived',
      'channel',
      'externalUserId',
      'page',
      'perPage',
    ]);
  });
});

describe('MyChatsQueryDto', () => {
  const parse = (raw: Record<string, unknown>) =>
    plainToInstance(MyChatsQueryDto, raw);

  it('trims the search', async () => {
    const dto = parse({ search: '  pods  ' });
    expect(dto.search).toBe('pods');
    expect(await validate(dto)).toEqual([]);
  });

  it('treats a search of spaces as no search', async () => {
    const dto = parse({ search: '   ' });
    expect(dto.search).toBeUndefined();
    expect(await validate(dto)).toEqual([]);
  });

  it('refuses a search longer than 100 characters', async () => {
    const errors = await validate(parse({ search: 'x'.repeat(101) }));
    expect(errors.map((e) => e.property)).toEqual(['search']);
  });

  it('takes an agent id', async () => {
    const dto = parse({ agentId: 'a1' });
    expect(dto.agentId).toBe('a1');
    expect(await validate(dto)).toEqual([]);
  });
});

describe('MyChatController.detail', () => {
  it('returns the session when a regular caller owns it', async () => {
    const { ctrl } = makeController(jest.fn(async () => OWNED));
    await expect(ctrl.detail('c1', req(SUB))).resolves.toEqual(shown(OWNED));
  });

  // The whole row used to be spread into the answer, so its bookkeeping
  // left the API though no DTO declares it.
  it('answers what the DTO declares and nothing else, on the chat and on the list', async () => {
    const declared = (
      Reflect.getMetadata(
        DECORATORS.API_MODEL_PROPERTIES_ARRAY,
        ChatSessionDto.prototype,
      ) as string[]
    ).map((property) => property.replace(/^:/, ''));
    const row = {
      ...OWNED,
      topicIds: [BILLING.id],
      insightVersion: 2,
      lastIndexedEventId: 'event-9',
      // A column nobody has declared yet.
      somethingNew: 'not for the wire',
    };
    const { ctrl, list } = makeController(jest.fn(async () => row));
    list.mockResolvedValue({ items: [row], total: 1 });

    const answers = [
      await ctrl.detail('c1', req(SUB)),
      (await ctrl.list({} as never, req(SUB))).items[0],
    ];

    for (const answer of answers) {
      expect(
        Object.keys(answer).filter((key) => !declared.includes(key)),
      ).toEqual([]);
      for (const kept of [...BOOKKEEPING, 'somethingNew']) {
        expect(answer).not.toHaveProperty(kept);
      }
      expect(answer).toEqual(shown(OWNED, ['Billing']));
    }
  });

  // CLEAN-236. `admin` was the conversation of every Owner and Admin; it is
  // the Owner's own now, and an Admin's is under their own id like a User's.
  it("lets the Owner read the 'admin' session, which is theirs", async () => {
    const adminChat = { ...OWNED, externalUserId: 'admin' };
    const { ctrl } = makeController(jest.fn(async () => adminChat));
    await expect(
      ctrl.detail('c1', req(SUB, [UserRoleTypes.Owner])),
    ).resolves.toEqual(shown(adminChat));
  });

  it("answers an Admin for the 'admin' session as for a chat that does not exist", async () => {
    const adminChat = { ...OWNED, externalUserId: 'admin' };
    const { ctrl } = makeController(jest.fn(async () => adminChat));
    await expect(
      ctrl.detail('c1', req(SUB, [UserRoleTypes.Admin])),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('lets an Admin read the session under their own id', async () => {
    const { ctrl } = makeController(jest.fn(async () => OWNED));
    await expect(
      ctrl.detail('c1', req(SUB, [UserRoleTypes.Admin])),
    ).resolves.toEqual(shown(OWNED));
  });

  it('404s when the chat belongs to someone else (no existence leak)', async () => {
    const { ctrl } = makeController(jest.fn(async () => OWNED));
    await expect(ctrl.detail('c1', req('someone-else'))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('404s a non-bridle session even with a matching externalUserId', async () => {
    const telegram = { ...OWNED, channel: 'telegram' };
    const { ctrl } = makeController(jest.fn(async () => telegram));
    await expect(ctrl.detail('c1', req(SUB))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('404s a missing chat', async () => {
    const { ctrl } = makeController(jest.fn(async () => null));
    await expect(ctrl.detail('nope', req(SUB))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('MyChatController.messages', () => {
  it('reads the transcript for an owned chat', async () => {
    const read = jest.fn(async () => [
      { id: 'm1', role: 'user', text: 'hi', ts: 1 },
    ]);
    const { ctrl } = makeController(
      jest.fn(async () => OWNED),
      read,
    );
    const res = await ctrl.messages('c1', {}, req(SUB));
    expect(read).toHaveBeenCalledWith(
      'a1',
      'data/sessions/bridle:user-1.jsonl',
      { types: ['user', 'assistant', 'summary'], filterTransient: true },
    );
    expect(res.messages).toHaveLength(1);
  });

  it("does not read another user's transcript", async () => {
    const read = jest.fn(async () => []);
    const { ctrl } = makeController(
      jest.fn(async () => OWNED),
      read,
    );
    await expect(
      ctrl.messages('c1', {}, req('someone-else')),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(read).not.toHaveBeenCalled();
  });

  it('returns an empty page when the file is unreadable', async () => {
    const read = jest.fn(async () => {
      throw new Error('gone');
    });
    const { ctrl } = makeController(
      jest.fn(async () => OWNED),
      read,
    );
    const res = await ctrl.messages('c1', {}, req(SUB));
    expect(res).toEqual({ messages: [], nextCursor: null, hasMore: false });
  });
});

describe('MyChatController feedback', () => {
  it("records feedback with source='app' and the caller's real sub as author", async () => {
    // Owner: ownership resolves to 'admin', but the feedback author must stay
    // the real user id (sub), not the shared channel.
    const adminChat = { ...OWNED, externalUserId: 'admin' };
    const { ctrl, upsertFeedback } = makeController(
      jest.fn(async () => adminChat),
    );
    await ctrl.createFeedback(
      'c1',
      { messageId: 'm2', rating: 1 },
      req(SUB, [UserRoleTypes.Owner]),
    );
    expect(upsertFeedback).toHaveBeenCalledWith({
      sessionId: 'c1',
      messageId: 'm2',
      rating: 1,
      comment: undefined,
      source: 'app',
      authorId: SUB,
    });
  });

  it("won't record feedback on someone else's chat", async () => {
    const { ctrl, upsertFeedback } = makeController(jest.fn(async () => OWNED));
    await expect(
      ctrl.createFeedback('c1', { messageId: 'm2', rating: 1 }, req('other')),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(upsertFeedback).not.toHaveBeenCalled();
  });

  it('clears feedback keyed by the real sub', async () => {
    const { ctrl, deleteFeedback } = makeController(jest.fn(async () => OWNED));
    await ctrl.deleteFeedback('c1', 'm2', req(SUB));
    expect(deleteFeedback).toHaveBeenCalledWith('c1', 'm2', SUB);
  });
});

describe('MyChatController.syncMine', () => {
  it('reconciles only the caller (regular user → their sub)', async () => {
    const { ctrl, syncForExternalUser } = makeController(jest.fn());
    await ctrl.syncMine({ agentId: 'a1' }, req(SUB));
    // The third argument is the caller's reach (CLEAN-231): the sync leaves
    // out conversations with agents taken away from them.
    expect(syncForExternalUser).toHaveBeenCalledWith(
      SUB,
      'a1',
      expect.objectContaining({ unrestricted: true }),
    );
  });

  it("reconciles the 'admin' channel for an owner/admin", async () => {
    const { ctrl, syncForExternalUser } = makeController(jest.fn());
    await ctrl.syncMine({}, req(SUB, [UserRoleTypes.Owner]));
    expect(syncForExternalUser).toHaveBeenCalledWith(
      'admin',
      undefined,
      expect.objectContaining({ unrestricted: true }),
    );
  });
});
