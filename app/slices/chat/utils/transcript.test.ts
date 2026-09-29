import { describe, expect, test } from 'bun:test';

import { formatMessageTime } from './transcript';

const plain = (text: string) => text.replace(/[  ]/g, ' ');

// The twin of admin's transcript stamp: admin is fixed to English, this one
// follows the language it is given and never the browser.
describe('formatMessageTime', () => {
  const sent = new Date(2026, 7, 21, 0, 46, 12).getTime();
  const later = new Date(2026, 8, 29, 12, 0, 0);
  const sameDay = new Date(2026, 7, 21, 23, 59, 0);

  test('English', () => {
    expect(plain(formatMessageTime(sent, 'en', later))).toBe('Aug 21, 12:46 AM');
    expect(plain(formatMessageTime(sent, 'en', sameDay))).toBe('12:46 AM');
  });

  test('Russian', () => {
    expect(plain(formatMessageTime(sent, 'ru', later))).toBe('21 авг., 00:46');
    expect(formatMessageTime(sent, 'ru', sameDay)).toBe('00:46');
  });
});
