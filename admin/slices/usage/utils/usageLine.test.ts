import { describe, expect, test } from 'bun:test';
import { usageLineText } from './usageLine';

describe('usageLineText', () => {
  test('cost, the 30-day qualifier and the model the agent runs now', () => {
    expect(usageLineText({ costUsd: 15.31 }, 'claude-haiku-5-5')).toBe(
      '$15.31 / 30d · claude-haiku-5-5',
    );
  });

  test('no model → no dangling separator', () => {
    // Either no LLM credential is assigned, or the credentials have not
    // arrived yet. The cost stands alone rather than borrowing the 30-day top
    // model to fill the gap — the confusion this replaced (CLEAN-149).
    expect(usageLineText({ costUsd: 15.31 }, null)).toBe('$15.31 / 30d');
    expect(usageLineText({ costUsd: 15.31 }, '')).toBe('$15.31 / 30d');
  });

  test('keeps formatUsd’s small-amount rules', () => {
    expect(usageLineText({ costUsd: 0.0042 }, 'x')).toBe('<$0.01 / 30d · x');
    expect(usageLineText({ costUsd: 0 }, null)).toBe('$0 / 30d');
  });

  test('the 30d qualifier belongs to the cost, not to the model', () => {
    // The line reads "$X over 30 days, running Y" — Y is current, not a
    // 30-day figure. The popover carries the 30-day top model separately.
    expect(usageLineText({ costUsd: 22.15 }, 'claude-haiku-5-5')).toBe(
      '$22.15 / 30d · claude-haiku-5-5',
    );
  });
});
