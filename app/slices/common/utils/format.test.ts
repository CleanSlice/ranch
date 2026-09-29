import { describe, expect, test } from 'bun:test';

import {
  formatClock,
  formatDate,
  formatDateTime,
  formatFullDate,
  formatLongDate,
  formatNumber,
  formatPercent,
  formatSize,
  formatStamp,
  formatStampTitle,
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
