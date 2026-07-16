import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Request } from 'express';
import { MyChatController } from './myChat.controller';
import { IChatGateway, IChatSessionData } from './domain';
import { TranscriptReaderService } from '#/agent/file/domain';
import { IAuthTokenPayload } from '#/user/auth/domain/auth.types';

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
  const chats = { findById, list } as unknown as IChatGateway;
  return { chats, findById, list };
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

const req = (sub?: string) =>
  ({ user: sub ? ({ sub } as IAuthTokenPayload) : undefined }) as Request & {
    user?: IAuthTokenPayload;
  };

describe('MyChatController.list', () => {
  it('scopes the query to the caller (bridle + their sub)', async () => {
    const { chats, list } = makeChats(jest.fn());
    const ctrl = new MyChatController(chats, readerStub());
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

  it('rejects an unauthenticated request', async () => {
    const { chats } = makeChats(jest.fn());
    const ctrl = new MyChatController(chats, readerStub());
    await expect(ctrl.list({}, req(undefined))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('MyChatController.detail', () => {
  it('returns the session when the caller owns it', async () => {
    const { chats } = makeChats(jest.fn(async () => OWNED));
    const ctrl = new MyChatController(chats, readerStub());
    await expect(ctrl.detail('c1', req(SUB))).resolves.toEqual(OWNED);
  });

  it('404s when the chat belongs to someone else (no existence leak)', async () => {
    const { chats } = makeChats(jest.fn(async () => OWNED));
    const ctrl = new MyChatController(chats, readerStub());
    await expect(ctrl.detail('c1', req('someone-else'))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('404s a non-bridle session even with a matching externalUserId', async () => {
    const telegram = { ...OWNED, channel: 'telegram' };
    const { chats } = makeChats(jest.fn(async () => telegram));
    const ctrl = new MyChatController(chats, readerStub());
    await expect(ctrl.detail('c1', req(SUB))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('404s a missing chat', async () => {
    const { chats } = makeChats(jest.fn(async () => null));
    const ctrl = new MyChatController(chats, readerStub());
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
    const { chats } = makeChats(jest.fn(async () => OWNED));
    const ctrl = new MyChatController(chats, readerStub(read));
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
    const { chats } = makeChats(jest.fn(async () => OWNED));
    const ctrl = new MyChatController(chats, readerStub(read));
    await expect(
      ctrl.messages('c1', {}, req('someone-else')),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(read).not.toHaveBeenCalled();
  });

  it('returns an empty page when the file is unreadable', async () => {
    const read = jest.fn(async () => {
      throw new Error('gone');
    });
    const { chats } = makeChats(jest.fn(async () => OWNED));
    const ctrl = new MyChatController(chats, readerStub(read));
    const res = await ctrl.messages('c1', {}, req(SUB));
    expect(res).toEqual({ messages: [], nextCursor: null, hasMore: false });
  });
});
