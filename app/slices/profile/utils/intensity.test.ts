import { describe, expect, test } from 'bun:test';
import { INTENSITY_LEVELS, intensityLevel } from './intensity';

describe('intensityLevel', () => {
  test('five levels', () => {
    expect(INTENSITY_LEVELS).toBe(5);
  });

  test('a day without conversations is level 0', () => {
    expect(intensityLevel(0)).toBe(0);
  });

  test('one and two conversations have a level each', () => {
    expect(intensityLevel(1)).toBe(1);
    expect(intensityLevel(2)).toBe(2);
  });

  test('three and four share level 3', () => {
    expect(intensityLevel(3)).toBe(3);
    expect(intensityLevel(4)).toBe(3);
  });

  test('five and anything above is level 4', () => {
    expect(intensityLevel(5)).toBe(4);
    expect(intensityLevel(50)).toBe(4);
  });

  test('a count that is not one is an empty day', () => {
    expect(intensityLevel(-3)).toBe(0);
    expect(intensityLevel(Number.NaN)).toBe(0);
  });
});
