import { describe, expect, test } from 'bun:test';
import { formatTokens } from './formatTokens';

describe('formatTokens', () => {
  test('plain below a thousand', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(880)).toBe('880');
  });

  test('one decimal in the thousands, trailing .0 dropped', () => {
    expect(formatTokens(1700)).toBe('1.7k');
    expect(formatTokens(2000)).toBe('2k');
    expect(formatTokens(18_940)).toBe('18.9k');
  });

  test('no decimal from a hundred thousand', () => {
    expect(formatTokens(120_400)).toBe('120k');
  });

  test('never negative or fractional', () => {
    expect(formatTokens(-5)).toBe('0');
    expect(formatTokens(999.6)).toBe('1k');
  });
});
