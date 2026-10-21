import { describe, expect, test } from 'bun:test';
import type { IChatSession } from '../domain/chat.types';
import { chatCountLabel, chatUser, groupByDay, isConversation, shownId } from './chatList';

function session(over: Partial<IChatSession> & { id: string }): IChatSession {
  return {
    agentId: 'a1',
    channel: 'bridle',
    externalUserId: 'anon-5c686f13',
    sessionKey: over.id,
    title: null,
    preview: null,
    lastRole: null,
    lastMessageAt: '2026-10-19T15:52:00.000Z',
    messageCount: 2,
    userMessageCount: 1,
    summary: null,
    summaryAt: null,
    insights: null,
    archived: false,
    createdAt: '2026-10-19T15:52:00.000Z',
    updatedAt: '2026-10-19T15:52:00.000Z',
    ...over,
  };
}

describe('chatUser', () => {
  test('reads the kind off the client id', () => {
    expect(chatUser(session({ id: 'c', externalUserId: 'admin' }))).toEqual({
      kind: 'admin',
      label: 'Admin',
      id: '',
      fullId: 'admin',
    });
    expect(chatUser(session({ id: 'c', externalUserId: 'share-HiCGk8yDv35g8zjBsOQQF9' }))).toEqual({
      kind: 'share',
      label: 'Share link',
      id: 'HiCGk8yDv35g8zjBsOQQF9',
      fullId: 'share-HiCGk8yDv35g8zjBsOQQF9',
    });
    expect(chatUser(session({ id: 'c', externalUserId: 'anon-5c686f13' })).label).toBe('Anonymous');
    expect(chatUser(session({ id: 'c', externalUserId: 'http-run-1' })).kind).toBe('machine');
    expect(chatUser(session({ id: 'c', externalUserId: 'sync-run-1' })).kind).toBe('machine');
  });

  test('a bridle id that is none of those is a web visitor, titled when the session is', () => {
    expect(chatUser(session({ id: 'c', externalUserId: 'V55576487' }))).toEqual({
      kind: 'visitor',
      label: 'Web visitor',
      id: 'V55576487',
      fullId: 'V55576487',
    });
    expect(chatUser(session({ id: 'c', externalUserId: 'x1', title: 'Demo' })).label).toBe('Demo');
  });

  test('telegram and slack carry their title, the channel name without one', () => {
    expect(chatUser(session({ id: 'c', channel: 'telegram', title: 'Family group' })).label).toBe('Family group');
    expect(chatUser(session({ id: 'c', channel: 'telegram', title: null })).label).toBe('Telegram');
    expect(chatUser(session({ id: 'c', channel: 'slack', title: 'jane' })).kind).toBe('slack');
  });

  test('the internal channel wins over the id', () => {
    expect(chatUser(session({ id: 'c', channel: 'internal', externalUserId: 'admin' })).kind).toBe('internal');
  });
});

describe('shownId', () => {
  test('keeps a slug, drops a prefix, cuts a uuid', () => {
    expect(shownId('easy-kids-j4fjrszg10pz')).toBe('easy-kids-j4fjrszg10pz');
    expect(shownId('smooth-teams-awew8vx7se4p')).toBe('smooth-teams-awew8vx7se4p');
    expect(shownId('anon-5c686f13')).toBe('5c686f13');
    expect(shownId('ea05aa4f-1b2c-4d5e-8f90-123456789abc')).toBe('ea05aa4f…');
    expect(shownId('share-HiCGk8yDv35g8zjBsOQQF9')).toBe('HiCGk8yDv35g8zjBsOQQF9');
    expect(shownId('anon-ea05aa4f-1b2c-4d5e-8f90-123456789abc')).toBe('ea05aa4f…');
  });
});

describe('groupByDay', () => {
  test('folds consecutive same-day sessions, keeps the order, counts each day', () => {
    const d = (day: number, hour: number) => new Date(2026, 9, day, hour, 0).toISOString();
    const rows = [
      session({ id: 'a', lastMessageAt: d(19, 19) }),
      session({ id: 'b', lastMessageAt: d(19, 15) }),
      session({ id: 'c', lastMessageAt: d(15, 22) }),
      session({ id: 'd', lastMessageAt: d(13, 18) }),
      session({ id: 'e', lastMessageAt: d(13, 10) }),
    ];
    const groups = groupByDay(rows);
    expect(groups.map((g) => [g.key, g.sessions.map((s) => s.id)])).toEqual([
      ['2026-10-19', ['a', 'b']],
      ['2026-10-15', ['c']],
      ['2026-10-13', ['d', 'e']],
    ]);
    expect(groups[0].at).toBe(d(19, 19));
  });

  test('nothing in, nothing out', () => {
    expect(groupByDay([])).toEqual([]);
  });
});

describe('labels', () => {
  test('a conversation is more than one exchange', () => {
    expect(isConversation(session({ id: 'c', messageCount: 2 }))).toBe(false);
    expect(isConversation(session({ id: 'c', messageCount: 3 }))).toBe(true);
  });

  test('chat count', () => {
    expect(chatCountLabel(1)).toBe('1 chat');
    expect(chatCountLabel(10)).toBe('10 chats');
  });
});
