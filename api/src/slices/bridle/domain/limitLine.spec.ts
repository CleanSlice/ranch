import { limitFallbackLine } from './limitLine';

const PREFIX = 'This agent has reached its message limit. Try again in about ';

/** Just the wait: "50 seconds", "12 minutes". */
const wait = (ms: number) => {
  const line = limitFallbackLine(ms);
  return line.slice(PREFIX.length, line.length - 1);
};

describe('limitFallbackLine', () => {
  it('names the agent limit and when to try again', () => {
    expect(limitFallbackLine(42_000)).toBe(
      'This agent has reached its message limit. Try again in about 50 seconds.',
    );
  });

  it('rounds seconds up to the next ten, so the line is still true a moment later', () => {
    expect(wait(1)).toBe('10 seconds');
    expect(wait(10_000)).toBe('10 seconds');
    expect(wait(10_001)).toBe('20 seconds');
    expect(wait(49_500)).toBe('50 seconds');
    expect(wait(51_000)).toBe('60 seconds');
  });

  it('rounds minutes up to the next whole one', () => {
    expect(wait(60_000)).toBe('1 minute');
    expect(wait(60_001)).toBe('2 minutes');
    expect(wait(11 * 60_000 + 5_000)).toBe('12 minutes');
    expect(wait(59 * 60_000 + 1)).toBe('60 minutes');
  });

  it('rounds hours up to the next whole one', () => {
    expect(wait(60 * 60_000)).toBe('1 hour');
    expect(wait(60 * 60_000 + 1_000)).toBe('2 hours');
    expect(wait(23.5 * 60 * 60_000)).toBe('24 hours');
  });

  it('never states a wait shorter than the real one', () => {
    const unit: Record<string, number> = {
      second: 1_000,
      seconds: 1_000,
      minute: 60_000,
      minutes: 60_000,
      hour: 3_600_000,
      hours: 3_600_000,
    };
    for (const ms of [
      1, 999, 9_999, 59_999, 61_000, 3_599_000, 3_601_000, 80_000_000,
    ]) {
      const [n, u] = wait(ms).split(' ');
      expect(Number(n) * unit[u]).toBeGreaterThanOrEqual(ms);
    }
  });
});
