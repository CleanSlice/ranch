// Twin of admin/slices/bridle/utils/interim.test.ts — change them together.
import { describe, expect, test } from 'bun:test';
import {
  BridleRoleTypes,
  BridleThinkingBlockStates,
  BridleThinkingStepStates,
  type IBridleMessage,
} from '../domain/bridle.types';
import {
  INTERIM_LABEL_MAX,
  foldReplayedInterim,
  interimStep,
  isReplayBlock,
  trailingBlock,
} from './interim';

const msg = (
  id: string,
  role: BridleRoleTypes,
  text: string,
  seq: number,
  interim?: true,
): IBridleMessage => ({
  id,
  role,
  text,
  ts: seq * 1000,
  seq,
  ...(interim ? { interim } : {}),
});
const { User, Agent } = BridleRoleTypes;

describe('interimStep — a narration bubble as a timeline step', () => {
  test('a one-line narration is the row, with nothing to open', () => {
    const step = interimStep({ id: 'w1', text: 'Let me check the spec deck.' });

    expect(step).toEqual({
      id: 'w1',
      label: 'Let me check the spec deck.',
      state: BridleThinkingStepStates.Done,
    });
  });

  test('a longer narration shows its first line and opens to the whole text', () => {
    const text = 'Two things to look up.\n\nFirst the trims, then the engines.';
    const step = interimStep({ id: 'w2', text });

    expect(step.label).toBe('Two things to look up.');
    expect(step.detail).toBe(text);
  });

  test('a long first line is cut for the row; the whole text stays in the detail', () => {
    const text = 'x'.repeat(INTERIM_LABEL_MAX + 20);
    const step = interimStep({ id: 'w3', text });

    expect(step.label.length).toBe(INTERIM_LABEL_MAX);
    expect(step.label.endsWith('…')).toBe(true);
    expect(step.detail).toBe(text);
  });
});

describe('foldReplayedInterim — replayed narration becomes a finished block', () => {
  test('a run of interim bubbles leaves the flow as one block in its place', () => {
    const { messages, blocks } = foldReplayedInterim([
      msg('q', User, 'how many trims?', 1),
      msg('w1', Agent, 'Let me check the spec deck.', 2, true),
      msg('w2', Agent, 'One more lookup.', 3, true),
      msg('w3', Agent, 'Eight trims.', 4),
    ]);

    expect(messages.map((m) => m.id)).toEqual(['q', 'w3']);
    expect(blocks.length).toBe(1);
    expect(blocks[0]?.seq).toBe(2);
    expect(blocks[0]?.state).toBe(BridleThinkingBlockStates.Done);
    expect(blocks[0]?.ts).toBe(2000);
    expect(isReplayBlock(blocks[0] as { turnId: string })).toBe(true);
    expect(blocks[0]?.steps.map((s) => [s.id, s.label, s.state])).toEqual([
      ['w1', 'Let me check the spec deck.', BridleThinkingStepStates.Done],
      ['w2', 'One more lookup.', BridleThinkingStepStates.Done],
    ]);
  });

  test('two turns with narration give two blocks, each under its own turn', () => {
    const { messages, blocks } = foldReplayedInterim([
      msg('q1', User, 'trims?', 1),
      msg('w1', Agent, 'Checking.', 2, true),
      msg('w2', Agent, 'Eight.', 3),
      msg('q2', User, 'engines?', 4),
      msg('w3', Agent, 'Looking.', 5, true),
      msg('w4', Agent, 'Two.', 6),
    ]);

    expect(messages.map((m) => m.id)).toEqual(['q1', 'w2', 'q2', 'w4']);
    expect(blocks.map((b) => b.seq)).toEqual([2, 5]);
  });

  test('a conversation without narration passes through untouched', () => {
    const source = [msg('q', User, 'hi', 1), msg('a', Agent, 'hello', 2)];
    const { messages, blocks } = foldReplayedInterim(source);

    expect(messages).toEqual(source);
    expect(blocks).toEqual([]);
  });
});

describe('trailingBlock — the segment below every message', () => {
  const block = (seq: number) => ({ seq });

  test('finds the block above the newest message', () => {
    expect(trailingBlock([{ seq: 1 }, { seq: 3 }], [block(2), block(4)])).toEqual(block(4));
  });

  test('is nothing when a message is the newest item', () => {
    expect(trailingBlock([{ seq: 1 }, { seq: 5 }], [block(2), block(4)])).toBe(null);
  });

  test('ignores a block that has no place in the flow yet', () => {
    expect(trailingBlock([{ seq: 1 }], [{ seq: undefined }])).toBe(null);
  });
});
