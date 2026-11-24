import { describe, expect, test } from 'bun:test';

import type { IChatMessage } from '../domain/chat.types';
import { foldThinking, formatMessageTime } from './transcript';

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

// CLEAN-242: the live chat folds narration ("I'll check what's on hand.") into
// a thinking block; the history showed every line as a reply of its own.
describe('foldThinking', () => {
  let n = 0;
  const msg = (role: IChatMessage['role'], text: string, interim = false) =>
    ({ id: `m${++n}`, role, text, ts: n * 1000, ...(interim ? { interim: true } : {}) }) as IChatMessage;

  test('narration before a reply becomes the thinking block above it', () => {
    const items = foldThinking([
      msg('user', 'How many years?'),
      msg('assistant', "I'll check what's on hand.", true),
      msg('assistant', 'Let me count.', true),
      msg('assistant', 'Seven model years.'),
    ]);
    expect(items.map((i) => i.message?.text)).toEqual(['How many years?', 'Seven model years.']);
    expect(items[1]!.thinking?.steps.map((s) => s.label)).toEqual([
      "I'll check what's on hand.",
      'Let me count.',
    ]);
    expect(items[0]!.thinking).toBe(null);
  });

  test('narration with no reply after it stands on its own', () => {
    const items = foldThinking([msg('assistant', 'Checking…', true), msg('user', 'Hello?')]);
    expect(items[0]!.message).toBe(null);
    expect(items[0]!.thinking?.steps.map((s) => s.label)).toEqual(['Checking…']);
    expect(items[1]!.message?.text).toBe('Hello?');
  });

  test('narration at the end of the page is kept', () => {
    const items = foldThinking([msg('user', 'Hi'), msg('assistant', 'Looking…', true)]);
    expect(items.length).toBe(2);
    expect(items[1]!.message).toBe(null);
  });

  test('a reply with no narration has no block', () => {
    const items = foldThinking([msg('assistant', 'Hello.')]);
    expect(items[0]!.thinking).toBe(null);
  });
});
