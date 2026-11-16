import { describe, expect, test } from 'bun:test';
import { formatCompact } from './agentFormat';

describe('formatCompact', () => {
  test('below a thousand the number is written as it is', () => {
    expect(formatCompact(0)).toBe('0');
    expect(formatCompact(52)).toBe('52');
    expect(formatCompact(999)).toBe('999');
  });

  test('three significant digits, trailing zeros dropped', () => {
    expect(formatCompact(1000)).toBe('1k');
    expect(formatCompact(1049)).toBe('1.05k');
    expect(formatCompact(3200)).toBe('3.2k');
    expect(formatCompact(12345)).toBe('12.3k');
    expect(formatCompact(106700)).toBe('107k');
    expect(formatCompact(1390000)).toBe('1.39M');
    expect(formatCompact(2400000)).toBe('2.4M');
    expect(formatCompact(10500000)).toBe('10.5M');
    expect(formatCompact(132600000)).toBe('133M');
    expect(formatCompact(2500000000)).toBe('2.5B');
  });

  test('a value that rounds up to a thousand moves to the next unit', () => {
    expect(formatCompact(999950)).toBe('1M');
    expect(formatCompact(999999999)).toBe('1B');
  });

  test('never more than three percent away from the number', () => {
    const samples = [1001, 1499, 1999, 14999, 149999, 1449999, 19999999];
    for (let i = 0; i < samples.length; i += 1) {
      const text = formatCompact(samples[i]!);
      const unit = text.slice(-1);
      const scale = unit === 'k' ? 1e3 : unit === 'M' ? 1e6 : 1e9;
      const shown = Number(text.slice(0, -1)) * scale;
      expect(Math.abs(shown - samples[i]!) / samples[i]! < 0.03).toBe(true);
    }
  });

  test('something that is not a number is empty, not NaN', () => {
    expect(formatCompact(Number.NaN)).toBe('');
  });
});
