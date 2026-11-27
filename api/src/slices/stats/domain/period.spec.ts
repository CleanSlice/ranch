import {
  DEFAULT_PERIOD,
  PERIODS,
  bucketByDay,
  installationRange,
  isPeriod,
  localDay,
  personalRange,
  resolveZone,
  shiftDay,
  startOfDay,
  weekdayOf,
} from './period';

const KYIV = 'Europe/Kyiv';
const LA = 'America/Los_Angeles';

const at = (iso: string) => new Date(iso);
const iso = (d: Date) => d.toISOString();

// The expected instants are worked out by hand from the published rules, not
// with the code under test. 2026: Kyiv is UTC+2 until 29 March 01:00 UTC and
// again from 25 October 01:00 UTC, UTC+3 between; Los Angeles is UTC-8 until
// 8 March 10:00 UTC and again from 1 November 09:00 UTC, UTC-7 between.
const CASES: {
  name: string;
  zone: string;
  now: string;
  expected: Record<number, { from: string; previousFrom: string }>;
}[] = [
  {
    name: 'Kyiv on the day the clocks go forward',
    zone: KYIV,
    now: '2026-03-29T12:00:00.000Z',
    expected: {
      7: {
        from: '2026-03-22T22:00:00.000Z',
        previousFrom: '2026-03-15T22:00:00.000Z',
      },
      30: {
        from: '2026-02-27T22:00:00.000Z',
        previousFrom: '2026-01-28T22:00:00.000Z',
      },
      // The previous period starts on 1 October 2025, still summer time.
      90: {
        from: '2025-12-29T22:00:00.000Z',
        previousFrom: '2025-09-30T21:00:00.000Z',
      },
    },
  },
  {
    name: 'Kyiv on the day the clocks go back',
    zone: KYIV,
    now: '2026-10-25T12:00:00.000Z',
    expected: {
      7: {
        from: '2026-10-18T21:00:00.000Z',
        previousFrom: '2026-10-11T21:00:00.000Z',
      },
      30: {
        from: '2026-09-25T21:00:00.000Z',
        previousFrom: '2026-08-26T21:00:00.000Z',
      },
      90: {
        from: '2026-07-27T21:00:00.000Z',
        previousFrom: '2026-04-28T21:00:00.000Z',
      },
    },
  },
  {
    name: 'Los Angeles on the day the clocks go forward',
    zone: LA,
    now: '2026-03-08T20:00:00.000Z',
    expected: {
      7: {
        from: '2026-03-02T08:00:00.000Z',
        previousFrom: '2026-02-23T08:00:00.000Z',
      },
      30: {
        from: '2026-02-07T08:00:00.000Z',
        previousFrom: '2026-01-08T08:00:00.000Z',
      },
      // The previous period starts on 10 September 2025, still summer time.
      90: {
        from: '2025-12-09T08:00:00.000Z',
        previousFrom: '2025-09-10T07:00:00.000Z',
      },
    },
  },
  {
    name: 'Los Angeles on the day the clocks go back',
    zone: LA,
    now: '2026-11-01T20:00:00.000Z',
    expected: {
      7: {
        from: '2026-10-26T07:00:00.000Z',
        previousFrom: '2026-10-19T07:00:00.000Z',
      },
      30: {
        from: '2026-10-03T07:00:00.000Z',
        previousFrom: '2026-09-03T07:00:00.000Z',
      },
      90: {
        from: '2026-08-04T07:00:00.000Z',
        previousFrom: '2026-05-06T07:00:00.000Z',
      },
    },
  },
  {
    name: 'UTC',
    zone: 'UTC',
    now: '2026-11-27T15:30:00.000Z',
    expected: {
      7: {
        from: '2026-11-21T00:00:00.000Z',
        previousFrom: '2026-11-14T00:00:00.000Z',
      },
      30: {
        from: '2026-10-29T00:00:00.000Z',
        previousFrom: '2026-09-29T00:00:00.000Z',
      },
      90: {
        from: '2026-08-30T00:00:00.000Z',
        previousFrom: '2026-06-01T00:00:00.000Z',
      },
    },
  },
];

describe('isPeriod', () => {
  it('knows the three periods and the one a view opens with', () => {
    expect(PERIODS.filter(isPeriod)).toEqual([7, 30, 90]);
    expect(DEFAULT_PERIOD).toBe(30);
    expect(isPeriod(DEFAULT_PERIOD)).toBe(true);
  });

  it('refuses every other number, and a period written as text', () => {
    for (const value of [
      0,
      1,
      14,
      31,
      365,
      -7,
      7.5,
      NaN,
      '30',
      null,
      undefined,
      [7],
    ]) {
      expect([value, isPeriod(value)]).toEqual([value, false]);
    }
  });
});

describe('PERIODS', () => {
  it('offers 7, 30 and 90 days', () => {
    expect([...PERIODS]).toEqual([7, 30, 90]);
  });
});

describe('personalRange', () => {
  for (const c of CASES) {
    describe(c.name, () => {
      for (const period of PERIODS) {
        it(`${period} days`, () => {
          const range = personalRange(period, c.zone, at(c.now));
          expect(iso(range.from)).toBe(c.expected[period].from);
          expect(iso(range.to)).toBe(c.now);
          expect(iso(range.previousFrom)).toBe(c.expected[period].previousFrom);
        });
      }
    });
  }

  it("counts from the viewer's today, not from the UTC date", () => {
    // 05:00 UTC on 8 March is still the evening of 7 March in Los Angeles.
    const range = personalRange(7, LA, at('2026-03-08T05:00:00.000Z'));
    expect(iso(range.from)).toBe('2026-03-01T08:00:00.000Z');
    // And 22:30 UTC on 10 June is already 11 June in Kyiv.
    const east = personalRange(7, KYIV, at('2026-06-10T22:30:00.000Z'));
    expect(iso(east.from)).toBe('2026-06-04T21:00:00.000Z');
  });

  it('starts a period on the change day at that day’s own midnight', () => {
    // Seven days ending 4 April start on 29 March, which in Kyiv is 23 hours
    // long and begins in winter time.
    const range = personalRange(7, KYIV, at('2026-04-04T09:00:00.000Z'));
    expect(iso(range.from)).toBe('2026-03-28T22:00:00.000Z');
    expect(iso(range.previousFrom)).toBe('2026-03-21T22:00:00.000Z');
  });

  it('puts previousFrom exactly one period earlier', () => {
    for (const c of CASES) {
      for (const period of PERIODS) {
        const range = personalRange(period, c.zone, at(c.now));
        // In local days, whatever the clocks did in between.
        expect(localDay(range.previousFrom, c.zone)).toBe(
          shiftDay(localDay(range.from, c.zone), -period),
        );
        expect(iso(range.previousFrom)).toBe(
          iso(startOfDay(localDay(range.previousFrom, c.zone), c.zone)),
        );
      }
    }
    // Where no clock changes, that is the same number of milliseconds.
    for (const period of PERIODS) {
      const range = personalRange(period, 'UTC', at('2026-11-27T15:30:00Z'));
      expect(range.from.getTime() - range.previousFrom.getTime()).toBe(
        period * 24 * 60 * 60 * 1000,
      );
    }
  });
});

describe('installationRange', () => {
  it('uses UTC days for every period', () => {
    const now = at('2026-11-27T15:30:00.000Z');
    const utc = CASES.find((c) => c.zone === 'UTC')!;
    for (const period of PERIODS) {
      const range = installationRange(period, now);
      expect(iso(range.from)).toBe(utc.expected[period].from);
      expect(iso(range.to)).toBe(utc.now);
      expect(iso(range.previousFrom)).toBe(utc.expected[period].previousFrom);
    }
  });

  it('does not move with the time zone of the machine or the viewer', () => {
    // 23:30 UTC is already tomorrow in Kyiv; the installation stays on today.
    const range = installationRange(7, at('2026-06-10T23:30:00.000Z'));
    expect(iso(range.from)).toBe('2026-06-04T00:00:00.000Z');
    expect(iso(range.previousFrom)).toBe('2026-05-28T00:00:00.000Z');
  });
});

describe('resolveZone', () => {
  it('returns a valid IANA name as it was given', () => {
    expect(resolveZone(KYIV)).toBe(KYIV);
    expect(resolveZone(LA)).toBe(LA);
    expect(resolveZone('UTC')).toBe('UTC');
    expect(resolveZone('Asia/Kolkata')).toBe('Asia/Kolkata');
  });

  it('falls back to UTC for anything else', () => {
    expect(resolveZone('')).toBe('UTC');
    expect(resolveZone('Mars/Olympus')).toBe('UTC');
    expect(resolveZone('A'.repeat(200))).toBe('UTC');
    expect(resolveZone(undefined)).toBe('UTC');
    expect(resolveZone(null)).toBe('UTC');
    expect(resolveZone(180)).toBe('UTC');
    expect(resolveZone(['Europe/Kyiv'])).toBe('UTC');
  });

  it('refuses a bare offset, which is not a zone and has no DST', () => {
    expect(resolveZone('+03:00')).toBe('UTC');
    expect(resolveZone('-0800')).toBe('UTC');
  });
});

describe('localDay', () => {
  it('assigns an hour at 22:00 UTC to the next day in Kyiv and the same day in Los Angeles', () => {
    const hour = at('2026-06-10T22:00:00.000Z');
    expect(localDay(hour, KYIV)).toBe('2026-06-11');
    expect(localDay(hour, LA)).toBe('2026-06-10');
    expect(localDay(hour, 'UTC')).toBe('2026-06-10');
  });

  it('follows the clock change within one day', () => {
    // Kyiv, 25 October 2026: 20:59 UTC is 23:59 summer time on the 24th, and
    // the 25th then lasts 25 hours, until 22:00 UTC.
    expect(localDay(at('2026-10-24T20:59:59.000Z'), KYIV)).toBe('2026-10-24');
    expect(localDay(at('2026-10-24T21:00:00.000Z'), KYIV)).toBe('2026-10-25');
    expect(localDay(at('2026-10-25T21:59:59.000Z'), KYIV)).toBe('2026-10-25');
    expect(localDay(at('2026-10-25T22:00:00.000Z'), KYIV)).toBe('2026-10-26');
  });
});

describe('startOfDay and shiftDay', () => {
  it('finds the first instant of a local day on both sides of a change', () => {
    expect(iso(startOfDay('2026-03-29', KYIV))).toBe(
      '2026-03-28T22:00:00.000Z',
    );
    expect(iso(startOfDay('2026-03-30', KYIV))).toBe(
      '2026-03-29T21:00:00.000Z',
    );
    expect(iso(startOfDay('2026-11-01', LA))).toBe('2026-11-01T07:00:00.000Z');
    expect(iso(startOfDay('2026-11-02', LA))).toBe('2026-11-02T08:00:00.000Z');
  });

  it('finds the first instant of a day whose midnight does not exist', () => {
    // Beirut puts its clocks forward at 00:00: 29 March 2026 begins at 01:00
    // local, which is 22:00 UTC the evening before.
    const start = startOfDay('2026-03-29', 'Asia/Beirut');
    expect(iso(start)).toBe('2026-03-28T22:00:00.000Z');
    expect(localDay(start, 'Asia/Beirut')).toBe('2026-03-29');
    expect(localDay(new Date(start.getTime() - 1), 'Asia/Beirut')).toBe(
      '2026-03-28',
    );
  });

  it('keeps the true midnight of a zone with a half-hour offset', () => {
    expect(iso(startOfDay('2026-06-10', 'Asia/Kolkata'))).toBe(
      '2026-06-09T18:30:00.000Z',
    );
  });

  it('moves a day across months, years and a leap day', () => {
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDay('2028-03-01', -1)).toBe('2028-02-29');
    expect(shiftDay('2026-01-01', -1)).toBe('2025-12-31');
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDay('2026-11-27', 0)).toBe('2026-11-27');
  });
});

describe('weekdayOf', () => {
  it('numbers the days from Monday', () => {
    expect(weekdayOf('2026-11-23')).toBe(0);
    expect(weekdayOf('2026-11-27')).toBe(4);
    expect(weekdayOf('2026-11-28')).toBe(5);
    expect(weekdayOf('2026-11-29')).toBe(6);
    expect(weekdayOf('2026-11-30')).toBe(0);
  });
});

describe('bucketByDay', () => {
  const row = (
    hour: string,
    sessionId: string,
    userMessages: number,
    agentMessages: number,
  ) => ({ hour: at(hour), sessionId, userMessages, agentMessages });

  const NOW = at('2026-06-10T12:00:00.000Z');

  it('returns exactly the days asked for, oldest first, zero-filled', () => {
    const days = bucketByDay([], KYIV, 7, NOW);
    expect(days.map((d) => d.day)).toEqual([
      '2026-06-04',
      '2026-06-05',
      '2026-06-06',
      '2026-06-07',
      '2026-06-08',
      '2026-06-09',
      '2026-06-10',
    ]);
    for (const d of days) {
      expect(d.conversations).toBe(0);
      expect(d.userMessages).toBe(0);
      expect(d.agentMessages).toBe(0);
    }
    expect(bucketByDay([], LA, 91, NOW)).toHaveLength(91);
    expect(bucketByDay([], 'UTC', 1, NOW)).toHaveLength(1);
  });

  it("puts each hour on the viewer's day", () => {
    const rows = [
      row('2026-06-08T22:00:00.000Z', 'a', 2, 3),
      row('2026-06-09T05:00:00.000Z', 'a', 1, 1),
    ];
    const kyiv = bucketByDay(rows, KYIV, 3, NOW);
    // 22:00 UTC on the 8th is 01:00 on the 9th in Kyiv: one day, both rows.
    expect(kyiv).toEqual([
      {
        day: '2026-06-08',
        conversations: 0,
        userMessages: 0,
        agentMessages: 0,
      },
      {
        day: '2026-06-09',
        conversations: 1,
        userMessages: 3,
        agentMessages: 4,
      },
      {
        day: '2026-06-10',
        conversations: 0,
        userMessages: 0,
        agentMessages: 0,
      },
    ]);
    // In Los Angeles both are on the 8th: 15:00 and 22:00.
    const la = bucketByDay(rows, LA, 3, NOW);
    expect(la).toEqual([
      {
        day: '2026-06-08',
        conversations: 1,
        userMessages: 3,
        agentMessages: 4,
      },
      {
        day: '2026-06-09',
        conversations: 0,
        userMessages: 0,
        agentMessages: 0,
      },
      {
        day: '2026-06-10',
        conversations: 0,
        userMessages: 0,
        agentMessages: 0,
      },
    ]);
  });

  it('counts a conversation once a day, on every day it was written in', () => {
    const rows = [
      row('2026-06-08T08:00:00.000Z', 'a', 1, 1),
      row('2026-06-08T09:00:00.000Z', 'a', 1, 1),
      row('2026-06-08T10:00:00.000Z', 'b', 1, 0),
      row('2026-06-09T08:00:00.000Z', 'a', 1, 1),
      row('2026-06-10T08:00:00.000Z', 'a', 4, 4),
    ];
    const days = bucketByDay(rows, 'UTC', 3, NOW);
    expect(days.map((d) => d.conversations)).toEqual([2, 1, 1]);
    expect(days.map((d) => d.userMessages)).toEqual([3, 1, 4]);
    expect(days.map((d) => d.agentMessages)).toEqual([2, 1, 4]);
  });

  it('leaves out rows that fall outside the days asked for', () => {
    const rows = [
      row('2026-06-01T08:00:00.000Z', 'old', 5, 5),
      row('2026-06-10T08:00:00.000Z', 'a', 1, 1),
      row('2026-06-12T08:00:00.000Z', 'ahead', 5, 5),
    ];
    const days = bucketByDay(rows, 'UTC', 2, NOW);
    expect(days).toEqual([
      {
        day: '2026-06-09',
        conversations: 0,
        userMessages: 0,
        agentMessages: 0,
      },
      {
        day: '2026-06-10',
        conversations: 1,
        userMessages: 1,
        agentMessages: 1,
      },
    ]);
  });

  it('does not depend on the order of the rows', () => {
    const rows = [
      row('2026-06-10T08:00:00.000Z', 'a', 1, 1),
      row('2026-06-08T08:00:00.000Z', 'b', 2, 0),
      row('2026-06-09T08:00:00.000Z', 'a', 3, 1),
    ];
    expect(bucketByDay([...rows].reverse(), KYIV, 7, NOW)).toEqual(
      bucketByDay(rows, KYIV, 7, NOW),
    );
  });

  it('keeps a 23-hour and a 25-hour day as one entry each', () => {
    const spring = bucketByDay([], KYIV, 3, at('2026-03-30T12:00:00.000Z'));
    expect(spring.map((d) => d.day)).toEqual([
      '2026-03-28',
      '2026-03-29',
      '2026-03-30',
    ]);
    const rows = [
      // 21:00 UTC on 25 October is 23:00 on the 25th in Kyiv, the last of
      // that day's 25 hours; 22:00 UTC is midnight.
      row('2026-10-25T21:00:00.000Z', 'a', 1, 0),
      row('2026-10-25T22:00:00.000Z', 'a', 0, 1),
    ];
    const autumn = bucketByDay(rows, KYIV, 2, at('2026-10-26T12:00:00.000Z'));
    expect(autumn).toEqual([
      {
        day: '2026-10-25',
        conversations: 1,
        userMessages: 1,
        agentMessages: 0,
      },
      {
        day: '2026-10-26',
        conversations: 1,
        userMessages: 0,
        agentMessages: 1,
      },
    ]);
  });
});
