import { describe, expect, test } from 'bun:test';
import type { IUsageDailyEntry } from '#usage/domain/usage.types';
import { usageDays } from './usageDays';

const row = (
  date: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  callCount: number,
  costUsd: number,
): IUsageDailyEntry => ({ date, model, inputTokens, outputTokens, callCount, costUsd });

// Local noon, so the day is the same whatever zone the test runs in.
const today = new Date(2026, 10, 16, 12, 0, 0);

const zero = (date: string) => ({
  date,
  inputTokens: 0,
  outputTokens: 0,
  calls: 0,
  costUsd: 0,
});

describe('usageDays', () => {
  test('seven days ending today, oldest first, zero-filled', () => {
    expect(usageDays([], today, 7)).toEqual([
      zero('2026-11-10'),
      zero('2026-11-11'),
      zero('2026-11-12'),
      zero('2026-11-13'),
      zero('2026-11-14'),
      zero('2026-11-15'),
      zero('2026-11-16'),
    ]);
  });

  test('seven is the default', () => {
    expect(usageDays([], today).length).toBe(7);
  });

  test('a day is summed across its models', () => {
    const days = usageDays(
      [
        row('2026-11-16', 'haiku', 100, 10, 2, 0.5),
        row('2026-11-16', 'opus', 1000, 200, 3, 2.25),
        row('2026-11-14', 'haiku', 7, 1, 1, 0.25),
      ],
      today,
      7,
    );
    expect(days[6]).toEqual({
      date: '2026-11-16',
      inputTokens: 1100,
      outputTokens: 210,
      calls: 5,
      costUsd: 2.75,
    });
    expect(days[4]).toEqual({
      date: '2026-11-14',
      inputTokens: 7,
      outputTokens: 1,
      calls: 1,
      costUsd: 0.25,
    });
    expect(days[5]).toEqual(zero('2026-11-15'));
  });

  test('rows older than the window are left out', () => {
    const days = usageDays(
      [row('2026-11-09', 'haiku', 5, 5, 5, 5), row('2026-10-20', 'haiku', 5, 5, 5, 5)],
      today,
      7,
    );
    let calls = 0;
    for (let i = 0; i < days.length; i += 1) calls += days[i]!.calls;
    expect(calls).toBe(0);
  });

  test('the window crosses a month and a year', () => {
    const days = usageDays([], new Date(2027, 0, 2, 12, 0, 0), 4);
    expect(days.map((d) => d.date)).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
    ]);
  });

  test('a row dated with a full instant lands on its day', () => {
    const days = usageDays([row('2026-11-15T00:00:00.000Z', 'haiku', 1, 1, 1, 1)], today, 7);
    expect(days[5]?.calls).toBe(1);
  });

  test('the rows are not changed', () => {
    const rows = [row('2026-11-16', 'haiku', 100, 10, 2, 0.5)];
    usageDays(rows, today, 7);
    expect(rows).toEqual([row('2026-11-16', 'haiku', 100, 10, 2, 0.5)]);
  });
});
