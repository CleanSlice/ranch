import { describe, expect, test } from 'bun:test';

import {
  browserTimeZone,
  formatClock,
  formatCompact,
  formatCompactParts,
  formatDate,
  formatDateTime,
  formatDayMonth,
  formatEstimate,
  formatFullDate,
  formatList,
  formatLongDate,
  formatMoney,
  formatMonthShort,
  formatNumber,
  formatPercent,
  formatSize,
  formatStamp,
  formatStampTitle,
  formatWeekdayShort,
  languageName,
} from './format';

// Dates are built with the local-time constructor and `now` is passed in, so
// the expectations hold in any time zone and on any day. The reference instant
// is the one in specs/018-english-admin-locale/contracts/app-format.md.
const AT = new Date(2026, 7, 21, 0, 46, 0);
const NOW_SAME_DAY = new Date(2026, 7, 21, 18, 5, 0);
const NOW_LATER = new Date(2026, 10, 2, 9, 0, 0);

// Russian (and several other languages) separate groups, units and the percent
// sign with a no-break or narrow no-break space. Which of the two depends on
// the engine's data, and neither can be told from a space on screen, so the
// expectations are written with a plain one.
const plain = (text: string) => text.replace(/[  ]/g, ' ');

const week = (locale: string) =>
  [0, 1, 2, 3, 4, 5, 6].map((weekday) => formatWeekdayShort(locale, weekday));
const year = (locale: string) =>
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((month) => formatMonthShort(locale, month));

/** Runs `check` with the process in another time zone, then puts it back. */
function inZone(zone: string, check: () => void) {
  const before = process.env.TZ;
  process.env.TZ = zone;
  try {
    check();
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
}

describe('English stays exactly as it was', () => {
  test('date', () => {
    expect(formatDate('en', AT)).toBe('8/21/2026');
  });

  test('date and time', () => {
    expect(plain(formatDateTime('en', AT))).toBe('8/21/2026, 12:46:00 AM');
  });

  test('time of day', () => {
    expect(plain(formatClock('en', AT))).toBe('12:46 AM');
  });

  test('message time: today, then earlier', () => {
    expect(plain(formatStamp('en', AT, NOW_SAME_DAY))).toBe('12:46 AM');
    expect(plain(formatStamp('en', AT, NOW_LATER))).toBe('Aug 21, 12:46 AM');
  });

  test('message tooltip', () => {
    expect(plain(formatStampTitle('en', AT))).toBe('August 21, 2026 at 12:46:00 AM');
  });

  test('day divider and the day in full', () => {
    expect(formatLongDate('en', AT)).toBe('August 21, 2026');
    expect(formatFullDate('en', AT)).toBe('Friday, August 21, 2026');
  });

  test('count and percent', () => {
    expect(formatNumber('en', 12345)).toBe('12,345');
    expect(formatPercent('en', 0.42)).toBe('42%');
    expect(formatPercent('en', 0.999)).toBe('99.9%');
  });

  test('size keeps the rounding it had', () => {
    expect(formatSize('en', 856)).toEqual({ value: '856', unit: 'b' });
    expect(formatSize('en', 2100)).toEqual({ value: '2', unit: 'kb' });
    expect(formatSize('en', 10 * 1024 * 1024)).toEqual({ value: '10.0', unit: 'mb' });
    expect(formatSize('en', 6_228_000)).toEqual({ value: '5.9', unit: 'mb' });
  });

  test('size with a decimal in kilobytes, for small files in a proposal', () => {
    expect(formatSize('en', 856, true)).toEqual({ value: '856', unit: 'b' });
    expect(formatSize('en', 2150, true)).toEqual({ value: '2.1', unit: 'kb' });
    expect(formatSize('en', 6_228_000, true)).toEqual({ value: '5.9', unit: 'mb' });
  });

  test('language name', () => {
    expect(languageName('en', 'uk')).toBe('Ukrainian');
    expect(languageName('en', 'en')).toBe('English');
  });

  test('compact count: whole below a thousand, one decimal above', () => {
    expect(formatCompact('en', 0)).toBe('0');
    expect(formatCompact('en', 999)).toBe('999');
    expect(formatCompact('en', 1234)).toBe('1.2K');
    expect(formatCompact('en', 340_000)).toBe('340K');
    expect(formatCompact('en', 1_234_567)).toBe('1.2M');
    expect(formatCompact('en', 2_500_000_000)).toBe('2.5B');
  });

  test('money: cents below a hundred, whole units from a hundred', () => {
    expect(formatMoney('en', 0)).toBe('$0.00');
    expect(formatMoney('en', 0.5)).toBe('$0.50');
    expect(formatMoney('en', 12.5)).toBe('$12.50');
    expect(formatMoney('en', 99.99)).toBe('$99.99');
    expect(formatMoney('en', 100)).toBe('$100');
    expect(formatMoney('en', 1234.56)).toBe('$1,235');
  });

  test('money: an amount that rounds to a hundred is a whole hundred', () => {
    // Never "$100.00": the cents are decided after rounding, not before.
    expect(formatMoney('en', 99.996)).toBe('$100');
    expect(formatMoney('en', 99.994)).toBe('$99.99');
  });

  test('money in another currency', () => {
    expect(formatMoney('en', 12.5, 'EUR')).toBe('€12.50');
    expect(formatMoney('en', 250, 'EUR')).toBe('€250');
  });

  test('an estimate is the amount with "≈" before it', () => {
    expect(plain(formatEstimate('en', 0))).toBe('≈ $0.00');
    expect(plain(formatEstimate('en', 7.35))).toBe('≈ $7.35');
    expect(plain(formatEstimate('en', 212.4))).toBe('≈ $212');
    expect(plain(formatEstimate('en', 12.5, 'EUR'))).toBe('≈ €12.50');
    // The sign and the amount are not parted at the end of a line.
    expect(formatEstimate('en', 7.35)).toBe('≈ $7.35');
  });

  test('an estimate too small for a cent is "less than a cent", not zero', () => {
    expect(plain(formatEstimate('en', 0.0012))).toBe('< $0.01');
    expect(plain(formatEstimate('en', 0.0049))).toBe('< $0.01');
    expect(plain(formatEstimate('en', 0.000001, 'EUR'))).toBe('< €0.01');
    // From half a cent up the amount rounds to a cent and is printed as one.
    expect(plain(formatEstimate('en', 0.005))).toBe('≈ $0.01');
    expect(plain(formatEstimate('en', 0.012))).toBe('≈ $0.01');
    // Nothing spent is nothing spent.
    expect(plain(formatEstimate('en', 0))).toBe('≈ $0.00');
    // Not parted at the end of a line either.
    expect(formatEstimate('en', 0.0012)).toBe('< $0.01');
  });

  test('a list of names', () => {
    expect(formatList('en', ['Ada'])).toBe('Ada');
    expect(formatList('en', ['Ada', 'Bo'])).toBe('Ada and Bo');
    expect(formatList('en', ['Ada', 'Bo', 'Cy'])).toBe('Ada, Bo, and Cy');
  });

  test('compact count in two parts: the number and its unit', () => {
    expect(formatCompactParts('en', 0)).toEqual({ value: '0', unit: '' });
    expect(formatCompactParts('en', 999)).toEqual({ value: '999', unit: '' });
    expect(formatCompactParts('en', 1234)).toEqual({ value: '1.2', unit: 'K' });
    expect(formatCompactParts('en', 340_000)).toEqual({ value: '340', unit: 'K' });
    expect(formatCompactParts('en', 51_300_000)).toEqual({ value: '51.3', unit: 'M' });
  });

  test('weekday and month names, short, Monday first', () => {
    expect(week('en')).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(year('en')).toEqual([
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ]);
  });

  test('day and month', () => {
    expect(formatDayMonth('en', '2026-11-26')).toBe('Nov 26');
    expect(formatDayMonth('en', '2026-05-03')).toBe('May 3');
    expect(formatDayMonth('en', AT)).toBe('Aug 21');
  });
});

describe('Russian follows Russian conventions', () => {
  test('date', () => {
    expect(formatDate('ru', AT)).toBe('21.08.2026');
  });

  test('date and time', () => {
    expect(formatDateTime('ru', AT)).toBe('21.08.2026, 00:46:00');
  });

  test('time of day', () => {
    expect(formatClock('ru', AT)).toBe('00:46');
  });

  test('message time: today, then earlier', () => {
    expect(formatStamp('ru', AT, NOW_SAME_DAY)).toBe('00:46');
    expect(plain(formatStamp('ru', AT, NOW_LATER))).toBe('21 авг., 00:46');
  });

  test('message tooltip', () => {
    expect(plain(formatStampTitle('ru', AT))).toBe('21 августа 2026 г. в 00:46:00');
  });

  test('day divider and the day in full', () => {
    expect(plain(formatLongDate('ru', AT))).toBe('21 августа 2026 г.');
    expect(plain(formatFullDate('ru', AT))).toBe('пятница, 21 августа 2026 г.');
  });

  test('count and percent', () => {
    expect(plain(formatNumber('ru', 12345))).toBe('12 345');
    expect(plain(formatPercent('ru', 0.42))).toBe('42 %');
    expect(plain(formatPercent('ru', 0.999))).toBe('99,9 %');
  });

  test('size: the number is Russian, the unit is a key', () => {
    expect(formatSize('ru', 856)).toEqual({ value: '856', unit: 'b' });
    expect(formatSize('ru', 6_228_000)).toEqual({ value: '5,9', unit: 'mb' });
    expect(formatSize('ru', 10 * 1024 * 1024)).toEqual({ value: '10,0', unit: 'mb' });
    expect(formatSize('ru', 2150, true)).toEqual({ value: '2,1', unit: 'kb' });
  });

  test('language name', () => {
    // Engines disagree on whether a standalone name starts with a capital.
    expect(languageName('ru', 'uk').toLowerCase()).toBe('украинский');
  });

  test('compact count: Russian words, a comma for the decimal', () => {
    expect(formatCompact('ru', 0)).toBe('0');
    expect(formatCompact('ru', 999)).toBe('999');
    expect(plain(formatCompact('ru', 1234))).toBe('1,2 тыс.');
    expect(plain(formatCompact('ru', 340_000))).toBe('340 тыс.');
    expect(plain(formatCompact('ru', 1_234_567))).toBe('1,2 млн');
    expect(plain(formatCompact('ru', 2_500_000_000))).toBe('2,5 млрд');
  });

  test('money: the sign after the amount', () => {
    expect(plain(formatMoney('ru', 0))).toBe('0,00 $');
    expect(plain(formatMoney('ru', 12.5))).toBe('12,50 $');
    expect(plain(formatMoney('ru', 99.99))).toBe('99,99 $');
    expect(plain(formatMoney('ru', 100))).toBe('100 $');
    expect(plain(formatMoney('ru', 1234.56))).toBe('1 235 $');
    expect(plain(formatMoney('ru', 12.5, 'EUR'))).toBe('12,50 €');
  });

  test('an estimate: "≈" before the amount, the sign still after it', () => {
    expect(plain(formatEstimate('ru', 7.35))).toBe('≈ 7,35 $');
    expect(plain(formatEstimate('ru', 1234.56))).toBe('≈ 1 235 $');
  });

  test('an estimate too small for a cent: "<" before the cent, the sign after it', () => {
    expect(plain(formatEstimate('ru', 0.0012))).toBe('< 0,01 $');
    expect(plain(formatEstimate('ru', 0.005))).toBe('≈ 0,01 $');
    expect(plain(formatEstimate('ru', 0))).toBe('≈ 0,00 $');
  });

  test('a list of names: "и" before the last, no comma before it', () => {
    expect(formatList('ru', ['Ада'])).toBe('Ада');
    expect(formatList('ru', ['Ада', 'Бо'])).toBe('Ада и Бо');
    expect(formatList('ru', ['Ада', 'Бо', 'Support Bot'])).toBe('Ада, Бо и Support Bot');
  });

  test('compact count in two parts: the unit is a word', () => {
    expect(formatCompactParts('ru', 999)).toEqual({ value: '999', unit: '' });
    expect(formatCompactParts('ru', 1234)).toEqual({ value: '1,2', unit: 'тыс.' });
    expect(formatCompactParts('ru', 51_300_000)).toEqual({ value: '51,3', unit: 'млн' });
  });

  test('weekday and month names, short, Monday first', () => {
    expect(week('ru')).toEqual(['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']);
    // On its own a month stands in the nominative: "май", not "мая".
    expect(year('ru')).toEqual([
      'янв.',
      'февр.',
      'март',
      'апр.',
      'май',
      'июнь',
      'июль',
      'авг.',
      'сент.',
      'окт.',
      'нояб.',
      'дек.',
    ]);
  });

  test('day and month: next to a day the month is in the genitive', () => {
    expect(plain(formatDayMonth('ru', '2026-11-26'))).toBe('26 нояб.');
    expect(plain(formatDayMonth('ru', '2026-05-03'))).toBe('3 мая');
    expect(plain(formatDayMonth('ru', AT))).toBe('21 авг.');
  });
});

describe('a calendar day is not an instant', () => {
  // The API counts a conversation into a day in the viewer's zone and sends
  // the day as `YYYY-MM-DD`. Read as an instant, that string is midnight UTC,
  // which is still the evening before anywhere west of Greenwich.
  const ZONES = ['Pacific/Honolulu', 'America/New_York', 'UTC', 'Pacific/Kiritimati'];

  test('a day string is that day in every time zone', () => {
    for (let i = 0; i < ZONES.length; i++) {
      inZone(ZONES[i] ?? 'UTC', () => {
        expect(formatDayMonth('en', '2026-11-26')).toBe('Nov 26');
        expect(formatDayMonth('en', '2026-01-01')).toBe('Jan 1');
        expect(formatDayMonth('en', '2026-12-31')).toBe('Dec 31');
        expect(plain(formatDayMonth('ru', '2026-03-01'))).toBe('1 мар.');
      });
    }
  });

  test('weekday and month names do not move with the time zone either', () => {
    for (let i = 0; i < ZONES.length; i++) {
      inZone(ZONES[i] ?? 'UTC', () => {
        expect(formatWeekdayShort('en', 0)).toBe('Mon');
        expect(formatWeekdayShort('en', 6)).toBe('Sun');
        expect(formatMonthShort('en', 0)).toBe('Jan');
        expect(formatMonthShort('en', 11)).toBe('Dec');
      });
    }
  });

  test('a day that does not exist is nothing, not the day it rolls over to', () => {
    expect(formatDayMonth('en', '2026-02-30')).toBe('');
    expect(formatDayMonth('en', '2026-13-01')).toBe('');
    expect(formatDayMonth('en', '2026-00-10')).toBe('');
  });
});

describe('the time zone of the browser', () => {
  test('is the IANA name the page sends to the API', () => {
    inZone('America/New_York', () => {
      expect(browserTimeZone()).toBe('America/New_York');
    });
    inZone('Asia/Tokyo', () => {
      expect(browserTimeZone()).toBe('Asia/Tokyo');
    });
  });

  test('is UTC when the browser will not say', () => {
    const real = Intl.DateTimeFormat;
    try {
      Intl.DateTimeFormat = (() => {
        throw new Error('no Intl here');
      }) as unknown as typeof Intl.DateTimeFormat;
      expect(browserTimeZone()).toBe('UTC');

      Intl.DateTimeFormat = (() => ({
        resolvedOptions: () => ({}),
      })) as unknown as typeof Intl.DateTimeFormat;
      expect(browserTimeZone()).toBe('UTC');
    } finally {
      Intl.DateTimeFormat = real;
    }
  });
});

describe('what a value can arrive as', () => {
  test('an ISO string, epoch milliseconds and a Date give the same text', () => {
    expect(formatClock('ru', AT.toISOString())).toBe('00:46');
    expect(formatClock('ru', AT.getTime())).toBe('00:46');
    expect(formatClock('ru', AT)).toBe('00:46');
  });

  test('nothing to format is an empty string, never "Invalid Date" or "NaN"', () => {
    const dates = [
      formatDate,
      formatDateTime,
      formatClock,
      formatStamp,
      formatStampTitle,
      formatLongDate,
      formatFullDate,
      formatDayMonth,
    ];
    for (const format of dates) {
      for (const locale of ['en', 'ru']) {
        expect(format(locale, null)).toBe('');
        expect(format(locale, undefined)).toBe('');
        expect(format(locale, '')).toBe('');
        expect(format(locale, 'not a date')).toBe('');
        expect(format(locale, Number.NaN)).toBe('');
      }
    }
    expect(formatNumber('ru', Number.NaN)).toBe('');
    expect(formatNumber('ru', null)).toBe('');
    expect(formatPercent('ru', Number.NaN)).toBe('');
    expect(formatSize('ru', Number.NaN)).toEqual({ value: '0', unit: 'b' });
    expect(formatSize('ru', -5)).toEqual({ value: '0', unit: 'b' });
    expect(formatCompact('ru', Number.NaN)).toBe('');
    expect(formatCompact('en', null)).toBe('');
    expect(formatCompact('en', undefined)).toBe('');
    expect(formatMoney('ru', Number.NaN)).toBe('');
    expect(formatMoney('en', null)).toBe('');
    expect(formatMoney('en', undefined)).toBe('');
    // No amount, no "≈" either: a lone sign would read as a figure.
    expect(formatEstimate('ru', Number.NaN)).toBe('');
    expect(formatEstimate('en', null)).toBe('');
    expect(formatEstimate('en', undefined)).toBe('');
    // No names, no text; a name is shown as received, whatever it holds.
    expect(formatList('en', [])).toBe('');
    expect(formatList('ru', null)).toBe('');
    expect(formatList('en', undefined)).toBe('');
    expect(formatList('en', ['A, B', 'C & D'])).toBe('A, B and C & D');
    expect(formatCompactParts('ru', Number.NaN)).toEqual({ value: '', unit: '' });
    expect(formatCompactParts('en', null)).toEqual({ value: '', unit: '' });
  });

  test('a weekday or a month outside the calendar has no name', () => {
    for (const locale of ['en', 'ru']) {
      expect(formatWeekdayShort(locale, -1)).toBe('');
      expect(formatWeekdayShort(locale, 7)).toBe('');
      expect(formatWeekdayShort(locale, 1.5)).toBe('');
      expect(formatWeekdayShort(locale, Number.NaN)).toBe('');
      expect(formatMonthShort(locale, -1)).toBe('');
      expect(formatMonthShort(locale, 12)).toBe('');
      expect(formatMonthShort(locale, 0.5)).toBe('');
      expect(formatMonthShort(locale, Number.NaN)).toBe('');
    }
  });

  test('a currency code nobody knows is shown as it came, after the amount', () => {
    expect(formatMoney('en', 12.5, 'credits')).toBe('12.50 credits');
    expect(plain(formatMoney('ru', 1234.56, 'credits'))).toBe('1 235 credits');
  });

  test('a language code nobody knows is shown as it came', () => {
    expect(languageName('en', 'unknown')).toBe('unknown');
    expect(languageName('en', '')).toBe('');
    expect(languageName('ru', 'not a code')).toBe('not a code');
  });

  test('a language the console does not offer still formats', () => {
    // The format module never asks the browser; it uses what it is given.
    expect(formatDate('de', AT)).toBe('21.8.2026');
  });
});
