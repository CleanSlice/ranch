import { describe, expect, test } from 'bun:test';
import { usageLineText } from './usageLine';

describe('usageLineText', () => {
  test('cost, the 30-day qualifier and the top model', () => {
    expect(usageLineText({ costUsd: 15.31 }, 'claude-haiku-4-5')).toBe(
      '$15.31 / 30d · claude-haiku-4-5',
    );
  });

  test('no model → no dangling separator', () => {
    expect(usageLineText({ costUsd: 15.31 }, null)).toBe('$15.31 / 30d');
    expect(usageLineText({ costUsd: 15.31 }, '')).toBe('$15.31 / 30d');
  });

  test('keeps formatUsd’s small-amount rules', () => {
    expect(usageLineText({ costUsd: 0.0042 }, 'x')).toBe('<$0.01 / 30d · x');
    expect(usageLineText({ costUsd: 0 }, null)).toBe('$0 / 30d');
  });
});
