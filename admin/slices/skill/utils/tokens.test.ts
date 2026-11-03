import { describe, expect, test } from 'bun:test';
import { countLines, estimateTokens } from './tokens';

// Same fixtures as api/src/slices/skill/domain/tokens.spec.ts.
describe('estimateTokens', () => {
  test('is 0 for an empty body', () => {
    expect(estimateTokens('')).toBe(0);
  });

  test('rounds up a partial token', () => {
    expect(estimateTokens('1234567')).toBe(2);
  });

  test('is chars / 4 on a whole number of tokens', () => {
    expect(estimateTokens('x'.repeat(4000))).toBe(1000);
  });
});

describe('countLines', () => {
  test('counts lines, ignoring one trailing newline', () => {
    expect(countLines('')).toBe(0);
    expect(countLines('one')).toBe(1);
    expect(countLines('one\ntwo')).toBe(2);
    expect(countLines('one\ntwo\n')).toBe(2);
  });
});
