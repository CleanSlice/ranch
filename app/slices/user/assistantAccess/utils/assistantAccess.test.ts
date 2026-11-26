import { describe, expect, test } from 'bun:test';
import { badgeCardShift } from './assistantAccess';

describe('where the person’s own card hangs', () => {
  test('from the badge while it fits', () => {
    expect(badgeCardShift(24, 1440, 288)).toBe(0);
    expect(badgeCardShift(16, 390, 288)).toBe(0);
  });

  test('moved left on a phone, as far as it takes and no further', () => {
    // 390 wide, badge at 200: the card would end at 488.
    const shift = badgeCardShift(200, 390, 288);
    expect(shift).toBe(-114);
    expect(200 + shift + 288).toBe(390 - 16);
  });

  test('never past the left gutter, on a screen narrower than the card', () => {
    const width = 320 - 32;
    const shift = badgeCardShift(250, 320, width);
    expect(250 + shift).toBe(16);
    expect(250 + shift + width).toBe(320 - 16);
  });
});
