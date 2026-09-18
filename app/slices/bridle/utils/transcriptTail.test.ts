import { describe, expect, test } from 'bun:test';
import {
  BridleDeliveryStates,
  BridleRoleTypes,
  type IBridleMessage,
} from '../domain/bridle.types';
import { missedReplies } from './transcriptTail';

const user = (id: string, text: string, ts = 0): IBridleMessage => ({
  id,
  role: BridleRoleTypes.User,
  text,
  ts,
});
const agent = (id: string, text: string, ts = 0): IBridleMessage => ({
  id,
  role: BridleRoleTypes.Agent,
  text,
  ts,
});

describe('missedReplies', () => {
  test('returns the answer the screen never received', () => {
    const missed = missedReplies(
      [user('u1', 'hello'), agent('a1', 'hi'), user('u2', 'and the report?')],
      [
        user('t1', 'hello'),
        agent('t2', 'hi'),
        user('t3', 'and the report?'),
        agent('t4', 'Here it is.'),
      ],
    );
    expect(missed.map((m) => m.id)).toEqual(['t4']);
  });

  test('ignores clocks: an answer stamped before the question is still news', () => {
    // Browser two minutes ahead of the agent — the skew behind CLEAN-102.
    const missed = missedReplies(
      [user('u1', 'ping', 1_000_000)],
      [user('t1', 'ping', 880_000), agent('t2', 'pong', 881_000)],
    );
    expect(missed.map((m) => m.id)).toEqual(['t2']);
  });

  test('nothing when the transcript has no answer after the question', () => {
    expect(
      missedReplies([user('u1', 'ping')], [user('t1', 'ping')]),
    ).toEqual([]);
  });

  test('nothing when the question is not in the tail at all', () => {
    expect(
      missedReplies(
        [user('u1', 'ping')],
        [user('t1', 'something else'), agent('t2', 'an old answer')],
      ),
    ).toEqual([]);
  });

  test('nothing for an empty screen', () => {
    expect(missedReplies([], [agent('t1', 'hello')])).toEqual([]);
  });

  test('a question that failed to send does not anchor the search', () => {
    const missed = missedReplies(
      [
        user('u1', 'first'),
        {
          ...user('u2', 'never left the browser'),
          delivery: BridleDeliveryStates.Failed,
        },
      ],
      [user('t1', 'first'), agent('t2', 'answer to first')],
    );
    expect(missed.map((m) => m.id)).toEqual(['t2']);
  });

  test('an answer already on screen is not added again, whitespace aside', () => {
    expect(
      missedReplies(
        [user('u1', 'ping'), agent('a1', 'pong\n')],
        [user('t1', 'ping'), agent('t2', ' pong')],
      ),
    ).toEqual([]);
  });

  test('a fused turn that starts with what is on screen is not news', () => {
    // Live: two bubbles. Transcript: one event with both glued together.
    expect(
      missedReplies(
        [user('u1', 'ping'), agent('a1', 'Let me check:'), agent('a2', 'Pong!')],
        [user('t1', 'ping'), agent('t2', 'Let me check:Pong!')],
      ),
    ).toEqual([]);
  });

  test('the same wording earlier in the conversation does not hide a new answer', () => {
    const missed = missedReplies(
      [user('u1', 'save it'), agent('a1', 'Done.'), user('u2', 'and this one')],
      [
        user('t1', 'save it'),
        agent('t2', 'Done.'),
        user('t3', 'and this one'),
        agent('t4', 'Done.'),
      ],
    );
    expect(missed.map((m) => m.id)).toEqual(['t4']);
  });

  test('a transcript event whose id is already on screen is skipped', () => {
    expect(
      missedReplies(
        [user('u1', 'ping'), agent('same-id', 'pong (edited)')],
        [user('t1', 'ping'), agent('same-id', 'pong')],
      ),
    ).toEqual([]);
  });
});
