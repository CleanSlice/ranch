import { estimateTokens } from './tokens';

// The same three fixtures live in admin/slices/skill/utils/tokens.test.ts:
// the library summary (server) and the editor counter (browser) must agree.
describe('estimateTokens', () => {
  it('is 0 for an empty body', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('rounds up a partial token', () => {
    expect(estimateTokens('1234567')).toBe(2);
  });

  it('is chars / 4 on a whole number of tokens', () => {
    expect(estimateTokens('x'.repeat(4000))).toBe(1000);
  });
});
