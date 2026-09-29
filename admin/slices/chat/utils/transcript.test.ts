import { describe, expect, test } from 'bun:test';

import { formatMessageTime } from './transcript';

// CLEAN-127: this stamp read "21 авг., 00:46" in a Russian browser, because the
// language was left to the browser. It is English whoever is looking.
describe('formatMessageTime', () => {
  const sent = new Date(2026, 7, 21, 0, 46, 12).getTime();

  test('a message from an earlier day carries the day', () => {
    expect(formatMessageTime(sent, new Date(2026, 8, 29, 12, 0, 0))).toBe('Aug 21, 00:46');
  });

  test('a message from today is the time alone', () => {
    expect(formatMessageTime(sent, new Date(2026, 7, 21, 23, 59, 0))).toBe('00:46');
  });

  test('a message from an earlier year carries the year', () => {
    expect(formatMessageTime(sent, new Date(2027, 0, 5, 12, 0, 0))).toBe(
      'Aug 21, 2026, 00:46',
    );
  });
});
