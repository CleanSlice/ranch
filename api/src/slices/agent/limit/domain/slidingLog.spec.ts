import { IAgentLimits } from './agentLimit.types';
import {
  admit,
  countIn,
  decide,
  largestLimit,
  longestWindowMs,
  rebuild,
  trim,
} from './slidingLog';

const MIN = 60_000;
const HOUR = 60 * MIN;
const T0 = 1_800_000_000_000;

const limits = (l: Partial<IAgentLimits>): IAgentLimits => ({
  perMinute: null,
  perHour: null,
  perDay: null,
  ...l,
});

/** Send a request at `now` the way the service does. */
function send(log: number[], l: IAgentLimits, now: number): boolean {
  trim(log, l, now);
  const d = decide(log, l, now);
  if (d.admitted) admit(log, now);
  return d.admitted;
}

describe('slidingLog', () => {
  it('counts only what is inside the window', () => {
    const log = [T0 - 61_000, T0 - 60_000, T0 - 59_999, T0 - 1];
    expect(countIn(log, T0, MIN)).toBe(2);
    expect(countIn(log, T0, HOUR)).toBe(4);
    expect(countIn([], T0, MIN)).toBe(0);
  });

  it('admits under the limit and refuses at it', () => {
    const l = limits({ perMinute: 3 });
    const log: number[] = [];
    expect(send(log, l, T0)).toBe(true);
    expect(send(log, l, T0 + 1)).toBe(true);
    expect(send(log, l, T0 + 2)).toBe(true);
    expect(send(log, l, T0 + 3)).toBe(false);
    expect(log).toHaveLength(3);
  });

  it('reports the wait until the oldest request that must leave has left', () => {
    const l = limits({ perMinute: 2 });
    const log = [T0, T0 + 10_000];
    const d = decide(log, l, T0 + 20_000);
    expect(d).toEqual({
      admitted: false,
      retryAfterMs: 40_000,
      window: 'minute',
    });
  });

  it('accepts again exactly when the stated wait has passed, not before', () => {
    const l = limits({ perMinute: 2 });
    const log = [T0, T0 + 10_000];
    const d = decide(log, l, T0 + 20_000);
    if (d.admitted) throw new Error('expected a refusal');
    const at = T0 + 20_000 + d.retryAfterMs;
    expect(decide(log, l, at - 1).admitted).toBe(false);
    expect(decide(log, l, at).admitted).toBe(true);
  });

  it('never lets more than the limit through in any span of the window', () => {
    // SC-001: a sustained burst of well over 10x the limit, at an uneven pace.
    const l = limits({ perMinute: 7 });
    const log: number[] = [];
    const accepted: number[] = [];
    let now = T0;
    for (let i = 0; i < 2000; i++) {
      now += 100 + ((i * 37) % 900);
      if (send(log, l, now)) accepted.push(now);
    }
    expect(accepted.length).toBeGreaterThan(70);
    for (let i = 0; i < accepted.length; i++) {
      let inSpan = 0;
      for (
        let j = i;
        j < accepted.length && accepted[j] < accepted[i] + MIN;
        j++
      ) {
        inSpan++;
      }
      expect(inSpan).toBeLessThanOrEqual(7);
    }
  });

  it('reports the longest wait when several windows are full, and names it', () => {
    const l = limits({ perMinute: 2, perHour: 3 });
    // Three requests 20 minutes ago fill the hour; the minute is empty.
    const log = [T0 - 20 * MIN, T0 - 20 * MIN + 1, T0 - 20 * MIN + 2];
    expect(decide(log, l, T0)).toEqual({
      admitted: false,
      retryAfterMs: 40 * MIN,
      window: 'hour',
    });
    // Both full: the hour still sets the wait.
    const both = [T0 - 20 * MIN, T0 - 2, T0 - 1];
    const d = decide(both, l, T0);
    expect(d.admitted).toBe(false);
    if (!d.admitted) {
      expect(d.window).toBe('hour');
      expect(d.retryAfterMs).toBe(40 * MIN);
    }
  });

  it('can be asked about some windows only', () => {
    const l = limits({ perMinute: 1, perHour: 100 });
    const log = [T0 - 1];
    expect(decide(log, l, T0).admitted).toBe(false);
    expect(decide(log, l, T0, ['hour', 'day']).admitted).toBe(true);
  });

  it('rounds the wait up, so it is never shorter than the real one', () => {
    const l = limits({ perMinute: 1 });
    const d = decide([T0 + 0.4], l, T0 + 1);
    expect(d).toEqual({
      admitted: false,
      retryAfterMs: 60_000,
      window: 'minute',
    });
  });

  it('keeps no more than the largest limit and nothing older than the longest window', () => {
    const l = limits({ perMinute: 2, perHour: 5 });
    const log = [
      T0 - 2 * HOUR,
      T0 - 50 * MIN,
      T0 - 40 * MIN,
      T0 - 30 * MIN,
      T0 - 2,
      T0 - 1,
    ];
    trim(log, l, T0);
    expect(log).toEqual([
      T0 - 50 * MIN,
      T0 - 40 * MIN,
      T0 - 30 * MIN,
      T0 - 2,
      T0 - 1,
    ]);
    expect(longestWindowMs(l)).toBe(HOUR);
    expect(largestLimit(l)).toBe(5);
  });

  it('keeps nothing when no window is limited', () => {
    const log = [T0 - 1];
    trim(log, null, T0);
    expect(log).toEqual([]);
    expect(decide([T0 - 1], null, T0)).toEqual({ admitted: true });
    expect(longestWindowMs(null)).toBe(0);
  });

  it('stays ascending when the clock steps back', () => {
    const log = [T0];
    admit(log, T0 - 5_000);
    expect(log).toEqual([T0, T0]);
  });

  describe('rebuild from per-minute counts', () => {
    const minuteStart = (t: number) => Math.floor(t / MIN) * MIN;

    it('places each minute at its end, so nothing looks older than it was', () => {
      const l = limits({ perHour: 10 });
      const m = minuteStart(T0 - 30 * MIN);
      const log = rebuild([{ minute: m, accepted: 3 }], l, T0);
      expect(log).toEqual([m + MIN - 1, m + MIN - 1, m + MIN - 1]);
    });

    it('never places the current minute in the future', () => {
      const l = limits({ perHour: 10 });
      const log = rebuild([{ minute: minuteStart(T0), accepted: 2 }], l, T0);
      expect(log.every((t) => t <= T0)).toBe(true);
      expect(log).toHaveLength(2);
    });

    it('never under-counts: a full window is still full after a restart', () => {
      const l = limits({ perHour: 5 });
      const rows = [
        { minute: minuteStart(T0 - 50 * MIN), accepted: 2 },
        { minute: minuteStart(T0 - 10 * MIN), accepted: 3 },
      ];
      const log = rebuild(rows, l, T0);
      expect(countIn(log, T0, HOUR)).toBe(5);
      const d = decide(log, l, T0);
      expect(d.admitted).toBe(false);
      if (!d.admitted) {
        // Real wait is at most 10 minutes; the rebuilt one overstates by < 1 min.
        expect(d.retryAfterMs).toBeGreaterThan(9 * MIN);
        expect(d.retryAfterMs).toBeLessThanOrEqual(11 * MIN);
      }
    });

    it('ignores minutes outside the longest window and keeps at most the largest limit', () => {
      const l = limits({ perHour: 4 });
      const rows = [
        { minute: minuteStart(T0 - 3 * HOUR), accepted: 50 },
        { minute: minuteStart(T0 - 20 * MIN), accepted: 500 },
        { minute: minuteStart(T0 - 5 * MIN), accepted: 1 },
      ];
      const log = rebuild(rows, l, T0);
      expect(log).toHaveLength(4);
      expect(log[log.length - 1]).toBe(minuteStart(T0 - 5 * MIN) + MIN - 1);
      expect([...log].sort((a, b) => a - b)).toEqual(log);
    });

    it('is empty when no window is limited', () => {
      expect(
        rebuild([{ minute: minuteStart(T0), accepted: 9 }], null, T0),
      ).toEqual([]);
    });
  });
});
