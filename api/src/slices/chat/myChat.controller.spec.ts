import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Request } from 'express';
import { MyChatController } from './myChat.controller';
import { IChatGateway, IChatSessionData, ChatSyncService } from './domain';
import { TranscriptReaderService } from '#/agent/file/domain';
import { IAuthTokenPayload } from '#/user/auth/domain/auth.types';
import { UserRoleTypes } from '#/user/user/domain';

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
  archived: false,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

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

const req = (sub?: string, roles: UserRoleTypes[] = []) =>
  ({
    user: sub ? ({ sub, roles, email: '' } as IAuthTokenPayload) : undefined,
  }) as Request & { user?: IAuthTokenPayload };

function makeController(findById: jest.Mock, read?: jest.Mock) {
  const { chats, list, upsertFeedback, deleteFeedback } = makeChats(findById);
  const { sync, syncForExternalUser } = syncStub();
  const ctrl = new MyChatController(chats, readerStub(read), sync);
  return { ctrl, list, syncForExternalUser, upsertFeedback, deleteFeedback };
}

describe('MyChatController.list', () => {
  it('scopes the query to a regular caller (bridle + their sub)', async () => {
    const { ctrl, list } = makeController(jest.fn());
    const res = await ctrl.list({ page: 2, perPage: 10 }, req(SUB));
    expect(list).toHaveBeenCalledWith({
      channel: 'bridle',
      externalUserId: SUB,
      archived: false,
      page: 2,
      perPage: 10,
    });
    expect(res).toEqual({ items: [OWNED], total: 1, page: 2, perPage: 10 });
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
});

describe('MyChatController.detail', () => {
  it('returns the session when a regular caller owns it', async () => {
    const { ctrl } = makeController(jest.fn(async () => OWNED));
    await expect(ctrl.detail('c1', req(SUB))).resolves.toEqual(OWNED);
  });

  it("lets an owner/admin read the shared 'admin' session", async () => {
    const adminChat = { ...OWNED, externalUserId: 'admin' };
    const { ctrl } = makeController(jest.fn(async () => adminChat));
    await expect(
      ctrl.detail('c1', req(SUB, [UserRoleTypes.Admin])),
    ).resolves.toEqual(adminChat);
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
    expect(syncForExternalUser).toHaveBeenCalledWith(SUB, 'a1');
  });

  it("reconciles the 'admin' channel for an owner/admin", async () => {
    const { ctrl, syncForExternalUser } = makeController(jest.fn());
    await ctrl.syncMine({}, req(SUB, [UserRoleTypes.Owner]));
    expect(syncForExternalUser).toHaveBeenCalledWith('admin', undefined);
  });
});
