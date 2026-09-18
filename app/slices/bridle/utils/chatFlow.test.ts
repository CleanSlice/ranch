import { describe, expect, test } from 'bun:test';
import {
  BridleRoleTypes,
  BridleThinkingBlockStates,
  type IBridleMessage,
  type IBridleThinkingBlock,
} from '../domain/bridle.types';
import { buildChatFlow, nextSeq, numberLegacy } from './chatFlow';

// Local-time constructors throughout, so the day arithmetic holds in whatever
// timezone the test machine runs.
const NOON = new Date(2026, 8, 18, 12, 0, 0).getTime();
const options = { locale: 'en-US', now: NOON };

function message(
  id: string,
  role: BridleRoleTypes,
  ts: number,
  seq?: number,
): IBridleMessage {
  return { id, role, text: id, ts, ...(seq === undefined ? {} : { seq }) };
}

function block(turnId: string, ts: number, seq?: number): IBridleThinkingBlock {
  return {
    turnId,
    seg: 0,
    steps: [],
    state: BridleThinkingBlockStates.Done,
    ts,
    ...(seq === undefined ? {} : { seq }),
  };
}

const keys = (flow: ReturnType<typeof buildChatFlow>) => flow.map((i) => i.key);

describe('buildChatFlow', () => {
  test('a reply stamped two minutes before its question still renders after it', () => {
    // The browser clock runs ahead of the agent's: the defect behind CLEAN-102.
    const flow = buildChatFlow(
      [
        message('question', BridleRoleTypes.User, NOON, 1),
        message('answer', BridleRoleTypes.Agent, NOON - 120_000, 3),
      ],
      [block('turn', NOON - 121_000, 2)],
      options,
    );
    expect(keys(flow)).toEqual(['question', 'turn:0', 'answer']);
  });

  test('equal ts keeps arrival order', () => {
    const flow = buildChatFlow(
      [
        message('b', BridleRoleTypes.Agent, NOON, 2),
        message('a', BridleRoleTypes.User, NOON, 1),
        message('c', BridleRoleTypes.Agent, NOON, 3),
      ],
      [],
      options,
    );
    expect(keys(flow)).toEqual(['a', 'b', 'c']);
  });

  test('legacy messages without seq render in stored order', () => {
    // Stored order is the order the person saw, whatever the timestamps say.
    const flow = buildChatFlow(
      [
        message('first', BridleRoleTypes.User, NOON),
        message('second', BridleRoleTypes.Agent, NOON - 5_000),
        message('third', BridleRoleTypes.User, NOON + 1_000),
      ],
      [],
      options,
    );
    expect(keys(flow)).toEqual(['first', 'second', 'third']);
    expect(flow.map((i) => i.seq)).toEqual([1, 2, 3]);
  });

  test('a conversation that happened today has no separator', () => {
    const flow = buildChatFlow(
      [
        message('a', BridleRoleTypes.User, NOON - 3_600_000, 1),
        message('b', BridleRoleTypes.Agent, NOON, 2),
      ],
      [],
      options,
    );
    expect(flow.every((i) => i.kind === 'message')).toBe(true);
  });

  test('a day boundary between two messages inserts a separator before the later one', () => {
    const yesterday = new Date(2026, 8, 17, 23, 50).getTime();
    const flow = buildChatFlow(
      [
        message('old', BridleRoleTypes.User, yesterday, 1),
        message('new', BridleRoleTypes.User, NOON, 3),
      ],
      [block('turn', NOON, 2)],
      options,
    );
    // The block that led to the later message stays above the separator's
    // message, and the separator sits directly on top of that message.
    expect(keys(flow)).toEqual(['day:old', 'old', 'turn:0', 'day:new', 'new']);
    const [first, , , second] = flow;
    expect(first).toMatchObject({ kind: 'day', labelKey: 'chat.day_yesterday' });
    expect(second).toMatchObject({
      kind: 'day',
      labelKey: 'chat.day_today',
      seq: 3,
    });
  });

  test('older days carry a date formatted for the locale', () => {
    const old = new Date(2026, 2, 5, 9, 30).getTime();
    const [separator] = buildChatFlow(
      [message('old', BridleRoleTypes.User, old, 1)],
      [],
      options,
    );
    expect(separator).toMatchObject({ kind: 'day', label: 'March 5, 2026' });
    expect(separator).not.toHaveProperty('labelKey');

    const [ru] = buildChatFlow([message('old', BridleRoleTypes.User, old, 1)], [], {
      ...options,
      locale: 'ru',
    });
    expect(ru).toMatchObject({ kind: 'day', label: '5 марта 2026 г.' });
  });
});

describe('nextSeq', () => {
  test('starts at 1 and continues past the highest seq in use', () => {
    expect(nextSeq([])).toBe(1);
    expect(nextSeq([{ seq: 4 }, { seq: 9 }, {}])).toBe(10);
  });
});

describe('numberLegacy', () => {
  test('numbers only the items that lack a seq, after the ones that have one', () => {
    const numbered = numberLegacy([{ id: 'a', seq: 7 }, { id: 'b' }, { id: 'c' }]);
    expect(numbered).toEqual([
      { id: 'a', seq: 7 },
      { id: 'b', seq: 8 },
      { id: 'c', seq: 9 },
    ]);
  });

  test('leaves already numbered items as the same objects', () => {
    const item = { id: 'a', seq: 1 };
    expect(numberLegacy([item])[0]).toBe(item);
  });
});
