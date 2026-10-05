import { describe, expect, test } from 'bun:test';
import {
  BridleDeliveryStates,
  BridleRoleTypes,
  type IBridleMessage,
  type IBridleTranscriptPage,
} from '../domain/bridle.types';
import {
  PERSISTED_MATCH_WINDOW_MS,
  UNSAVED_KEEP_MS,
  mergeTranscript,
} from './transcriptMerge';

// One clock for every case: the page's newest message is "a minute ago".
const NOW = 1_800_000_000_000;
const MINUTE = 60_000;
const at = (minutesAgo: number) => NOW - minutesAgo * MINUTE;

const user = (
  id: string,
  text: string,
  ts: number,
  extra: Partial<IBridleMessage> = {},
): IBridleMessage => ({ id, role: BridleRoleTypes.User, text, ts, ...extra });
const agent = (
  id: string,
  text: string,
  ts: number,
  extra: Partial<IBridleMessage> = {},
): IBridleMessage => ({ id, role: BridleRoleTypes.Agent, text, ts, ...extra });

const page = (messages: IBridleMessage[]): IBridleTranscriptPage => ({
  messages,
  nextCursor: null,
  hasMore: false,
});

const ids = (list: IBridleMessage[]) => list.map((m) => m.id);
const inOrder = (list: IBridleMessage[]) => {
  for (let i = 1; i < list.length; i++) {
    if ((list[i]?.seq ?? 0) <= (list[i - 1]?.seq ?? 0)) return false;
  }
  return true;
};

// The transcript stores ids of its own (the runtime does not keep the wire
// id), so "the same message" has different ids on screen and in the page.
const SERVER = [
  user('t1', 'hello', at(5)),
  agent('t2', 'hi there', at(5)),
  user('t3', 'and the report?', at(1)),
  agent('t4', 'attached', at(1)),
];

describe('mergeTranscript — the server is the conversation', () => {
  test('an empty screen becomes the page, in the page’s order', () => {
    const { messages } = mergeTranscript([], page(SERVER), NOW);

    expect(ids(messages)).toEqual(['t1', 't2', 't3', 't4']);
    expect(inOrder(messages)).toBe(true);
  });

  test('a screen that already shows the page shows each message once', () => {
    const local = [
      user('u1', 'hello', at(5), { seq: 1, cached: true }),
      agent('a1', 'hi there', at(5), { seq: 2, cached: true }),
      user('u2', 'and the report?', at(1), { seq: 3, cached: true }),
      agent('a2', 'attached', at(1), { seq: 4, cached: true }),
    ];

    const { messages } = mergeTranscript(local, page(SERVER), NOW);

    expect(ids(messages)).toEqual(['t1', 't2', 't3', 't4']);
  });

  test('brings in the person’s messages written somewhere else', () => {
    // What the console used to show: answers with no questions above them.
    const local = [agent('a1', 'hi there', at(5), { seq: 1, cached: true })];

    const { messages } = mergeTranscript(local, page(SERVER), NOW);

    expect(messages.filter((m) => m.role === BridleRoleTypes.User).length).toBe(
      2,
    );
    expect(ids(messages)).toEqual(['t1', 't2', 't3', 't4']);
  });

  test('a message with the page’s own id is not shown twice', () => {
    const local = [agent('t4', 'attached', at(1), { seq: 7 })];

    const { messages } = mergeTranscript(local, page(SERVER), NOW);

    expect(ids(messages)).toEqual(['t1', 't2', 't3', 't4']);
  });

  test('does not change what it was given', () => {
    const local = [user('u1', 'hello', at(5), { seq: 1 })];
    const server = page(SERVER);

    mergeTranscript(local, server, NOW);

    expect(local).toEqual([user('u1', 'hello', at(5), { seq: 1 })]);
    expect(ids(server.messages)).toEqual(['t1', 't2', 't3', 't4']);
    expect(server.messages[0]?.seq).toBe(undefined);
  });
});

describe('mergeTranscript — what the server does not hold yet stays', () => {
  test('a message still on its way stays, below the page, with its state', () => {
    const local = [
      user('u9', 'one more thing', at(0), {
        seq: 9,
        delivery: BridleDeliveryStates.Sending,
      }),
    ];

    const { messages } = mergeTranscript(local, page(SERVER), NOW);

    expect(ids(messages)).toEqual(['t1', 't2', 't3', 't4', 'u9']);
    expect(messages[4]?.delivery).toBe(BridleDeliveryStates.Sending);
    expect(inOrder(messages)).toBe(true);
  });

  test('a message that was not delivered stays however old it is', () => {
    const local = [
      user('u0', 'never left', at(600), {
        seq: 1,
        cached: true,
        delivery: BridleDeliveryStates.Failed,
        failureCode: 'OFFLINE',
      }),
    ];

    const { messages } = mergeTranscript(local, page(SERVER), NOW);

    expect(ids(messages)).toEqual(['t1', 't2', 't3', 't4', 'u0']);
    expect(messages[4]?.failureCode).toBe('OFFLINE');
  });

  test('an answer still being written stays', () => {
    const local = [agent('a9', 'typing th', at(10), { seq: 9, streaming: true })];

    const { messages } = mergeTranscript(local, page(SERVER), NOW);

    expect(ids(messages)).toEqual(['t1', 't2', 't3', 't4', 'a9']);
    expect(messages[4]?.streaming).toBe(true);
  });

  test('an answer newer than the page’s newest message stays', () => {
    const local = [agent('a9', 'one more answer', at(0), { seq: 9 })];

    const { messages } = mergeTranscript(local, page(SERVER), NOW);

    expect(ids(messages)).toEqual(['t1', 't2', 't3', 't4', 'a9']);
  });

  test('an answer at or before the page’s newest message is the page’s', () => {
    const local = [agent('a1', 'worded differently', at(1), { seq: 9 })];

    const { messages } = mergeTranscript(local, page(SERVER), NOW);

    expect(ids(messages)).toEqual(['t1', 't2', 't3', 't4']);
  });

  test('a delivered question the page has not saved yet stays', () => {
    const local = [user('u9', 'just asked', at(0), { seq: 9 })];

    const { messages } = mergeTranscript(local, page(SERVER), NOW);

    expect(ids(messages)).toEqual(['t1', 't2', 't3', 't4', 'u9']);
  });

  test('a delivered question older than the page reaches belongs to an older page', () => {
    const local = [user('u0', 'from last week', at(600), { seq: 1 })];

    const { messages } = mergeTranscript(local, page(SERVER), NOW);

    expect(ids(messages)).toEqual(['t1', 't2', 't3', 't4']);
  });

  test('the kept tail keeps its numbers, and the page sorts above it', () => {
    const local = [
      user('u8', 'just asked', at(0), { seq: 41 }),
      agent('a9', 'answering', at(0), { seq: 43, streaming: true }),
    ];

    const { messages } = mergeTranscript(local, page(SERVER), NOW);

    expect(messages[4]?.seq).toBe(41);
    expect(messages[5]?.seq).toBe(43);
    expect((messages[3]?.seq ?? 99) < 41).toBe(true);
    expect(inOrder(messages)).toBe(true);
  });
});

describe('mergeTranscript — the same words twice', () => {
  test('two identical questions, one saved: the other one stays', () => {
    const server = page([
      user('t1', 'ok', at(4)),
      agent('t2', 'noted', at(4)),
    ]);
    const local = [
      user('u1', 'ok', at(4), { seq: 1 }),
      agent('a1', 'noted', at(4), { seq: 2 }),
      user('u2', 'ok', at(3), { seq: 3 }),
    ];

    const { messages } = mergeTranscript(local, server, NOW);

    expect(ids(messages)).toEqual(['t1', 't2', 'u2']);
  });

  test('two identical questions, both saved: two, not three', () => {
    const server = page([
      user('t1', 'ok', at(4)),
      agent('t2', 'noted', at(4)),
      user('t3', 'ok', at(1)),
    ]);
    const local = [
      user('u1', 'ok', at(4), { seq: 1 }),
      user('u2', 'ok', at(1), { seq: 3 }),
    ];

    const { messages } = mergeTranscript(local, server, NOW);

    expect(ids(messages)).toEqual(['t1', 't2', 't3']);
  });

  test('the same words far apart in time are different messages', () => {
    const far = PERSISTED_MATCH_WINDOW_MS + MINUTE;
    const server = page([user('t1', 'ok', NOW - 2 * far)]);
    const local = [user('u2', 'ok', NOW - far + MINUTE, { seq: 3 })];

    const { messages } = mergeTranscript(local, server, NOW);

    expect(ids(messages)).toEqual(['t1', 'u2']);
  });
});

describe('mergeTranscript — the copy this browser kept', () => {
  const OLD = NOW - UNSAVED_KEEP_MS - MINUTE;
  const FRESH = NOW - MINUTE;

  test('a stored conversation the server no longer has was closed: it goes', () => {
    // Reset on another device while this one was switched off.
    const local = [
      user('u1', 'hello', OLD, { seq: 1, cached: true }),
      agent('a1', 'hi there', OLD, { seq: 2, cached: true }),
    ];

    const { messages } = mergeTranscript(local, page([]), NOW);

    expect(messages).toEqual([]);
  });

  test('a stored exchange too fresh to have been saved stays', () => {
    const local = [
      user('u1', 'hello', FRESH, { seq: 1, cached: true }),
      agent('a1', 'hi there', FRESH, { seq: 2, cached: true }),
    ];

    const { messages } = mergeTranscript(local, page([]), NOW);

    expect(ids(messages)).toEqual(['u1', 'a1']);
  });

  test('what this session saw itself is never dropped for being old', () => {
    const local = [user('u1', 'hello', OLD, { seq: 1 })];

    const { messages } = mergeTranscript(local, page([]), NOW);

    expect(ids(messages)).toEqual(['u1']);
  });

  test('a new conversation started elsewhere replaces the stored one', () => {
    const local = [
      user('u1', 'old question', OLD, { seq: 1, cached: true }),
      agent('a1', 'old answer', OLD, { seq: 2, cached: true }),
    ];
    const server = page([user('t1', 'new question', at(1))]);

    const { messages } = mergeTranscript(local, server, NOW);

    expect(ids(messages)).toEqual(['t1']);
  });
});

describe('mergeTranscript — when there is no page', () => {
  test('a failed load changes nothing on screen', () => {
    const local = [
      user('u1', 'hello', at(900), { seq: 1, cached: true }),
      agent('a1', 'hi there', at(900), { seq: 2, cached: true }),
    ];

    const { messages, cutSeq } = mergeTranscript(local, null, NOW);

    expect(messages).toEqual(local);
    expect(cutSeq).toBe(null);
  });
});

describe('mergeTranscript — proposal cards', () => {
  const card = (status: string) =>
    ({ id: 'p1', status }) as unknown as IBridleMessage['proposal'];

  test('a card on screen and in the page is one card, with the page’s state', () => {
    const local = [
      agent('proposal:p1', '', at(2), { seq: 5, proposal: card('pending') }),
    ];
    const server = page([
      user('t1', 'change the prompt', at(3)),
      agent('proposal:p1', '', at(2), { proposal: card('applied') }),
    ]);

    const { messages } = mergeTranscript(local, server, NOW);

    expect(ids(messages)).toEqual(['t1', 'proposal:p1']);
    expect(
      (messages[1]?.proposal as unknown as { status: string }).status,
    ).toBe('applied');
  });
});

describe('mergeTranscript — which thinking blocks are history now', () => {
  test('reports the last local position the page took over', () => {
    const local = [
      user('u1', 'hello', at(5), { seq: 1 }),
      agent('a1', 'hi there', at(5), { seq: 3 }),
      user('u9', 'just asked', at(0), { seq: 6 }),
    ];

    const { cutSeq } = mergeTranscript(local, page(SERVER), NOW);

    // u1 and a1 are the page's now; anything the session drew at or above
    // position 3 belonged to a turn that is plain transcript.
    expect(cutSeq).toBe(3);
  });

  test('reports nothing when the page took nothing over', () => {
    const local = [user('u9', 'just asked', at(0), { seq: 6 })];

    const { cutSeq } = mergeTranscript(local, page(SERVER), NOW);

    expect(cutSeq).toBe(null);
  });
});
