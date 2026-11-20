import { describe, expect, test } from 'bun:test';
import { shareKindKey, shareLimitRows, shareStatusKey } from './shareInfo';

describe('shareStatusKey', () => {
  test('live, starting, and everything else is unavailable', () => {
    expect(shareStatusKey('running')).toBe('share.info.status_online');
    expect(shareStatusKey('deploying')).toBe('share.info.status_starting');
    expect(shareStatusKey('pending')).toBe('share.info.status_starting');
    for (const s of ['failed', 'stopped', 'unreachable', '', 'anything']) {
      expect(shareStatusKey(s)).toBe('share.info.status_unavailable');
    }
  });
});

describe('shareLimitRows', () => {
  test('no limits, no rows', () => {
    expect(shareLimitRows(null)).toEqual([]);
  });

  test('only configured windows, minute → hour → day', () => {
    expect(
      shareLimitRows({ perMinute: null, perHour: 20, perDay: 100 }),
    ).toEqual([
      { labelKey: 'share.info.limit_hour', count: 20 },
      { labelKey: 'share.info.limit_day', count: 100 },
    ]);
    expect(shareLimitRows({ perMinute: 3, perHour: null, perDay: null })).toEqual(
      [{ labelKey: 'share.info.limit_minute', count: 3 }],
    );
    expect(shareLimitRows({ perMinute: 1, perHour: 2, perDay: 3 })).toEqual([
      { labelKey: 'share.info.limit_minute', count: 1 },
      { labelKey: 'share.info.limit_hour', count: 2 },
      { labelKey: 'share.info.limit_day', count: 3 },
    ]);
  });
});

describe('shareKindKey', () => {
  test('one key per family', () => {
    expect(shareKindKey('image')).toBe('share.info.kind_image');
    expect(shareKindKey('presentation')).toBe('share.info.kind_presentation');
  });
});
