import { describe, expect, test } from 'bun:test';
import { MAX_SPRING_DT, springAtRest, stepSpring } from './spring';

// The pass's own swing: 0.95 s period, lightly damped.
const swing = { omega: (2 * Math.PI) / 0.95, damping: 0.14 };

/** Runs the spring at 60 fps and returns the peaks of |value|. */
function peaks(start: number, seconds: number, params = swing): number[] {
  let state = { value: start, velocity: 0 };
  const out: number[] = [Math.abs(start)];
  let prevVelocity = 0;
  for (let t = 0; t < seconds; t += 1 / 60) {
    state = stepSpring(state, 0, 1 / 60, params);
    // A peak is where the velocity changes sign.
    if (prevVelocity !== 0 && Math.sign(state.velocity) !== Math.sign(prevVelocity)) {
      out.push(Math.abs(state.value));
    }
    prevVelocity = state.velocity;
  }
  return out;
}

describe('stepSpring', () => {
  test('at rest on the target, nothing changes', () => {
    const next = stepSpring({ value: 3, velocity: 0 }, 3, 1 / 60, swing);
    expect(next).toEqual({ value: 3, velocity: 0 });
  });

  test('does not touch the state it was given', () => {
    const state = { value: -7, velocity: 0 };
    stepSpring(state, 0, 1 / 60, swing);
    expect(state).toEqual({ value: -7, velocity: 0 });
  });

  test('a zero or negative step is no step', () => {
    expect(stepSpring({ value: -7, velocity: 2 }, 0, 0, swing)).toEqual({
      value: -7,
      velocity: 2,
    });
    expect(stepSpring({ value: -7, velocity: 2 }, 0, -1, swing)).toEqual({
      value: -7,
      velocity: 2,
    });
  });

  test('moves towards the target and swings past it', () => {
    let state = { value: -7, velocity: 0 };
    state = stepSpring(state, 0, 0.1, swing);
    expect(state.value > -7).toBe(true);
    expect(state.velocity > 0).toBe(true);
    // Half a period later it is on the other side.
    state = stepSpring({ value: -7, velocity: 0 }, 0, 0.24, swing);
    state = stepSpring(state, 0, 0.24, swing);
    expect(state.value > 0).toBe(true);
  });

  test('every swing is smaller than the one before', () => {
    const p = peaks(-7, 4);
    expect(p.length >= 5).toBe(true);
    for (let i = 1; i < p.length; i++) {
      expect((p[i] as number) < (p[i - 1] as number)).toBe(true);
    }
    // Roughly the brief's -7 → +4.5 → -2.8 → +1.7.
    expect((p[1] as number) > 3.9 && (p[1] as number) < 5).toBe(true);
    expect((p[2] as number) > 2.3 && (p[2] as number) < 3.3).toBe(true);
  });

  test('the result does not depend on the frame rate', () => {
    let fast = { value: -7, velocity: 0 };
    for (let i = 0; i < 120; i++) fast = stepSpring(fast, 0, 1 / 120, swing);
    let slow = { value: -7, velocity: 0 };
    for (let i = 0; i < 10; i++) slow = stepSpring(slow, 0, 1 / 10, swing);
    expect(Math.abs(fast.value - slow.value) < 0.05).toBe(true);
    expect(Math.abs(fast.velocity - slow.velocity) < 0.5).toBe(true);
  });

  test('a huge step after an idle tab does not blow the value up', () => {
    const next = stepSpring({ value: -7, velocity: 0 }, 0, 60, swing);
    expect(Number.isFinite(next.value)).toBe(true);
    expect(Math.abs(next.value) <= 7).toBe(true);
    // It simulated the cap, not the whole minute.
    expect(next).toEqual(stepSpring({ value: -7, velocity: 0 }, 0, MAX_SPRING_DT, swing));
  });

  test('a stiff, well damped spring still settles on a slow frame', () => {
    let state = { value: 0, velocity: 340 };
    for (let i = 0; i < 30; i++) state = stepSpring(state, 0, 0.1, { omega: 18, damping: 0.35 });
    expect(springAtRest(state, 0, 0.01, 0.1)).toBe(true);
  });
});

describe('springAtRest', () => {
  test('needs both the value and the velocity to be small', () => {
    expect(springAtRest({ value: 0.01, velocity: 0.1 }, 0, 0.05, 0.5)).toBe(true);
    expect(springAtRest({ value: 0.2, velocity: 0 }, 0, 0.05, 0.5)).toBe(false);
    expect(springAtRest({ value: 0, velocity: 3 }, 0, 0.05, 0.5)).toBe(false);
    expect(springAtRest({ value: 5.01, velocity: 0 }, 5, 0.05, 0.5)).toBe(true);
  });
});
