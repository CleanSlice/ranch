import { describe, expect, test } from 'bun:test';
import { MAX_SLOT_MARKS, slotScale } from './slotScale';

const cap = (usedAgentSlots: number, totalAgentSlots: number) => ({
  usedAgentSlots,
  totalAgentSlots,
});

describe('slotScale', () => {
  test('nothing to draw without capacity', () => {
    expect(slotScale(null)).toBe(null);
    expect(slotScale(undefined)).toBe(null);
  });

  test('nothing to draw for a cluster with no slots', () => {
    expect(slotScale(cap(0, 0))).toBe(null);
    expect(slotScale(cap(3, -1))).toBe(null);
  });

  test('one mark per slot up to the limit', () => {
    expect(slotScale(cap(14, 20))).toEqual({ kind: 'marks', used: 14, total: 20 });
    expect(slotScale(cap(0, MAX_SLOT_MARKS))).toEqual({
      kind: 'marks',
      used: 0,
      total: MAX_SLOT_MARKS,
    });
  });

  test('a single bar above the limit, filled by share', () => {
    expect(slotScale(cap(41, 82))).toEqual({
      kind: 'bar',
      used: 41,
      total: 82,
      ratio: 0.5,
    });
    expect(slotScale(cap(0, MAX_SLOT_MARKS + 1))).toEqual({
      kind: 'bar',
      used: 0,
      total: MAX_SLOT_MARKS + 1,
      ratio: 0,
    });
  });

  test('used is kept inside the scale', () => {
    expect(slotScale(cap(25, 20))).toEqual({ kind: 'marks', used: 20, total: 20 });
    expect(slotScale(cap(-3, 20))).toEqual({ kind: 'marks', used: 0, total: 20 });
  });
});
