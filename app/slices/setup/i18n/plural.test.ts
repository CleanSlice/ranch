import { describe, expect, test } from 'bun:test';
import { russianPlural } from './plural';

// Message order: zero | one | few | many.
const ZERO = 0;
const ONE = 1;
const FEW = 2;
const MANY = 3;

describe('russianPlural', () => {
  test('nothing has its own form', () => {
    expect(russianPlural(0, 4)).toBe(ZERO);
  });

  test('1, 2 to 4 and 5 to 20', () => {
    expect(russianPlural(1, 4)).toBe(ONE);
    for (const n of [2, 3, 4]) expect(russianPlural(n, 4)).toBe(FEW);
    for (const n of [5, 6, 9, 10, 11, 12, 13, 14, 15, 19, 20]) {
      expect(russianPlural(n, 4)).toBe(MANY);
    }
  });

  test('the last digit decides past twenty', () => {
    expect(russianPlural(21, 4)).toBe(ONE);
    expect(russianPlural(22, 4)).toBe(FEW);
    expect(russianPlural(25, 4)).toBe(MANY);
    expect(russianPlural(101, 4)).toBe(ONE);
    expect(russianPlural(1_002, 4)).toBe(FEW);
  });

  // The rule looked at the whole number for the teens, so only 11 to 19
  // themselves were caught: "1 013 вызова модели", "111 беседа" (CLEAN-265).
  test('the teens of every hundred take the form of many', () => {
    for (const n of [111, 112, 113, 114, 119, 211, 1_011, 1_013, 12_314]) {
      expect(russianPlural(n, 4)).toBe(MANY);
    }
  });

  test('a message with three forms uses the last for many', () => {
    expect(russianPlural(5, 3)).toBe(2);
    expect(russianPlural(1_013, 3)).toBe(2);
    expect(russianPlural(21, 3)).toBe(1);
  });
});
